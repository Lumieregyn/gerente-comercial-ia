const express = require("express");
const router = express.Router();
const { perguntarViaIA } = require("../servicos/perguntarViaIA");
const { processarConversaComercial } = require("../servicos/detectarIntencao");

function isGestor(numero) {
  const numerosGestores = [
    "+554731703288", // Exemplo
    "+5547999999999"
  ];
  return numerosGestores.includes(numero);
}

router.post("/", async (req, res) => {
  const { nome, numero, mensagem } = req.body;

  if (isGestor(numero) && mensagem.includes("?")) {
    await perguntarViaIA({ textoPergunta: mensagem, numeroGestor: numero });
    return res.sendStatus(200);
  }

  await processarConversaComercial({ nome, numero, mensagem });
  res.sendStatus(200);
});

module.exports = router;
