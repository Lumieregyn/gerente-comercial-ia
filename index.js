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

// Initialize clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const visionClient = new vision.ImageAnnotatorClient();

// Env
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Sellers mapping (all lowercase, no extra spaces)
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035",
};

// Alert templates
const MENSAGENS = {
  alerta1: (c, v) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\nSolicitamos atenção para concluir o atendimento o quanto antes.\nAgradecemos pela colaboração.`,
  alerta2: (c, v) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, reforçamos que o cliente *${c}* permanece aguardando orçamento há 12h úteis.\nSolicitamos providências imediatas para evitar impacto negativo no atendimento.`,
  alertaFinal: (c, v) =>
    `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (c, v) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${c}* segue sem retorno após 18h úteis.\nResponsável: *${v}*\n\n⚠️ Por favor, verificar esse caso com urgência.`,
};

// Compute business hours between two dates
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio),
        end   = new Date(fim);
  let horas = 0, cur = new Date(start);
  while (cur < end) {
    const dia  = cur.getDay(),
          hora = cur.getHours();
    if (dia >= 1 && dia <= 5 && hora >= 8 && hora < 19) horas++;
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

// Send WhatsApp via WPPConnect
async function enviarMensagem(numero, texto) {
  if (!/^[0-9]{11,13}$/.test(numero)) {
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

// Transcribe audio via Whisper
async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const form = new FormData();
    form.append("file", Buffer.from(resp.data), { filename: "audio.ogg", contentType: "audio/ogg" });
    form.append("model", "whisper-1");
    const result = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    return result.data.text;
  } catch (err) {
    console.error("[ERRO] Transcrição de áudio falhou:", err.response?.data || err.message);
    return null;
  }
}

// Extract text from PDF
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

// Analyze image via Google Cloud Vision (OCR)
async function analisarImagem(url) {
  try {
    const [result] = await visionClient.textDetection(url);
    const desc = result.textAnnotations.map(a => a.description).join("\n");
    return desc || null;
  } catch (err) {
    console.error("[ERRO] Análise de imagem falhou:", err);
    return null;
  }
}

// Detect if client awaits quote via GPT-4o
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const comp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é Gerente Comercial IA, detecte se o cliente aguarda orçamento." },
        { role: "user", content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto ? "\nContexto: " + contexto : ""}` },
      ],
    });
    const reply = comp.choices[0].message.content.toLowerCase();
    return /sim|aguard|precisa/.test(reply);
  } catch (err) {
    console.error("[ERRO] Análise de intenção falhou:", err);
    return false;
  }
}

// Main webhook
app.post("/conversa", async (req, res) => {
  try {
    const p = req.body.payload || {};
    const user      = p.user;
    const msg       = p.message || p.Message;
    const attendant = p.attendant;
    const channel   = p.channel;
    if (!user || !msg || !attendant || !channel) {
      console.error("[ERRO] Payload incompleto ou evento não suportado:", req.body);
      return res.status(400).json({ error: "Payload incompleto ou evento não suportado" });
    }

    // Trim names to remove extra spaces
    const nomeCliente  = String(user.Name || "").trim();
    const nomeVendedor = String(attendant.Name || "").trim().toLowerCase();
    const texto        = msg.text || msg.caption || "[attachment]";
    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${texto}"`);

    let contextoExtra = "";

    // Handle audio
    if (msg.type === "audio" && msg.payload?.url) {
      const t = await transcreverAudio(msg.payload.url);
      if (t) { console.log("[TRANSCRICAO]", t); contextoExtra += t; }
    }

    // Handle PDF
    if (
      msg.type === "file" &&
      msg.payload?.url &&
      msg.payload.FileName?.toLowerCase().endsWith(".pdf")
    ) {
      const pdfText = await extrairTextoPDF(msg.payload.url);
      if (pdfText) { console.log("[PDF-TEXTO]", pdfText); contextoExtra += "\n" + pdfText; }
    }

    // Handle image
    if (msg.type === "image" && msg.payload?.url) {
      const imgText = await analisarImagem(msg.payload.url);
      if (imgText) { console.log("[IMAGEM-TEXTO]", imgText); contextoExtra += "\n" + imgText; }
    }

    // AI intent
    const aguardando = await isWaitingForQuote(nomeCliente, texto, contextoExtra);
    if (!aguardando) {
      console.log("[INFO] Cliente não aguarda orçamento. Sem alertas.");
      return res.json({ status: "Sem ação necessária." });
    }

    // Timing & alerts
    const criadoEm = new Date(msg.CreatedAt || req.body.timestamp);
    const horas    = horasUteisEntreDatas(criadoEm, new Date());
    const numeroV  = VENDEDORES[nomeVendedor];
    if (!numeroV) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    if (horas >= 18) {
      await enviarMensagem(numeroV, MENSAGENS.alertaFinal(nomeCliente, attendant.Name.trim()));
      setTimeout(
        () => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, attendant.Name.trim())),
        10 * 60 * 1000
      );
    } else if (horas >= 12) {
      await enviarMensagem(numeroV, MENSAGENS.alerta2(nomeCliente, attendant.Name.trim()));
    } else if (horas >= 6) {
      await enviarMensagem(numeroV, MENSAGENS.alerta1(nomeCliente, attendant.Name.trim()));
    }

    res.json({ status: "Processado" });
  } catch (err) {
    console.error("[ERRO] Falha ao processar:", err);
    res.status(500).json({ error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
