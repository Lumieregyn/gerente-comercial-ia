const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const { analisarMensagem } = require("./inteligencia/motor-inteligente");

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

async function enviarMensagem(numero, texto) {
  if (!numero) return;
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
    const nomeVendedor = (payload.attendant.Name || "").toLowerCase().trim();
    const textoMensagem = payload.message.text;

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    const numeroVendedor = VENDEDORES[nomeVendedor];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.status(200).json({ warning: "Vendedor não mapeado. Nenhuma mensagem enviada." });
    }

    const respostaIA = await analisarMensagem(textoMensagem, nomeCliente, nomeVendedor);
    if (respostaIA) {
      await enviarMensagem(numeroVendedor, respostaIA);
    } else {
      console.log("[IA] Sem alerta necessário para", nomeVendedor);
    }

    res.status(200).json({ status: "Processado com sucesso", alerta: !!respostaIA });
  } catch (err) {
    console.error("[ERRO] Falha ao processar conversa:", err);
    res.status(500).json({ error: "Erro interno ao processar a mensagem." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor do Gerente Comercial IA rodando na porta", PORT);
});
