const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();
const app = express();

// Body parsers with rawBody capture
app.use(bodyParser.json({
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding || "utf8");
  }
}));
app.use(bodyParser.urlencoded({
  extended: true,
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding || "utf8");
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
    `⚠️ *Alerta de Atraso - Orçamento*\n\n` +
    `O cliente *${cliente}* ainda não teve retorno após 6h úteis.\n` +
    `Vendedor responsável: *${vendedor}*.\n\n` +
    `Por favor, retome o contato imediatamente!`,
  alerta2: (cliente, vendedor) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\n` +
    `O cliente *${cliente}* continua sem resposta após 12h úteis.\n` +
    `Vendedor: *${vendedor}*.`,
  alertaFinal: (cliente, vendedor) =>
    `‼️ *Último Alerta (18h úteis)*\n\n` +
    `Cliente *${cliente}* não teve retorno mesmo após 18h úteis.\n` +
    `Vendedor: *${vendedor}*\n\n` +
    `Você tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (cliente, vendedor) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\n` +
    `Cliente *${cliente}* segue sem retorno após 18h úteis.\n` +
    `Responsável: *${vendedor}*\n\n` +
    `⚠️ Por favor, verificar esse caso com urgência.`
};

function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const current = new Date(start);
  while (current < end) {
    const h = current.getHours();
    const d = current.getDay();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) {
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

function contemArquivoCritico(msg) {
  return Array.isArray(msg.attachments) && msg.attachments.length > 0;
}

app.post("/conversa", async (req, res) => {
  console.log("[RAW BODY]", req.rawBody);

  try {
    const payload = req.body?.payload;
    if (!payload || !payload.user || !payload.attendant) {
      console.error("[ERRO] Payload incompleto:", req.rawBody);
      return res.status(400).json({ error: "Payload incompleto." });
    }

    // fallback para 'message' minúsculo ou 'Message' maiúsculo
    const msg = payload.message || payload.Message || {};
    const hasText = !!msg.text;
    const hasAttach = contemArquivoCritico(msg);

    if (!hasText && !hasAttach) {
      console.error("[ERRO] Sem texto ou attachments:", req.rawBody);
      return res.status(400).json({ error: "Payload incompleto." });
    }

    const nomeCliente = payload.user.Name;
    const nomeVendedorKey = payload.attendant.Name.toLowerCase().trim();
    const numeroVendedor = VENDEDORES[nomeVendedorKey];

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${msg.text || '[attachment]'}"`);

    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${payload.attendant.Name}" não mapeado.`);
      return res.json({ warning: "Vendedor não mapeado. Nenhuma mensagem enviada." });
    }

    const criadoEm = new Date(msg.CreatedAt || Date.now() - 19 * 60 * 60 * 1000);
    const agora = new Date();
    const horas = horasUteisEntreDatas(criadoEm, agora);

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

    if (detectarFechamento(msg.text || "")) {
      await enviarMensagem(numeroVendedor,
        `🔔 *Sinal de fechamento detectado*\n\n` +
        `O cliente *${nomeCliente}* indicou possível fechamento. Reforce o contato e envie o orçamento formal.`
      );
    }

    if (hasAttach) {
      const tipo = msg.attachments[0].type === "audio" ? "🎙️ Áudio"
                 : msg.attachments[0].type === "image" ? "🖼️ Imagem"
                 : "📄 Documento";
      await enviarMensagem(numeroVendedor,
        `📎 *${tipo} recebido de ${nomeCliente}*\n\n` +
        `Não se esqueça de validar o conteúdo e confirmar todos os itens do orçamento com o cliente.`
      );
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
