// index.js
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
const Tesseract = require("tesseract.js");
const fs = require("fs");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

const VENDEDORES = JSON.parse(fs.readFileSync("./vendedores.json", "utf8"));
const statusAlerta = {};

const MENSAGENS = {
  alerta1: (c, v) =>
    `⚠️ Prezado(a) ${v}, informamos que o cliente ${c} encontra-se há 6 horas úteis aguardando o orçamento solicitado.
Solicitamos atenção para concluir o atendimento o quanto antes.
Agradecemos pela colaboração.`,
  alerta2: (c, v) =>
    `⚠️ Prezado(a) ${v}, reforçamos que o cliente ${c} permanece aguardando o orçamento há 12 horas úteis.
Solicitamos providências imediatas para evitar impacto negativo no atendimento.
Aguardamos seu retorno.`,
  alertaFinal: (c, v) =>
    `🚨 Prezado(a) ${v}, o cliente ${c} está há 18 horas úteis aguardando orçamento.
Você tem 10 minutos para responder esta mensagem.
Caso contrário, o atendimento será transferido e a situação será registrada junto à Gerência Comercial IA.`,
  alertaGestores: (c) =>
    `🚨 Atenção Gerência Comercial IA:
O cliente ${c} permaneceu 18 horas sem receber o orçamento solicitado e o vendedor não respondeu no prazo de 10 minutos.
Providências serão tomadas quanto à redistribuição do atendimento.`
};

function normalizeNome(nome = "") {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function obterNumeroVendedor(nomeRaw) {
  const nome = normalizeNome(nomeRaw);
  const numero = VENDEDORES[nome];
  if (!numero) {
    console.warn(`[ERRO] Vendedor não mapeado: "${nomeRaw}"`);
  }
  return numero;
}

async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

async function isFechamentoConfirmado(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Você é uma IA treinada para detectar se o cliente manifestou intenção clara de fechamento de pedido de venda. Analise com base no histórico e contexto, sem depender de frases exatas."
        },
        {
          role: "user",
          content: `Cliente: ${cliente}
Mensagem: ${mensagem}${contexto ? "
Contexto: " + contexto : ""}`
        }
      ]
    });
    const reply = completion.choices[0].message.content.toLowerCase();
    return reply.includes("sim") || reply.includes("fechamento") || reply.includes("pedido confirmado");
  } catch (err) {
    console.error("[ERRO] Verificação de fechamento falhou:", err.message);
    return false;
  }
}
const { verificarDivergenciaVisual } = require("./inteligencia/motor-da-inteligencia");

async function executarChecklistFinal(cliente, contexto, descricaoImagem, descricaoPDF, numeroVendedor) {
  console.log(`[CHECKLIST] Iniciando checklist completo para ${cliente}...`);

  const checklistItens = [
    "imagem do produto",
    "cor",
    "modelo",
    "tensão (110v/220v)",
    "prazo de produção e entrega",
    "formalização clara para produtos não cadastrados"
  ];

  for (const item of checklistItens) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Você é um sistema de checklist técnico para vendas. Diga se o seguinte ponto está corretamente informado no atendimento. Responda de forma breve com SIM ou NÃO e, se necessário, explique o que está faltando.`
          },
          {
            role: "user",
            content: `Cliente: ${cliente}

Verifique o seguinte item: ${item}

Contexto completo da conversa: ${contexto}`
          }
        ]
      });
      const resposta = completion.choices[0].message.content;
      console.log(`[CHECKLIST][${item}] → ${resposta}`);
    } catch (err) {
      console.error(`[CHECKLIST ERRO] Falha ao verificar "${item}":`, err.message);
    }
  }

  if (descricaoImagem && descricaoPDF) {
    const divergencia = await verificarDivergenciaVisual(descricaoImagem, descricaoPDF, cliente);
    if (divergencia) {
      const alertaImagem = `📸⚠️ Atenção: Identificamos uma possível divergência entre a imagem enviada pelo cliente e o item orçado.

${divergencia}

Produto enviado: ${descricaoImagem}
Produto orçado: ${descricaoPDF}

👉 Por favor, revise com atenção para evitar problemas no pedido final.`;
      await enviarMensagem(numeroVendedor, alertaImagem);
    }
  }

  return true;
}

app.post("/conversa", async (req, res) => {
  try {
    const payload = req.body.payload;
    if (!payload || !payload.user || !(payload.message || payload.Message) || !payload.channel) {
      console.error("[ERRO] Payload incompleto ou evento não suportado:", req.body);
      return res.status(400).json({ error: "Payload incompleto ou evento não suportado" });
    }

    const message = payload.message || payload.Message;
    const user = payload.user;
    const nomeCliente = user.Name || "Cliente";
    const texto = message.text || message.caption || "[attachment]";
    const contextoExtra = JSON.stringify(payload);

    const nomeVendedorRaw = payload.attendant?.Name || "";
    const numeroVendedor = obterNumeroVendedor(nomeVendedorRaw);

    const fechamentoConfirmado = await isFechamentoConfirmado(nomeCliente, texto, contextoExtra);
    if (fechamentoConfirmado) {
      const descricaoImagem = "Luminária arandela dourada, estilo industrial, enviada pelo cliente.";
      const descricaoPDF = "Plafon preto moderno listado no orçamento.";
      await executarChecklistFinal(nomeCliente, contextoExtra, descricaoImagem, descricaoPDF, numeroVendedor);
    }

    res.status(200).json({ status: "Checklist executado (se aplicável)" });
  } catch (err) {
    console.error("[ERRO] Falha no fluxo de conversa:", err.message);
    res.status(500).json({ error: "Erro interno." });
  }
});

app.post("/resposta-vendedor", async (req, res) => {
  try {
    const { cliente, vendedor, mensagem } = req.body;
    const registro = statusAlerta[cliente];

    if (!registro || registro.status !== "enviado") {
      return res.status(200).json({ info: "Sem alerta pendente para esse cliente." });
    }

    const tempoResposta = Date.now() - registro.enviadoEm;
    const respondeuNoTempo = tempoResposta <= 10 * 60 * 1000;

    statusAlerta[cliente].status = respondeuNoTempo ? "respondido" : "atrasado";

    const textoResposta = `📩 ${vendedor}: ${mensagem}`;
    const prefixo = respondeuNoTempo ? "✅ Resposta dentro do prazo" : "⚠️ Resposta fora do prazo";

    const textoGrupo = `${prefixo} - Cliente ${cliente}

${textoResposta}`;
    await enviarMensagem(GRUPO_GESTORES_ID, textoGrupo);

    res.json({ status: "Resposta registrada e enviada ao grupo." });
  } catch (err) {
    console.error("[ERRO] Falha ao processar resposta do vendedor:", err.message);
    res.status(500).json({ error: "Erro interno." });
  }
});
