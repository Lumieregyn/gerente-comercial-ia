const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Estado para evitar duplicação de alertas
const alertState = {};

// Middleware para capturar rawBody e suportar payloads grandes
app.use(bodyParser.json({
  verify: (req, res, buf, encoding) => { req.rawBody = buf.toString(encoding || "utf8"); }
}));
app.use(bodyParser.urlencoded({
  extended: true,
  verify: (req, res, buf, encoding) => { req.rawBody = buf.toString(encoding || "utf8"); }
}));

// IDs e mapeamentos
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Mensagens de alerta
const MENSAGENS = {
  alerta1: (c, v) => `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\nPor favor, retome o atendimento!`,
  alerta2: (c, v) => `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 12h úteis.\nProvidencie retorno imediato!`,
  alertaFinal: (c, v) => `🚨 *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 18h úteis.\nVocê tem 10 minutos para responder ou será escalado à gestão.`,
  alertaGestores: (c, v) => `🚨 *Alerta Crítico*\n\nO cliente *${c}* aguardou orçamento 18h úteis sem resposta de *${v}*.\nProvidências urgentes!`
};

// Calcula horas úteis entre duas datas
function horasUteisEntreDatas(inicio, fim) {
  let start = new Date(inicio), end = new Date(fim), horas = 0;
  while (start < end) {
    const h = start.getHours(), d = start.getDay();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) horas++;
    start.setHours(start.getHours() + 1);
  }
  return horas;
}

// Envia mensagem via WppConnect
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn("[ERRO] Número inválido: " + numero);
    return;
  }
  try {
    await axios.post(`${process.env.WPP_URL}/send-message`, { number: numero, message: texto });
  } catch (err) {
    console.error("Erro ao enviar:", err.response?.data || err.message);
  }
}

// Chama GPT para validar se alerta deve ser disparado
async function auditarAlerta(tipo, cliente, vendedor, texto, ultimaMsg) {
  const prompt = `Você é a Gerente Comercial IA da LumièreGyn.\nÚltima mensagem do cliente ${cliente}: \n"${ultimaMsg}"\nFluxo de alerta: ${tipo}.\nEnvie SIM ou NÃO.`;
  const res = await openai.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: prompt }] });
  return res.choices[0].message.content.trim().toUpperCase().startsWith("SIM");
}

// Detecta intenções de fechamento
function detectarFechamento(txt) {
  const sinais = ["fechado","vamos fechar","então tá combinado","então tá certo"];
  return sinais.some(s => txt.toLowerCase().includes(s));
}

// Endpoint principal
app.post("/conversa", async (req, res) => {
  console.log("[RAW BODY]", req.rawBody);
  try {
    const payload = req.body.payload;
    if (!payload?.user || !payload?.attendant) return res.status(400).json({ error: "Payload incompleto." });

    const msg = payload.message || payload.Message || {};
    const hasText = Boolean(msg.text);
    const hasAttach = Array.isArray(msg.attachments) && msg.attachments.length > 0;

    let transcricao = null;
    // Transcrição de áudio
    if (hasAttach && msg.attachments[0].type === "audio") {
      const url = msg.attachments[0].payload.url;
      const buffer = (await axios.get(url, { responseType: 'arraybuffer' })).data;
      const tmpFile = path.join('/tmp', `${msg.attachments[0].payload.attachment_id}.ogg`);
      await fs.promises.writeFile(tmpFile, Buffer.from(buffer));
      const transcription = await openai.audio.transcriptions.create({ file: fs.createReadStream(tmpFile), model: "whisper-1" });
      console.log("[TRANSCRICAO]", transcription.text);
      transcricao = transcription.text;
      await fs.promises.unlink(tmpFile);
    }

    if (!hasText && !transcricao && !hasAttach) return res.status(400).json({ error: "Sem texto ou anexos." });

    const cliente = payload.user.Name;
    const vendedorRaw = payload.attendant.Name.trim();
    const key = `${cliente}_${vendedorRaw}`.toLowerCase();
    const vendedorNum = VENDEDORES[vendedorRaw.toLowerCase()];
    if (!vendedorNum) return res.json({ warning: "Vendedor não mapeado." });

    const criadoEm = new Date(msg.CreatedAt || req.body.timestamp);
    const horas = horasUteisEntreDatas(criadoEm, new Date());
    const last = alertState[key] || 0;
    const textoCliente = hasText ? msg.text : (transcricao || "[anexo]");

    // Fluxo de alertas
    if (horas >= 6 && last < 6) {
      const txt = MENSAGENS.alerta1(cliente, vendedorRaw);
      if (await auditarAlerta("6h", cliente, vendedorRaw, txt, textoCliente)) {
        alertState[key] = 6;
        await enviarMensagem(vendedorNum, txt);
      }
    } else if (horas >= 12 && last < 12) {
      const txt = MENSAGENS.alerta2(cliente, vendedorRaw);
      if (await auditarAlerta("12h", cliente, vendedorRaw, txt, textoCliente)) {
        alertState[key] = 12;
        await enviarMensagem(vendedorNum, txt);
      }
    } else if (horas >= 18 && last < 18) {
      const txt = MENSAGENS.alertaFinal(cliente, vendedorRaw);
      if (await auditarAlerta("18h", cliente, vendedorRaw, txt, textoCliente)) {
        alertState[key] = 18;
        await enviarMensagem(vendedorNum, txt);
        setTimeout(async () => {
          const t2 = MENSAGENS.alertaGestores(cliente, vendedorRaw);
          if (await auditarAlerta("18h-gestores", cliente, vendedorRaw, t2, textoCliente)) {
            await enviarMensagem(GRUPO_GESTORES_ID, t2);
          }
        }, 10 * 60 * 1000);
      }
    }

    // Fechamento
    if (hasText && detectarFechamento(textoCliente)) {
      const txt = `🔔 *Sinal de fechamento detectado*\n\nO cliente *${cliente}* indicou possível fechamento.`;
      if (await auditarAlerta("fechamento", cliente, vendedorRaw, txt, textoCliente)) {
        await enviarMensagem(vendedorNum, txt);
      }
    }

    // Anexos
    if (hasAttach) {
      const tipo = msg.attachments[0].type === "audio" ? "Áudio" : msg.attachments[0].type === "image" ? "Imagem" : "Documento";
      const txt = `📎 *${tipo} recebido de ${cliente}*\n\nValide o conteúdo e confirme itens do orçamento.`;
      if (await auditarAlerta("attachment", cliente, vendedorRaw, txt, textoCliente)) {
        await enviarMensagem(vendedorNum, txt);
      }
    }

    res.json({ status: "ok" });
  } catch (err) {
    console.error("[ERRO]", err);
    res.status(500).json({ error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
