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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const visionClient = new vision.ImageAnnotatorClient();

const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

const MENSAGENS = {
  alerta1: (c, v) => `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\nSolicitamos atenção para concluir o atendimento o quanto antes.\nAgradecemos pela colaboração.`,
  alerta2: (c, v) => `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, reforçamos que o cliente *${c}* permanece aguardando orçamento há 12h úteis.\nSolicitamos providências imediatas para evitar impacto negativo no atendimento.`,
  alertaFinal: (c, v) => `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (c, v) => `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${c}* segue sem retorno após 18h úteis.\nResponsável: *${v}*\n\n⚠️ Por favor, verificar esse caso com urgência.`
};

function horasUteisEntreDatas(inicio, fim) {
  const cur = new Date(inicio), end = new Date(fim);
  let horas = 0;
  while (cur < end) {
    const d = cur.getDay(), h = cur.getHours();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) horas++;
    cur.setHours(h + 1);
  }
  return horas;
}

function normalizeNome(nome) {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) return;
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.message);
  }
}

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
    console.error("[ERRO] Transcrição de áudio falhou:", err.message);
    return null;
  }
}

async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const { text } = await pdfParse(resp.data);
    // se detectar texto muito curto, chama OCR de documento
    if ((text || "").trim().length < 50) {
      const [doc] = await visionClient.documentTextDetection({ content: resp.data });
      return doc.fullTextAnnotation?.text || text;
    }
    return text;
  } catch (err) {
    console.error("[ERRO] PDF parse falhou:", err.message);
    return null;
  }
}

async function analisarImagem(url) {
  try {
    // usa URL remota
    const [result] = await visionClient.textDetection({ image: { source: { imageUri: url } } });
    return result.textAnnotations?.[0]?.description || null;
  } catch (err) {
    console.error("[ERRO] Análise de imagem falhou:", err.message);
    return null;
  }
}

async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const comp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é Gerente Comercial IA, detecte se o cliente aguarda orçamento." },
        { role: "user", content: `Cliente: ${cliente}\nMensagem: ${mensagem}\nContexto: ${contexto}` }
      ]
    });
    const r = comp.choices[0].message.content.toLowerCase();
    return r.includes("sim") || r.includes("aguard");
  } catch (err) {
    console.error("[ERRO] Análise de intenção falhou:", err.message);
    return false;
  }
}

app.post("/conversa", async (req, res) => {
  try {
    const payload = req.body.payload;
    if (!payload?.user || !payload?.message) {
      console.error("[ERRO] Payload incompleto ou evento não suportado:", req.body);
      return res.status(400).json({ error: "Payload incompleto ou evento não suportado" });
    }

    const user = payload.user;
    const message = payload.message;
    const vendedorRaw = payload.attendant?.Name || "";
    const nomeCliente = user.Name || "Cliente";
    const texto = message.text || message.caption || "[attachment]";
    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${texto}"`);

    // processa anexos
    let contextoExtra = "";
    if (message.attachments?.length) {
      for (const a of message.attachments) {
        if (a.type === "audio" && a.payload?.url) {
          const t = await transcreverAudio(a.payload.url);
          if (t) {
            console.log("[TRANSCRICAO]", t);
            contextoExtra += t + "\n";
          }
        }
        if (a.type === "file" && a.payload?.url && a.payload.FileName?.toLowerCase().endsWith(".pdf")) {
          const t = await extrairTextoPDF(a.payload.url);
          if (t) {
            console.log("[PDF-TEXTO]", t);
            contextoExtra += t + "\n";
          }
        }
        if (a.type === "image" && a.payload?.url) {
          const t = await analisarImagem(a.payload.url);
          if (t) {
            console.log("[IMAGEM-TEXTO]", t);
            contextoExtra += t + "\n";
          }
        }
      }
    }

    // detecta se aguarda orçamento
    const aguardando = await isWaitingForQuote(nomeCliente, texto, contextoExtra);
    if (!aguardando) {
      console.log("[INFO] Cliente não aguarda orçamento. Sem alertas.");
      return res.json({ status: "Sem ação necessária." });
    }

    // mapeia vendedor
    const nomeVendNorm = normalizeNome(vendedorRaw);
    const numeroVendedor = VENDEDORES[nomeVendNorm];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${vendedorRaw}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    // calcula horas úteis
    const criadoEm = new Date(message.CreatedAt || payload.timestamp);
    const horas = horasUteisEntreDatas(criadoEm, Date.now());

    // envia alertas
    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, vendedorRaw));
      setTimeout(
        () => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, vendedorRaw)),
        10 * 60 * 1000
      );
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeCliente, vendedorRaw));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeCliente, vendedorRaw));
    }

    res.json({ status: "Processado" });
  } catch (err) {
    console.error("[ERRO] Falha ao processar:", err.message);
    res.status(500).json({ error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando na porta", PORT));
