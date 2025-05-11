// rotas/conversa.js
const express = require("express");
const router = express.Router();
const { perguntarViaIA } = require("../servicos/perguntarViaIA");

function isGestor(numero) {
  const numerosGestores = [
    "+554731703288", // Exemplo
    "+5547999999999"
  ];
  return numerosGestores.includes(numero);
}

router.post("/", async (req, res, next) => {
  try {
    const payload = req.body.payload;
    const message = payload?.message || payload?.Message;
    const numero = payload?.user?.Phone;
    const texto = message?.text || message?.caption || "";

    if (numero && texto && isGestor("+" + numero) && texto.includes("?")) {
      await perguntarViaIA({ textoPergunta: texto, numeroGestor: "+" + numero });
      return res.json({ status: "Consulta do gestor processada via IA" });
    }

    next(); // continua para o fluxo normal do index.js se não for pergunta de gestor
  } catch (err) {
    console.error("[ERRO ROTAS/CONVERSA]", err);
    res.status(500).json({ error: "Erro interno na análise de gestor." });
  }
});

module.exports = router;
