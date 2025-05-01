const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory state to dedupe alerts
const alertState = {}; // key: `${cliente}_${vendedor}`, value: last nível enviado

app.use(bodyParser.json({
  verify: (req, res, buf, encoding) => { req.rawBody = buf.toString(encoding || "utf8"); }
}));
app.use(bodyParser.urlencoded({
  extended: true,
  verify: (req, res, buf, encoding) => { req.rawBody = buf.toString(encoding || "utf8"); }
}));

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

const MENSAGENS = {
  alerta1: (c, v) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\n` +
    `Prezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\n` +
    `Por favor, retome o atendimento!`,
  alerta2: (c, v) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\n` +
    `Prezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 12h úteis.\n` +
    `Providencie retorno imediato!`,
  alertaFinal: (c, v) =>
    `🚨 *Último Alerta (18h úteis)*\n\n` +
    `Prezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 18h úteis.\n` +
    `Você tem 10 minutos para responder ou será escalado à gestão.`,
  alertaGestores: (c, v) =>
    `🚨 *Alerta Crítico*\n\n` +
    `O cliente *${c}* aguardou orçamento 18h úteis e não houve resposta de *${v}*.\n` +
    `Providências urgentes!`
};

function horasUteisEntreDatas(inicio, fim) {
  let start = new Date(inicio), end = new Date(fim), horas = 0;
  while (start < end) {
    const h = start.getHours(), d = start.getDay();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) horas++;
    start.setHours(start.getHours() + 1);
  }
  return horas;
}

async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${process.env.WPP_URL}/send-message`, {
      number: numero,
      message: texto,
    });
  } catch (err) {
    console.error("Erro ao enviar:", err.response?.data || err.message);
  }
}

async function auditarAlerta(tipo, cliente, vendedor, texto) {
  const prompt = `
Você é a Gerente Comercial IA da LumièreGyn.
Contexto: cliente "${cliente}", vendedor "${vendedor}", tipo de alerta: ${tipo}.
Mensagem proposta:
"${texto}"
Responda apenas "SIM" se este alerta deve ser enviado agora, ou "NÃO" caso contrário.
`.trim();
  const comp = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
  });
  const resp = comp.choices[0].message.content.trim().toUpperCase();
  return resp.startsWith("SIM");
}

function detectarFechamento(txt) {
  const sinais = ["fechado","vamos fechar","então tá combinado","então tá certo"];
  return sinais.some(s => txt.toLowerCase().includes(s));
}

app.post("/conversa", async (req, res) => {
  console.log("[RAW BODY]", req.rawBody);
  try {
    const payload = req.body?.payload;
    if (!payload?.user || !payload?.attendant) {
      return res.status(400).json({ error: "Payload incompleto." });
    }
    const msg = payload.message || payload.Message || {};
    const hasText = !!msg.text;
    const hasAttach = Array.isArray(msg.attachments) && msg.attachments.length > 0;
    if (!hasText && !hasAttach) {
      return res.status(400).json({ error: "Sem texto ou attachments." });
    }

    const cliente = payload.user.Name;
    const vendedorRaw = payload.attendant.Name.trim();
    const key = `${cliente}_${vendedorRaw}`.toLowerCase();
    const vendedorNum = VENDEDORES[vendedorRaw.toLowerCase()];
    if (!vendedorNum) {
      return res.json({ warning: "Vendedor não mapeado." });
    }

    const timeRaw = msg.CreatedAt || req.body.timestamp;
    const criadoEm = new Date(timeRaw);
    const horas = horasUteisEntreDatas(criadoEm, new Date());
    const last = alertState[key] || 0;

    // 6h
    if (horas >= 6 && last < 6) {
      const texto = MENSAGENS.alerta1(cliente, vendedorRaw);
      if (await auditarAlerta("6h", cliente, vendedorRaw, texto)) {
        alertState[key] = 6;
        await enviarMensagem(vendedorNum, texto);
      }
    }
    // 12h
    else if (horas >= 12 && last < 12) {
      const texto = MENSAGENS.alerta2(cliente, vendedorRaw);
      if (await auditarAlerta("12h", cliente, vendedorRaw, texto)) {
        alertState[key] = 12;
        await enviarMensagem(vendedorNum, texto);
      }
    }
    // 18h
    else if (horas >= 18 && last < 18) {
      const texto = MENSAGENS.alertaFinal(cliente, vendedorRaw);
      if (await auditarAlerta("18h", cliente, vendedorRaw, texto)) {
        alertState[key] = 18;
        await enviarMensagem(vendedorNum, texto);
        setTimeout(async () => {
          const t2 = MENSAGENS.alertaGestores(cliente, vendedorRaw);
          if (await auditarAlerta("18h-gestores", cliente, vendedorRaw, t2)) {
            await enviarMensagem(GRUPO_GESTORES_ID, t2);
          }
        }, 10 * 60 * 1000);
      }
    }

    // fechamento detectado
    if (hasText && detectarFechamento(msg.text)) {
      const texto = `🔔 *Sinal de fechamento detectado*\n\nO cliente *${cliente}* indicou fechamento.`;
      if (await auditarAlerta("fechamento", cliente, vendedorRaw, texto)) {
        await enviarMensagem(vendedorNum, texto);
      }
    }

    // attachment crítico
    if (hasAttach) {
      const tipo = msg.attachments[0].type === "audio" ? "Áudio"
                 : msg.attachments[0].type === "image" ? "Imagem"
                 : "Documento";
      const texto = `📎 *${tipo} recebido de ${cliente}*\n\nValide o conteúdo e confirme itens do orçamento.`;
      if (await auditarAlerta("attachment", cliente, vendedorRaw, texto)) {
        await enviarMensagem(vendedorNum, texto);
      }
    }

    res.json({ status: "Mensagem processada com sucesso." });
  } catch (err) {
    console.error("[ERRO]", err);
    res.status(500).json({ error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
