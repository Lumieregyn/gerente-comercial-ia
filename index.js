const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();
const app = express();

// Body parsers with rawBody capture
app.use(bodyParser.json({
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
}));
app.use(bodyParser.urlencoded({
  extended: true,
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
}));

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

const MENSAGENS = {
  alerta1: (cliente, vendedor) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\nO cliente *${cliente}* ainda não teve retorno após 6h úteis.\nVendedor responsável: *${vendedor}*.\n\nPor favor, retome o contato imediatamente!`,
  alerta2: (cliente, vendedor) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nO cliente *${cliente}* continua sem resposta após 12h úteis.\nVendedor: *${vendedor}*.`,
  alertaFinal: (cliente, vendedor) =>
    `‼️ *Último Alerta (18h úteis)*\n\nCliente *${cliente}* não teve retorno mesmo após 18h úteis.\nVendedor: *${vendedor}*\n\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (cliente, vendedor) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${cliente}* segue sem retorno após 18h úteis.\nResponsável: *${vendedor}*\n\n⚠️ Por favor, verificar esse caso com urgência.`
};

function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const current = new Date(start);
  while (current < end) {
    const hora = current.getHours();
    const dia = current.getDay();
    if (dia >= 1 && dia <= 5 && hora >= 8 && hora < 19) {
      horas++;
    }
    current.setHours(current.getHours() + 1);
  }
  return horas;
}

async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido ou ausente: "${numero}"`);
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

function detectarFechamento(mensagem) {
  const sinais = ["fechado", "vamos fechar", "então tá combinado", "então tá certo"];
  return sinais.some(palavra => mensagem.toLowerCase().includes(palavra));
}

function contemArquivoCritico(payload) {
  // Check for attachments array
  return payload.message?.attachments?.length > 0;
}

app.post("/conversa", async (req, res) => {
  // Log raw body for debugging
  console.log("[RAW BODY]", req.rawBody);

  try {
    const payload = req.body?.payload;
    const hasText = !!payload.message?.text;
    const hasAttach = payload.message?.attachments?.length > 0;

    if (!payload || !payload.user || !payload.attendant || (!hasText && !hasAttach)) {
      console.error("[ERRO] Payload incompleto:", req.rawBody);
      return res.status(400).json({ error: "Payload incompleto." });
    }

    const nomeCliente = payload.user.Name;
    const nomeVendedor = payload.attendant.Name.toLowerCase().trim();
    const textoMensagem = payload.message.text || "";
    const tipoMensagem = payload.message.type || (hasAttach ? payload.message.attachments[0].type : "text");
    const criadoEm = new Date(payload.message.CreatedAt || Date.now() - 19 * 60 * 60 * 1000);
    const agora = new Date();
    const horas = horasUteisEntreDatas(criadoEm, agora);
    const numeroVendedor = VENDEDORES[nomeVendedor];

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${payload.attendant.Name}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado. Nenhuma mensagem enviada." });
    }

    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, payload.attendant.Name));
      setTimeout(() => {
        enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, payload.attendant.Name));
      }, 10 * 60 * 1000);
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeCliente, payload.attendant.Name));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeCliente, payload.attendant.Name));
    }

    if (detectarFechamento(textoMensagem)) {
      await enviarMensagem(numeroVendedor,
        `🔔 *Sinal de fechamento detectado*\n\nO cliente *${nomeCliente}* indicou possível fechamento. Reforce o contato e envie o orçamento formal.`);
    }

    if (contemArquivoCritico(payload)) {
      const tipo = tipoMensagem === "audio"? "🎙️ Áudio" : tipoMensagem === "image"? "🖼️ Imagem": "📄 Documento";
      await enviarMensagem(numeroVendedor,
        `📎 *${tipo} recebido de ${nomeCliente}*\n\nNão se esqueça de validar o conteúdo e confirmar todos os itens do orçamento com o cliente.`);
    }

    res.json({ status: "Mensagem processada com sucesso." });
  } catch (err) {
    console.error("[ERRO] Falha ao processar conversa:", err);
    res.status(500).json({ error: "Erro interno ao processar a mensagem." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor do Gerente Comercial IA rodando na porta", PORT);
});
