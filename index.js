const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Ambiente
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Mapeamento de vendedores
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Mensagens aprovadas
const MENSAGENS = {
  alerta1: (c, v) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\n` +
    `Prezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\n` +
    `Solicitamos atenção para concluir o atendimento o quanto antes.\n` +
    `Agradecemos pela colaboração.`,
  alerta2: (c, v) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\n` +
    `Prezada(o) *${v}*, reforçamos que o cliente *${c}* permanece aguardando orçamento há 12h úteis.\n` +
    `Solicitamos providências imediatas para evitar impacto negativo no atendimento.`,
  alertaFinal: (c, v) =>
    `‼️ *Último Alerta (18h úteis)*\n\n` +
    `Prezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.\n` +
    `Você tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (c, v) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\n` +
    `Cliente *${c}* segue sem retorno após 18h úteis.\n` +
    `Responsável: *${v}*\n\n` +
    `⚠️ Por favor, verificar esse caso com urgência.`
};

// Calcula horas úteis
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
  console.log(`[ENVIO] Para: ${numero} | Texto: ${texto}`);
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, {
      number: numero,
      message: texto
    });
    console.log(`[OK] Mensagem enviada para ${numero}`);
  } catch (err) {
    console.error("[ERRO] Falha no envio:", err.response?.data || err.message);
  }
}

// Transcrever áudio
async function transcreverAudio(url) {
  console.log(`[AUDIO] Iniciando transcrição de: ${url}`);
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const form = new FormData();
    form.append("file", Buffer.from(resp.data), {
      filename: "audio.ogg",
      contentType: "audio/ogg"
    });
    form.append("model", "whisper-1");
    const result = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    console.log(`[TRANSCRIÇÃO] ${result.data.text}`);
    return result.data.text;
  } catch (err) {
    console.error("[ERRO] Transcrição de áudio falhou:", err.response?.data || err.message);
    return null;
  }
}

// Extrair texto de PDF
async function extrairTextoPdf(url) {
  console.log(`[PDF] Iniciando extração de: ${url}`);
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const data = await pdfParse(Buffer.from(resp.data));
    console.log(`[PDF TEXTO] ${data.text.substring(0, 200)}...`);
    return data.text;
  } catch (err) {
    console.error("[ERRO] Leitura de PDF falhou:", err.message);
    return null;
  }
}

// Verifica se cliente aguarda orçamento
async function isWaitingForQuote(cliente, mensagem, contexto) {
  console.log(`[AI] Analisando intenção: "${mensagem}" + contexto...`);
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é Gerente Comercial IA. Detecte se cliente aguarda orçamento." },
        { role: "user", content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto ? `\nContexto: ${contexto}` : ''}` }
      ]
    });
    const reply = completion.choices[0].message.content.toLowerCase();
    console.log(`[AI] Resposta IA: ${reply}`);
    return /sim|aguard|precisa/.test(reply);
  } catch (err) {
    console.error("[ERRO] IA falhou:", err);
    return false;
  }
}

// Endpoint
app.post("/conversa", async (req, res) => {
  try {
    const { payload } = req.body;
    console.log("[RAW PAYLOAD]", JSON.stringify(payload, null, 2));
    if (!payload || !payload.user || !payload.attendant || !payload.message) {
      console.error("[ERRO] Payload incompleto");
      return res.status(400).json({ error: "Payload incompleto." });
    }

    const nomeCliente = payload.user.Name;
    const nomeVendedor = payload.attendant.Name;
    const msg = payload.message;
    const textoMensagem = msg.text || msg.caption || "[attachment]";
    console.log(`[LOG] Nova mensagem de ${nomeCliente}: "${textoMensagem}"`);

    let contextoExtra = "";
    if (msg.type === "audio" && msg.payload?.url) {
      const t = await transcreverAudio(msg.payload.url);
      if (t) contextoExtra += t;
    }
    if (msg.type === "file" && msg.payload?.url && msg.payload.FileName?.endsWith(".pdf")) {
      const t = await extrairTextoPdf(msg.payload.url);
      if (t) contextoExtra += t;
    }

    const aguardando = await isWaitingForQuote(nomeCliente, textoMensagem, contextoExtra);
    if (!aguardando) {
      console.log("[INFO] Cliente não aguarda orçamento.");
      return res.json({ status: "sem ação" });
    }

    const criadoEm = new Date(payload.message.CreatedAt || payload.timestamp);
    const horas = horasUteisEntreDatas(criadoEm, new Date());
    const numeroVendedor = VENDEDORES[nomeVendedor.trim().toLowerCase()];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não mapeado.`);
      return res.json({ warning: "vendedor não mapeado" });
    }

    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, nomeVendedor));
      setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, nomeVendedor)), 10*60*1000);
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeCliente, nomeVendedor));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeCliente, nomeVendedor));
    }

    return res.json({ status: "processado" });
  } catch (err) {
    console.error("[ERRO] Falha ao processar:", err);
    return res.status(500).json({ error: "erro interno" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
