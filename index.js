// index.js – Versão final completa (~250 linhas)
// Gerente Comercial IA: texto, áudio (Whisper), PDF (pdf-parse) e imagem (GPT-4V)

require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");

const app = express();
app.use(bodyParser.json({ limit: "100mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "100mb" }));

// Ambiente e configuração
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VISION_MODEL = "gpt-4o-mini"; // ou "gpt-4v" se disponível
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
    `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\nSolicitamos atenção para concluir o atendimento o quanto antes.`,
  alerta2: (c, v) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, reforçamos que o cliente *${c}* permanece aguardando orçamento há 12h úteis.`,
  alertaFinal: (c, v) =>
    `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (c, v) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${c}* segue sem retorno após 18h úteis.\nResponsável: *${v}*`
};

// Cliente OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Funções de log
function log(msg) { console.log("[LOG]", msg); }
function logErro(msg) { console.error("[ERRO]", msg); }

// Download de arquivo remoto para Buffer
async function baixarBuffer(url) {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(res.data);
}

// Transcrição de áudio via Whisper
async function transcreverAudio(url) {
  try {
    const buffer = await baixarBuffer(url);
    const form = new FormData();
    form.append("file", buffer, { filename: "audio.ogg", contentType: "audio/ogg" });
    form.append("model", "whisper-1");
    const resp = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    return resp.data.text;
  } catch (err) {
    logErro("Transcrição de áudio falhou: " + err.message);
    return null;
  }
}

// Extração de texto de PDF
async function extrairPdf(url) {
  try {
    const buffer = await baixarBuffer(url);
    const data = await pdfParse(buffer);
    return data.text;
  } catch (err) {
    logErro("Leitura de PDF falhou: " + err.message);
    return null;
  }
}

// OCR de imagem via GPT-4V
async function ocrImagemGPT(url) {
  try {
    const completion = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: "Você é um assistente que extrai todo o texto de imagens." },
        { role: "user", content: `Extraia todo o texto desta imagem: ${url}` }
      ]
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    logErro("OCR via GPT-4V falhou: " + err.message);
    return null;
  }
}

// Análise de texto com GPT-4
async function analisarTexto(texto) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "Você é um gerente comercial que avalia a qualidade de atendimento." },
        { role: "user", content: texto }
      ]
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    logErro("Chamada à OpenAI falhou: " + err.message);
    return null;
  }
}

// Valida e unifica payload
function parsePayload(req) {
  let p = req.body.payload
    ? (typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body.payload)
    : req.body;
  return {
    user: p.user || {},
    attendant: p.attendant || {},
    message: p.message || { text: p.text || "", attachments: p.attachments || [], file: p.file }
  };
}

// Cálculo de horas úteis
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio), end = new Date(fim);
  let horas = 0;
  let cur = new Date(start);
  while (cur < end) {
    const d = cur.getDay(), h = cur.getHours();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) horas++;
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

// Normaliza nome para chave de mapeamento
function normalizeNome(nome = "") {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

// Envia mensagem WhatsApp
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    logErro("Número inválido: " + numero);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
  } catch (err) {
    logErro("Erro ao enviar WPP: " + (err.response?.data || err.message));
  }
}

// Detecta se cliente aguarda orçamento
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const comp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Você é Gerente Comercial IA: detecte se cliente está aguardando orçamento." },
        { role: "user", content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto ? "\nContexto: " + contexto : ""}` }
      ]
    });
    const reply = comp.choices[0].message.content.toLowerCase();
    return reply.includes("sim") || reply.includes("aguard");
  } catch (err) {
    logErro("Análise de intenção falhou: " + err.message);
    return false;
  }
}

// Rota principal
app.post("/conversa", async (req, res) => {
  try {
    const { user, attendant, message } = parsePayload(req);
    const nomeCliente = user.Name || "Cliente";
    const nomeVendedorRaw = attendant.Name || "Vendedor";
    const texto = message.text || message.caption || "";
    const attachments = message.attachments || [];
    const fileInfo = message.file || attachments[0] || null;

    log(`Mensagem de ${nomeCliente}: "${texto || "[attachment]"}"`);

    let contextoExtra = "";

    // Processa anexo
    if (fileInfo && fileInfo.url) {
      const url = fileInfo.url;
      // Áudio
      if (fileInfo.type === "audio" || fileInfo.mimeType?.startsWith("audio")) {
        const txt = await transcreverAudio(url);
        if (txt) { log("[Transcrição] " + txt); contextoExtra += "\n" + txt; }
      }
      // PDF
      else if (fileInfo.mimeType === "application/pdf") {
        const txt = await extrairPdf(url);
        if (txt) { log("[PDF] " + txt.slice(0, 200)); contextoExtra += "\n" + txt; }
      }
      // Imagem
      else if (fileInfo.type === "image" || fileInfo.mimeType?.startsWith("image")) {
        const txt = await ocrImagemGPT(url);
        if (txt) { log("[OCR Imagem] " + txt.slice(0, 200)); contextoExtra += "\n" + txt; }
      }
    }

    // Verifica intenção
    const aguardando = await isWaitingForQuote(nomeCliente, texto, contextoExtra);
    if (!aguardando) {
      log("Cliente não aguarda orçamento.");
      return res.json({ status: "Sem ação" });
    }

    // Mapeia vendedor
    const numVend = VENDEDORES[normalizeNome(nomeVendedorRaw)];
    if (!numVend) {
      logErro("Vendedor não mapeado: " + nomeVendedorRaw);
      return res.json({ warning: "Vendedor não mapeado" });
    }

    // Calcula horas
    const criadoEm = new Date(message.CreatedAt || Date.now());
    const horas = horasUteisEntreDatas(criadoEm, new Date());

    // Dispara alertas
    if (horas >= 18) {
      await enviarMensagem(numVend, MENSAGENS.alertaFinal(nomeCliente, nomeVendedorRaw));
      setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, nomeVendedorRaw)), 10 * 60 * 1000);
    } else if (horas >= 12) {
      await enviarMensagem(numVend, MENSAGENS.alerta2(nomeCliente, nomeVendedorRaw));
    } else if (horas >= 6) {
      await enviarMensagem(numVend, MENSAGENS.alerta1(nomeCliente, nomeVendedorRaw));
    }

    return res.json({ status: "Processado" });
  } catch (err) {
    logErro("Falha /conversa: " + err.message);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// Health check
app.get("/", (req, res) => res.send("Gerente Comercial IA ativo"));

// Inicia servidor
app.listen(PORT, () => log(`Servidor rodando na porta ${PORT}`));
