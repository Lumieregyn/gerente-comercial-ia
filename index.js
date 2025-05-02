const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// --- Inicializa OpenAI ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Variáveis de ambiente ---
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// --- Mapeamento de vendedores ---
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// --- Templates de alerta ---
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

// --- Calcula horas úteis ---
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0, cur = new Date(start);
  while (cur < end) {
    const dia = cur.getDay(), h = cur.getHours();
    if (dia >= 1 && dia <= 5 && h >= 8 && h < 19) horas++;
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

// --- Envia WhatsApp ---
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

// --- Transcrição de áudio ---
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

// --- Extração de texto de PDF ---
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

// --- Descrição de imagem via GPT-4o-mini (multimodal) ---
async function analisarImagem(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const b64 = Buffer.from(resp.data).toString("base64");
    // Envia base64 como mensagem multimodal
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é Gerente Comercial IA, descreva em detalhes o conteúdo desta imagem." },
        { role: "user", content: `data:image/*;base64,${b64}` }
      ]
    });
    return completion.choices[0].message.content;
  } catch (err) {
    console.error("[ERRO] Análise de imagem falhou:", err);
    return null;
  }
}

// --- Detecta espera de orçamento ---
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é Gerente Comercial IA, detecte se o cliente aguarda orçamento." },
        { role: "user", content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto ? "\nContexto: " + contexto : ""}` }
      ]
    });
    const reply = completion.choices[0].message.content.toLowerCase();
    return reply.includes("sim") || reply.includes("aguard") || reply.includes("precisa");
  } catch (err) {
    console.error("[ERRO] Análise de intenção falhou:", err);
    return false;
  }
}

// --- Rota principal ---
app.post("/conversa", async (req, res) => {
  try {
    const payload = req.body.payload;
    if (!payload || !payload.user || !(payload.message || payload.Message)) {
      console.error("[ERRO] Payload incompleto ou evento não suportado:", req.body);
      return res.status(400).json({ error: "Payload incompleto ou evento não suportado" });
    }

    // Compatibilidade message vs Message
    const message = payload.message || payload.Message;
    const user = payload.user;
    const attendant = payload.attendant || {};
    // Fallback de nome
    const nomeCliente = user.Name || user.name || user.Phone || "Cliente";
    const nomeVendedor = attendant.Name || attendant.name || "";

    // Texto puro ou placeholder
    const texto = message.text || message.caption || "[attachment]";
    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${texto}"`);

    let contextoExtra = "";

    // Processa attachments
    const atts = Array.isArray(message.attachments) ? message.attachments : [];
    for (const att of atts) {
      const url = att.payload?.url;
      if (!url) continue;

      if (att.type === "audio") {
        const t = await transcreverAudio(url);
        if (t) { console.log("[TRANSCRICAO]", t); contextoExtra += t; }
      }

      if (att.type === "file") {
        const fn = att.fileName || att.FileName || "";
        if (fn.toLowerCase().endsWith(".pdf")) {
          const pdfText = await extrairTextoPDF(url);
          if (pdfText) { console.log("[PDF-TEXTO]", pdfText); contextoExtra += "\n" + pdfText; }
        }
      }

      if (att.type === "image") {
        const desc = await analisarImagem(url);
        if (desc) { console.log("[IMAGEM-ANALISE]", desc); contextoExtra += "\n" + desc; }
      }
    }

    // Verifica intenção de orçamento
    const aguardando = await isWaitingForQuote(nomeCliente, texto, contextoExtra);
    if (!aguardando) {
      console.log("[INFO] Cliente não aguarda orçamento. Sem alertas.");
      return res.json({ status: "Sem ação necessária." });
    }

    // Calcula atraso
    const criadoEm = new Date(message.CreatedAt || req.body.timestamp || Date.now());
    const horas = horasUteisEntreDatas(criadoEm, new Date());
    const numeroVendedor = VENDEDORES[nomeVendedor.toLowerCase().trim()];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    // Dispara alertas
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

    return res.json({ status: "Processado" });
  } catch (err) {
    console.error("[ERRO] Falha ao processar:", err);
    return res.status(500).json({ error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
