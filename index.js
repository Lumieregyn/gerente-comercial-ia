// index.js
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const vision = require("@google-cloud/vision");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Inicializa clientes
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const visionClient = new vision.ImageAnnotatorClient();

// Variáveis de ambiente
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Mapeamento de vendedores
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Templates de alerta
const MENSAGENS = {
  alerta1: (c, v) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\nSolicitamos atenção para concluir o atendimento o quanto antes.\nAgradecemos pela colaboração.`,
  alerta2: (c, v) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, reforçamos que o cliente *${c}* permanece aguardando orçamento há 12h úteis.\nSolicitamos providências imediatas para evitar impacto negativo no atendimento.`,
  alertaFinal: (c, v) =>
    `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (c, v) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${c}* segue sem retorno após 18h úteis.\nResponsável: *${v}*\n\n⚠️ Por favor, verificar esse caso com urgência.`
};

// Calcula horas úteis entre duas datas
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const cur = new Date(start);
  while (cur < end) {
    const dia = cur.getDay();
    const hora = cur.getHours();
    if (dia >= 1 && dia <= 5 && hora >= 8 && hora < 19) {
      horas++;
    }
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

// Envia mensagem via WPPConnect
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
    console.log(`Mensagem enviada para ${numero}: ${texto}`);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

// Transcrição de áudio
async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const form = new FormData();
    form.append("file", Buffer.from(resp.data), { filename: "audio.ogg", contentType: "audio/ogg" });
    form.append("model", "whisper-1");
    const result = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    return result.data.text;
  } catch (err) {
    console.error("[ERRO] Transcrição de áudio falhou:", err.response?.data || err.message);
    return null;
  }
}

// Extração de texto de PDF
async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const data = await pdfParse(resp.data);
    return data.text;
  } catch (err) {
    console.error("[ERRO] PDF parse falhou:", err.message || err);
    return null;
  }
}

// Análise de imagem com Google Cloud Vision
async function analisarImagem(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const [result] = await visionClient.documentTextDetection({ image: { content: resp.data } });
    return result.fullTextAnnotation?.text || null;
  } catch (err) {
    console.error("[ERRO] Análise de imagem falhou:", err);
    return null;
  }
}

// Detecta se cliente aguarda orçamento
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é Gerente Comercial IA, detecte se o cliente aguarda orçamento." },
        {
          role: "user",
          content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto ? "\nContexto: " + contexto : ""}`
        }
      ]
    });
    const reply = completion.choices[0].message.content.toLowerCase();
    return reply.includes("sim") || reply.includes("aguard") || reply.includes("precisa");
  } catch (err) {
    console.error("[ERRO] Análise de intenção falhou:", err);
    return false;
  }
}

// Rota principal
app.post("/conversa", async (req, res) => {
  try {
    const { payload } = req.body;
    if (!payload || !payload.user || !payload.message || !payload.channel) {
      console.error("[ERRO] Payload incompleto ou evento não suportado:", req.body);
      return res.status(400).json({ error: "Payload incompleto ou evento não suportado" });
    }

    const { user, message, attendant } = payload;
    const nomeCliente = user.Name;
    const nomeVendedor = attendant.Name;
    const texto = message.text || message.caption || "[attachment]";
    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${texto}"`);

    // Monta contexto extra (áudio, PDF, imagem)
    let contextoExtra = "";
    if (message.type === "audio" && message.payload?.url) {
      const t = await transcreverAudio(message.payload.url);
      if (t) { console.log("[TRANSCRICAO]", t); contextoExtra += t; }
    }
    if (
      message.type === "file" &&
      message.payload?.url &&
      message.payload.FileName?.toLowerCase().endsWith(".pdf")
    ) {
      const pdfText = await extrairTextoPDF(message.payload.url);
      if (pdfText) { console.log("[PDF-TEXTO]", pdfText); contextoExtra += "\n" + pdfText; }
    }
    if (message.type === "image" && message.payload?.url) {
      const imgText = await analisarImagem(message.payload.url);
      if (imgText) { console.log("[IMAGEM-ANALISE]", imgText); contextoExtra += "\n" + imgText; }
    }

    // Verifica se aguarda orçamento
    const aguardando = await isWaitingForQuote(nomeCliente, texto, contextoExtra);
    if (!aguardando) {
      console.log("[INFO] Cliente não aguarda orçamento. Sem alertas.");
      return res.json({ status: "Sem ação necessária." });
    }

    // Calcula horas úteis
    const criadoEm = new Date(message.CreatedAt || payload.timestamp);
    const horas = horasUteisEntreDatas(criadoEm, new Date());

    const numeroVendedor = VENDEDORES[nomeVendedor.trim().toLowerCase()];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    // Envia alertas conforme o tempo
    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, nomeVendedor));
      setTimeout(
        () => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, nomeVendedor)),
        10 * 60 * 1000
      );
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeCliente, nomeVendedor));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeCliente, nomeVendedor));
    }

    res.json({ status: "Processado" });
  } catch (err) {
    console.error("[ERRO] Falha ao processar:", err);
    res.status(500).json({ error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando na porta", PORT));
