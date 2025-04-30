
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const app = express();
require("dotenv").config();

app.use(bodyParser.json());

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;
const VENDEDORES = {
  "cindy loren": "62994671766",
  "ana clara martins": "62991899053",
  "emily sequeira": "62981704171"
};

const MENSAGENS = {
  alerta1: (cliente, vendedor) =>
    `⚠️ *Alerta de Atraso - Orçamento*

O cliente *${cliente}* ainda não teve retorno após 6h úteis.
Vendedor responsável: *${vendedor}*.

Por favor, retome o contato imediatamente!`,
  alerta2: (cliente, vendedor) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*

O cliente *${cliente}* continua sem resposta após 12h úteis.
Vendedor: *${vendedor}*.`,
  alertaFinal: (cliente, vendedor) =>
    `‼️ *Último Alerta (18h úteis)*

Cliente *${cliente}* não teve retorno mesmo após 18h úteis.
Vendedor: *${vendedor}*

Será enviado um alerta à gestão em *10 minutos* se não houver resposta.`,
  alertaGestores: (cliente, vendedor) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*

Cliente *${cliente}* segue sem retorno após 18h úteis.
Responsável: *${vendedor}*

⚠️ Por favor, verificar esse caso com urgência.`
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
  return payload.message?.type === "document" || payload.message?.type === "image" || payload.message?.type === "audio";
}

app.post("/conversa", async (req, res) => {
  try {
    const payload = req.body?.payload;
    if (!payload || !payload.user || !payload.attendant || !payload.message?.text) {
      return res.status(400).json({ error: "Payload incompleto." });
    }

    const nomeCliente = payload.user.Name;
    const nomeVendedorOriginal = payload.attendant.Name || "";
    const nomeVendedor = nomeVendedorOriginal.toLowerCase().trim();
    const textoMensagem = payload.message.text;
    const tipoMensagem = payload.message.type || "text";
    const criadoEm = new Date(payload.message.CreatedAt || Date.now() - 19 * 60 * 60 * 1000);
    const agora = new Date();
    const horas = horasUteisEntreDatas(criadoEm, agora);
    const numeroVendedor = VENDEDORES[nomeVendedor];

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedorOriginal}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado. Nenhuma mensagem enviada." });
    }

    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, nomeVendedorOriginal));
      setTimeout(() => {
        enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, nomeVendedorOriginal));
      }, 10 * 60 * 1000);
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeCliente, nomeVendedorOriginal));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeCliente, nomeVendedorOriginal));
    }

    if (detectarFechamento(textoMensagem)) {
      await enviarMensagem(numeroVendedor, `🔔 *Sinal de fechamento detectado*

O cliente *${nomeCliente}* indicou possível fechamento. Reforce o contato e envie o orçamento formal.`);
    }

    if (contemArquivoCritico(payload)) {
      const tipo = tipoMensagem === "audio" ? "🎙️ Áudio" : tipoMensagem === "image" ? "🖼️ Imagem" : "📄 Documento";
      await enviarMensagem(numeroVendedor, `📎 *${tipo} recebido de ${nomeCliente}*

Não se esqueça de validar o conteúdo e confirmar todos os itens do orçamento com o cliente.`);
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
