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

// OpenAI e Vision clients
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

// Templates de mensagens de alerta
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
    if (dia >= 1 && dia <= 5 && hora >= 8 && hora < 19) horas++;
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

// Envia mensagem via WPPConnect
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) return;
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.message);
  }
}

// Transcrição de áudio com Whisper
async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const form = new FormData();
    form.append("file", Buffer.from(resp.data), { filename: "audio.ogg", contentType: "audio/ogg" });
    form.append("model", "whisper-1");
    const result = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    console.log("[TRANSCRICAO]", result.data.text);
    return result.data.text;
  } catch (err) {
    console.error("[ERRO] Transcrição de áudio falhou:", err.message);
    return null;
  }
}

// Extração de texto de PDF
async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const data = await pdfParse(resp.data);
    console.log("[PDF-TEXTO]", data.text.trim().slice(0, 200) + "...");
    return data.text;
  } catch (err) {
    console.error("[ERRO] PDF parse falhou:", err.message);
    return null;
  }
}

// Análise de imagem via Cloud Vision (OCR por URL)
async function analisarImagem(url) {
  try {
    const [result] = await visionClient.textDetection({
      image: { source: { imageUri: url } }
    });
    const detections = result.textAnnotations;
    console.log("[IMAGEM-ANALISE]", detections?.[0]?.description || "");
    return detections?.[0]?.description || null;
  } catch (err) {
    console.error("[ERRO] Análise de imagem falhou:", err.message);
    return null;
  }
}

// Detecta se o cliente aguarda orçamento
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é Gerente Comercial IA detectando se cliente aguarda orçamento." },
        { role: "user", content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto ? `\nContexto: ${contexto}` : ""}` }
      ]
    });
    const reply = completion.choices[0].message.content.toLowerCase();
    return reply.includes("sim") || reply.includes("aguard");
  } catch (err) {
    console.error("[ERRO] Análise de intenção falhou:", err.message);
    return false;
  }
}

// Webhook principal
app.post("/conversa", async (req, res) => {
  try {
    const payload = req.body.payload;
    const msg = payload.message || payload.Message;
    const user = payload.user;
    const attendant = payload.attendant || {};

    if (!msg || !user) {
      console.error("[ERRO] Payload incompleto ou evento não suportado:", req.body);
      return res.status(400).json({ error: "Payload incompleto ou evento não suportado" });
    }

    const nomeCliente = user.Name || "Cliente";
    const texto = msg.text || msg.caption || "[attachment]";
    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${texto}"`);

    // Gera contexto extra de anexo
    let contextoExtra = "";
    if (Array.isArray(msg.attachments)) {
      for (const a of msg.attachments) {
        // áudio
        if (a.type === "audio" && a.payload?.url) {
          const t = await transcreverAudio(a.payload.url);
          if (t) contextoExtra += `\n${t}`;
        }
        // PDF
        if (
          a.type === "file" &&
          a.payload?.url &&
          typeof a.FileName === "string" &&
          a.FileName.toLowerCase().endsWith(".pdf")
        ) {
          const t = await extrairTextoPDF(a.payload.url);
          if (t) contextoExtra += `\n${t}`;
        }
        // imagem
        if (a.type === "image" && a.payload?.url) {
          const t = await analisarImagem(a.payload.url);
          if (t) contextoExtra += `\n${t}`;
        }
      }
    }

    // Verifica intenção
    const aguarda = await isWaitingForQuote(nomeCliente, texto, contextoExtra);
    if (!aguarda) {
      console.log("[INFO] Cliente não aguarda orçamento. Sem alertas.");
      return res.json({ status: "Sem ação necessária." });
    }

    // Mapeia vendedor
    const nomeVendRaw = attendant.Name || "";
    const chaveVend = nomeVendRaw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    const numeroVend = VENDEDORES[chaveVend];
    if (!numeroVend) {
      console.warn(`[ERRO] Vendedor "${nomeVendRaw}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    // Calcula horas úteis desde criação
    const criadoEm = new Date(msg.CreatedAt || payload.timestamp);
    const horas = horasUteisEntreDatas(criadoEm, new Date());

    // Envia alertas conforme horas
    if (horas >= 18) {
      await enviarMensagem(numeroVend, MENSAGENS.alertaFinal(nomeCliente, nomeVendRaw));
      setTimeout(
        () => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, nomeVendRaw)),
        10 * 60 * 1000
      );
    } else if (horas >= 12) {
      await enviarMensagem(numeroVend, MENSAGENS.alerta2(nomeCliente, nomeVendRaw));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVend, MENSAGENS.alerta1(nomeCliente, nomeVendRaw));
    }

    res.json({ status: "Processado" });
  } catch (err) {
    console.error("[ERRO] Falha no processamento:", err.message);
    res.status(500).json({ error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
