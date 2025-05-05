require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");

const app = express();

// Permite payloads grandes (audio, PDF, imagens em base64)
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// Cliente OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Chave da Vision API (REST)
const VISION_API_KEY = process.env.VISION_API_KEY;

// Mapeamento de vendedores e templates de mensagem
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
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, o cliente *${c}* permanece aguardando orçamento há 12h úteis.`,
  alertaFinal: (c, v) =>
    `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* está há 18h úteis sem orçamento.\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (c, v) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${c}* segue sem retorno após 18h úteis.\nResponsável: *${v}*`,
};

// Funções de log
function log(msg) {
  console.log("[LOG]", msg);
}
function logErro(msg) {
  console.error("[ERRO]", msg);
}

// Validação básica do payload
function isValidPayload(payload) {
  return (
    payload?.user?.Name &&
    payload?.attendant?.Name &&
    payload?.message?.type
  );
}

// Chama a OpenAI para analisar texto
async function analisarTexto(texto) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "Você é um gerente comercial que avalia a qualidade de atendimento com base no conteúdo recebido.",
        },
        { role: "user", content: texto },
      ],
    });
    return (
      completion.choices[0]?.message?.content?.trim() || "[Sem resposta]"
    );
  } catch (err) {
    logErro(`Erro ao chamar OpenAI: ${err.message}`);
    return "[Erro na IA]";
  }
}

// Endpoint de webhook
app.post("/conversa", async (req, res) => {
  let payload;

  // Parse robusto de payload (string ou objeto)
  if (req.body.payload) {
    if (typeof req.body.payload === "string") {
      try {
        payload = JSON.parse(req.body.payload);
      } catch (err) {
        logErro("Erro ao fazer parse do payload JSON string.");
        return res.status(400).send("Payload JSON inválido.");
      }
    } else if (typeof req.body.payload === "object") {
      payload = req.body.payload;
    } else {
      logErro("Formato de payload inesperado.");
      return res.status(400).send("Payload inválido.");
    }
  } else {
    payload = req.body;
  }

  if (!isValidPayload(payload)) {
    logErro("Payload incompleto.");
    return res.status(400).send("Payload inválido.");
  }

  const { user, attendant, message } = payload;
  const nomeCliente = user.Name;
  const nomeVendedor = attendant.Name;
  const { type, text: textoMensagem = "", attachments = [] } = message;

  log(
    `Nova mensagem recebida de ${nomeCliente}: "${
      textoMensagem || "[attachment]"
    }"`
  );

  try {
    // Áudio via Whisper
    if (type === "audio") {
      const audioUrl = attachments[0]?.url;
      if (!audioUrl) throw new Error("URL de áudio não encontrada.");

      const audioRes = await axios.get(audioUrl, {
        responseType: "arraybuffer",
      });
      const transcription = await openai.audio.transcriptions.create({
        file: Buffer.from(audioRes.data),
        model: "whisper-1",
        response_format: "text",
      });

      const respostaIA = await analisarTexto(transcription);
      log(`[LOG] Resposta da IA ao áudio: ${respostaIA}`);
    }

    // PDF via pdf-parse
    else if (type === "file" && attachments[0]?.type === "application/pdf") {
      const pdfUrl = attachments[0].url;
      const pdfRes = await axios.get(pdfUrl, { responseType: "arraybuffer" });
      const data = await pdfParse(Buffer.from(pdfRes.data));
      const respostaIA = await analisarTexto(data.text || "");
      log(`[LOG] Resposta da IA ao PDF: ${respostaIA}`);
    }

    // Imagem via REST API do Google Vision
    else if (type === "image") {
      const imgUrl = attachments[0]?.url;
      if (!imgUrl) throw new Error("URL da imagem não encontrada.");

      const imgRes = await axios.get(imgUrl, {
        responseType: "arraybuffer",
      });
      const contentB64 = Buffer.from(imgRes.data).toString("base64");

      const visionRes = await axios.post(
        `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
        {
          requests: [
            {
              image: { content: contentB64 },
              features: [{ type: "TEXT_DETECTION" }],
            },
          ],
        }
      );

      const annotations =
        visionRes.data.responses[0].textAnnotations || [];
      const textoImg =
        annotations[0]?.description || "Nenhum texto encontrado.";

      const respostaIA = await analisarTexto(textoImg);
      log(`[LOG] Texto detectado na imagem: ${textoImg}`);
      log(`[LOG] Resposta da IA à imagem: ${respostaIA}`);
    }

    // Texto simples
    else if (textoMensagem) {
      const respostaIA = await analisarTexto(textoMensagem);
      log(`[LOG] Resposta da IA ao texto: ${respostaIA}`);
    }

    return res.sendStatus(200);
  } catch (err) {
    logErro(`Erro geral de análise: ${err.message}`);
    return res.status(500).send("Erro na análise.");
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("Gerente Comercial IA ativo.");
});

// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`[LOG] Servidor iniciado na porta ${PORT}`)
);
