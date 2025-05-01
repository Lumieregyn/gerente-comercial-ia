const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const app = express();
require("dotenv").config();
const { analisarMensagemComIA } = require("./inteligencia/motor-inteligente");

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
    const nomeVendedor = payload.attendant.Name;
    const textoMensagem = payload.message.text;
    const criadoEm = new Date(payload.message.CreatedAt || Date.now() - 19 * 60 * 60 * 1000);
    const agora = new Date();
    const horas = horasUteisEntreDatas(criadoEm, agora);
    const numeroVendedor = VENDEDORES[nomeVendedor.toLowerCase()];

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado. Nenhuma mensagem enviada." });
    }

    // Análise inteligente com IA
    const resultadoIA = await analisarMensagemComIA(payload);
    console.log("[ANÁLISE IA]:", resultadoIA);

    // Exemplo de alerta simples com IA
    if (resultadoIA.toLowerCase().includes("pendência") || resultadoIA.toLowerCase().includes("corrigir")) {
      await enviarMensagem(numeroVendedor, `🤖 *Alerta IA:* ${resultadoIA}`);
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
