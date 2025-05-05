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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const visionClient = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035",
};

const MENSAGENS = {
  alerta1: (c, v) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\nSolicitamos atenção para concluir o atendimento o quanto antes.`,
  alerta2: (c, v) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, reforçamos que o cliente *${c}* permanece aguardando orçamento há 12h úteis.`,
  alertaFinal: (c, v) =>
    `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (c, v) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${c}* segue sem retorno após 18h úteis.\nResponsável: *${v}*`,
};

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

function normalizeNome(nome) {
  return nome?.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) return;
  try {
    await axios.post(`${WPP_URL}/send-message`, {
      number: numero,
      message: texto,
    });
  } catch (err) {
    console.error("Erro ao enviar:", err.message);
  }
}

async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const form = new FormData();
    form.append("file", Buffer.from(resp.data), {
      filename: "audio.ogg",
      contentType: "audio/ogg",
    });
    form.append("model", "whisper-1");
    const result = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );
    return result.data.text;
  } catch {
    return null;
  }
}

async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const data = await pdfParse(resp.data);
    return data.text;
  } catch {
    return null;
  }
}

async function analisarImagem(url) {
  try {
    const [result] = await visionClient.textDetection(url);
    const detections = result.textAnnotations;
    return detections?.[0]?.description || null;
  } catch (err) {
    console.error("[ERRO] Análise de imagem falhou:", err.message);
    return null;
  }
}

async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "Você é um Gerente Comercial IA que identifica se um cliente está aguardando um orçamento.",
        },
        {
          role: "user",
          content: `Cliente: ${cliente}\nMensagem: ${mensagem}\nContexto: ${contexto || ""
            }`,
        },
      ],
    });
    const reply = completion.choices[0].message.content.toLowerCase();
    return reply.includes("sim") || reply.includes("aguard");
  } catch {
    return false;
  }
}

app.post("/conversa", async (req, res) => {
  try {
    const payload = req.body.payload;
    const message = payload.Message || payload.message;
    const user = payload.user;
    const vendedorRaw = payload.attendant?.Name || "";

    if (!message || !user) {
      console.error("[ERRO] Payload incompleto:", req.body);
      return res.status(400).json({ error: "Payload incompleto" });
    }

    const nomeCliente = user.Name || "Cliente";
    const texto = message.text || message.caption || "[attachment]";
    const nomeVendedor = normalizeNome(vendedorRaw);
    const numeroVendedor = VENDEDORES[nomeVendedor];

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${texto}"`);

    let contextoExtra = "";
    if (message.attachments?.length) {
      for (const a of message.attachments) {
        if (a.type === "audio" && a.payload?.url) {
          const t = await transcreverAudio(a.payload.url);
          if (t) contextoExtra += t;
        }
        if (a.type === "file" && a.payload?.url && a.payload.FileName?.endsWith(".pdf")) {
          const t = await extrairTextoPDF(a.payload.url);
          if (t) contextoExtra += t;
        }
        if (a.type === "image" && a.payload?.url) {
          const t = await analisarImagem(a.payload.url);
          if (t) contextoExtra += t;
        }
      }
    }

    const aguardando = await isWaitingForQuote(nomeCliente, texto, contextoExtra);
    if (!aguardando) return res.json({ status: "Sem alerta" });

    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${vendedorRaw}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    const criadoEm = new Date(message.CreatedAt || payload.timestamp);
    const horas = horasUteisEntreDatas(criadoEm, new Date());

    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, vendedorRaw));
      setTimeout(
        () =>
          enviarMensagem(
            GRUPO_GESTORES_ID,
            MENSAGENS.alertaGestores(nomeCliente, vendedorRaw)
          ),
        10 * 60 * 1000
      );
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeCliente, vendedorRaw));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeCliente, vendedorRaw));
    }

    res.json({ status: "Processado" });
  } catch (err) {
    console.error("[ERRO] Falha no processamento:", err.message);
    res.status(500).json({ error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando na porta", PORT));
