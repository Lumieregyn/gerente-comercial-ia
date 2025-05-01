// index.js

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { Configuration, OpenAIApi } = require("openai");
const pdfParse = require("pdf-parse");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

//
// Inicializa OpenAI
//
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

//
// Configuração de contatos
//
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

//
// Mensagens padronizadas
//
const MENSAGENS = {
  alerta1: (c, v) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\n` +
    `Prezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\n` +
    `Solicitamos atenção para concluir o atendimento o quanto antes.\n` +
    `Agradecemos pela colaboração.`,
  alerta2: (c, v) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\n` +
    `Prezada(o) *${v}*, reforçamos que o cliente *${c}* permanece aguardando o orçamento há 12h úteis.\n` +
    `Solicitamos providências imediatas.\n` +
    `Aguardamos seu retorno.`,
  alertaFinal: (c, v) =>
    `🚨 *Último Alerta (18h úteis)*\n\n` +
    `Prezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.\n` +
    `Você tem 10 minutos para responder esta mensagem. Caso contrário, o atendimento será transferido e registrado junto à Gerência Comercial IA.`,
  alertaGestores: (c, v) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\n` +
    `O cliente *${c}* segue sem retorno após 18h úteis. Responsável: *${v}*.\n\n` +
    `⚠️ Por favor, verificar esse caso com urgência.`
};

//
// Calcula horas úteis entre duas datas
//
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

//
// Envia mensagem via WppConnect
//
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: "${numero}"`);
    return;
  }
  try {
    await axios.post(`${process.env.WPP_URL}/send-message`, {
      number: numero,
      message: texto,
    });
    console.log(`Mensagem enviada para ${numero}: ${texto}`);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

//
// Baixa arquivo (imagem, áudio, pdf) e salva localmente
//
async function baixarArquivo(url, nomeLocal) {
  const writer = fs.createWriteStream(nomeLocal);
  const response = await axios.get(url, { responseType: "stream" });
  response.data.pipe(writer);
  return new Promise((res, rej) => {
    writer.on("finish", res);
    writer.on("error", rej);
  });
}

//
// Transcreve áudio via Whisper
//
async function transcreverAudio(url) {
  const tmpPath = path.join(__dirname, "tmp_audio.ogg");
  await baixarArquivo(url, tmpPath);
  const resp = await openai.createTranscription(
    fs.createReadStream(tmpPath),
    "whisper-1"
  );
  fs.unlinkSync(tmpPath);
  return resp.data.text;
}

//
// Extrai texto de PDF
//
async function extrairPdf(url) {
  const tmpPath = path.join(__dirname, "tmp.pdf");
  await baixarArquivo(url, tmpPath);
  const data = fs.readFileSync(tmpPath);
  const pdf = await pdfParse(data);
  fs.unlinkSync(tmpPath);
  return pdf.text;
}

//
// Detecta intenção de fechamento
//
function detectarFechamento(texto) {
  const sinais = [
    "vamos fechar",
    "pode seguir",
    "aprovado",
    "quero esse modelo",
    "orçamento aprovado"
  ];
  return sinais.some(s => texto.toLowerCase().includes(s));
}

//
// Rota de webhook
//
app.post("/conversa", async (req, res) => {
  try {
    const body = req.body;
    const p = body.payload;
    if (!p || !p.user || !p.attendant) {
      console.warn("[ERRO] Payload incompleto:", JSON.stringify(body));
      return res.status(400).json({ error: "Payload incompleto." });
    }

    const cliente = p.user.Name;
    const vendedorNome = p.attendant.Name.trim().toLowerCase();
    const msg = p.message;
    const texto = msg.text || "";
    const tipo = msg.type || "text";
    const criado = msg.CreatedAt ? new Date(msg.CreatedAt) : new Date(Date.now() - 19*3600*1000);
    const horas = horasUteisEntreDatas(criado, new Date());

    console.log(`[LOG] Nova mensagem recebida de ${cliente}: "${texto || "[attachment]"}"`);

    const numeroVend = VENDEDORES[vendedorNome];
    if (!numeroVend) {
      console.warn(`[ERRO] Vendedor "${p.attendant.Name}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    // primeiro, se for áudio: transcreve e loga
    if (tipo === "audio") {
      const txt = await transcreverAudio(msg.payload.url);
      console.log("[TRANSCRIÇÃO]", txt);
      // passa agora o texto transcrito para IA, se quiser
    }

    // se for PDF, extrai texto e loga
    if (tipo === "file" && msg.payload.url.toLowerCase().endsWith(".pdf")) {
      const conteudo = await extrairPdf(msg.payload.url);
      console.log("[PDF EXTRAÍDO]", conteudo.slice(0,200) + "…");
      // pode passar para análise de IA
    }

    // alerta de orçamento
    if (horas >= 18) {
      await enviarMensagem(numeroVend, MENSAGENS.alertaFinal(cliente, p.attendant.Name));
      setTimeout(() => {
        enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(cliente, p.attendant.Name));
      }, 10*60*1000);
    } else if (horas >= 12) {
      await enviarMensagem(numeroVend, MENSAGENS.alerta2(cliente, p.attendant.Name));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVend, MENSAGENS.alerta1(cliente, p.attendant.Name));
    }

    // sinal de fechamento
    if (detectarFechamento(texto)) {
      await enviarMensagem(
        numeroVend,
        `🔔 *Sinal de fechamento detectado*\n\nO cliente *${cliente}* indicou possível fechamento. Reforce o contato e formalize o orçamento.`
      );
    }

    // anexos críticos (imagem, arquivo não-PDF)
    if (["image","document","file"].includes(tipo) && !msg.payload.url.toLowerCase().endsWith(".pdf")) {
      const label = tipo === "image" ? "🖼️ Imagem" : "📎 Arquivo";
      await enviarMensagem(
        numeroVend,
        `${label} recebido de *${cliente}*.\nNão esqueça de validar o conteúdo e confirmar todos os itens do orçamento.`
      );
    }

    return res.json({ status: "ok" });
  } catch (err) {
    console.error("[ERRO] Falha ao processar conversa:", err);
    return res.status(500).json({ error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Servidor do Gerente Comercial IA rodando na porta", PORT)
);
