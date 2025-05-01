
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();
const app = express();

app.use(bodyParser.json());

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

app.post("/conversa", async (req, res) => {
  try {
    const payload = req.body?.payload;
    if (!payload || !payload.user || !payload.attendant || !payload.message?.text) {
      return res.status(400).json({ error: "Payload incompleto." });
    }

    const nomeCliente = payload.user.Name;
    const nomeVendedor = payload.attendant.Name?.trim().toLowerCase();
    const textoMensagem = payload.message.text;

    const numeroVendedor = VENDEDORES[nomeVendedor];

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado. Nenhuma mensagem enviada." });
    }

    const mensagem = `🤖 *Alerta IA:* Mensagem do cliente ${nomeCliente}: "${textoMensagem}"`;
    const resposta = await axios.post(`${process.env.WPP_URL}/send-message`, {
      number: numeroVendedor,
      message: mensagem,
    });

    console.log("Resposta da API:", resposta.data);
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
