
// index.js gerado com base nos 10 blocos aprovados
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();
const { analisarMensagemComIA } = require("./inteligencia/motor-inteligente");

const app = express();
app.use(bodyParser.json());

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
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

app.post("/conversa", async (req, res) => {
  try {
    const payload = req.body?.payload;
    if (!payload || !payload.user || !payload.attendant || !payload.message?.text) {
      return res.status(400).json({ error: "Payload incompleto." });
    }

    const nomeCliente = payload.user.Name;
    const nomeVendedor = payload.attendant.Name?.toLowerCase().trim();
    const textoMensagem = payload.message.text;
    const criadoEm = new Date(payload.message.CreatedAt || Date.now() - 19 * 60 * 60 * 1000);
    const agora = new Date();
    const horas = horasUteisEntreDatas(criadoEm, agora);
    const numeroVendedor = VENDEDORES[nomeVendedor];

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado. Nenhuma mensagem enviada." });
    }

    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, `🚨 Prezado(a) ${nomeVendedor}, o cliente ${nomeCliente} está há 18 horas úteis aguardando orçamento. Você tem 10 minutos para responder esta mensagem.`);
      setTimeout(() => {
        enviarMensagem(GRUPO_GESTORES_ID, `🚨 Atenção Gerência Comercial IA:
O cliente ${nomeCliente} permaneceu 18 horas sem receber o orçamento e o vendedor não respondeu no prazo de 10 minutos.`);
      }, 10 * 60 * 1000);
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, `⚠️ Prezado(a) ${nomeVendedor}, o cliente ${nomeCliente} permanece aguardando o orçamento há 12 horas úteis. Providências imediatas são necessárias.`);
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, `⚠️ Prezado(a) ${nomeVendedor}, informamos que o cliente ${nomeCliente} está há 6 horas úteis aguardando o orçamento. Por favor, conclua o atendimento.`);
    }

    const analise = await analisarMensagemComIA(nomeCliente, nomeVendedor, textoMensagem);
    if (analise?.mensagemFinal) {
      await enviarMensagem(numeroVendedor, analise.mensagemFinal);
    }

    res.json({ status: "Processado com sucesso" });
  } catch (err) {
    console.error("[ERRO] Falha ao processar conversa:", err);
    res.status(500).json({ error: "Erro interno ao processar a mensagem." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor do Gerente Comercial IA rodando na porta", PORT);
});
