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

// clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const visionClient = new vision.ImageAnnotatorClient();

// env
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// mapeamento de vendedores
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// templates de alerta
const MENSAGENS = {
  alerta1: (c, v) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\nSolicitamos atenção para concluir o atendimento o quanto antes.`,
  alerta2: (c, v) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, reforçamos que o cliente *${c}* permanece aguardando orçamento há 12h úteis.`,
  alertaFinal: (c, v) =>
    `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.\nVocê tem 10 minutos para responder.`,
  alertaGestores: (c, v) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${c}* segue sem retorno após 18h úteis.\nResponsável: *${v}*`
};

// calcula horas úteis
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  for (let cur = new Date(start); cur < end; cur.setHours(cur.getHours() + 1)) {
    const d = cur.getDay(), h = cur.getHours();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) horas++;
  }
  return horas;
}

// envia WhatsApp
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
  } catch (err) {
    console.error("[ERRO] Envio WPPFalhou:", err.message);
  }
}

// transcrição de áudio Whisper
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
    console.error("[ERRO] Transcrição áudio:", err.message);
    return null;
  }
}

// extração de texto PDF
async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const data = await pdfParse(resp.data);
    return data.text;
  } catch (err) {
    console.error("[ERRO] PDF parse:", err.message);
    return null;
  }
}

// OCR via Cloud Vision
async function analisarImagem(url) {
  try {
    // baixa e passa buffer diretamente
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const [result] = await visionClient.textDetection({ image: { content: resp.data } });
    return result.textAnnotations?.[0]?.description || null;
  } catch (err) {
    console.error("[ERRO] Análise imagem:", err.message);
    return null;
  }
}

// detecção de intenção de orçamento
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Você é um Gerente Comercial IA que identifica se um cliente está aguardando um orçamento." },
        { role: "user", content: `Cliente: ${cliente}\nMensagem: ${mensagem}\nContexto: ${contexto || ""}` }
      ]
    });
    const reply = completion.choices[0].message.content.toLowerCase();
    return reply.includes("sim") || reply.includes("aguard");
  } catch (err) {
    console.error("[ERRO] Intenção orçamento:", err.message);
    return false;
  }
}

// webhook
app.post("/conversa", async (req, res) => {
  try {
    const payload = req.body.payload;
    if (!payload?.user || !payload?.message) {
      console.error("[ERRO] Payload incompleto:", req.body);
      return res.status(400).json({ error: "Payload incompleto" });
    }

    const user    = payload.user;
    const message = payload.message;
    const atend   = payload.attendant;
    const nomeCli = user.Name || "Cliente";
    const rawText = message.text || message.caption || "[attachment]";
    console.log(`[LOG] Nova mensagem recebida de ${nomeCli}: "${rawText}"`);

    // coletar contexto de áudio/pdf/imagem
    let contexto = "";
    if (message.attachments?.length) {
      for (const a of message.attachments) {
        if (a.type === "audio" && a.payload?.url) {
          const t = await transcreverAudio(a.payload.url);
          if (t) contexto += t + "\n";
        }
        if (a.type === "file" && a.payload?.url && a.FileName?.toLowerCase().endsWith(".pdf")) {
          const t = await extrairTextoPDF(a.payload.url);
          if (t) contexto += t + "\n";
        }
        if (a.type === "image" && a.payload?.url) {
          const t = await analisarImagem(a.payload.url);
          if (t) contexto += t + "\n";
        }
      }
    }

    const aguardando = await isWaitingForQuote(nomeCli, rawText, contexto);
    if (!aguardando) return res.json({ status: "Sem ação necessária" });

    const nomeVendNorm = atend?.Name?.trim().toLowerCase();
    const numeroVend   = VENDEDORES[nomeVendNorm];
    if (!numeroVend) {
      console.warn(`[ERRO] Vendedor "${atend?.Name}" não mapeado.`);
      return res.json({ warning: "Vendedor não mapeado" });
    }

    const criadoEm = new Date(message.CreatedAt || payload.timestamp);
    const horas    = horasUteisEntreDatas(criadoEm, new Date());

    if (horas >= 18) {
      await enviarMensagem(numeroVend, MENSAGENS.alertaFinal(nomeCli, atend.Name));
      setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCli, atend.Name)), 10 * 60 * 1000);
    } else if (horas >= 12) {
      await enviarMensagem(numeroVend, MENSAGENS.alerta2(nomeCli, atend.Name));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVend, MENSAGENS.alerta1(nomeCli, atend.Name));
    }

    res.json({ status: "Processado" });
  } catch (err) {
    console.error("[ERRO] Falha no processamento:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
