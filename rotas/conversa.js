const express = require("express");
const router = express.Router();
const { perguntarViaIA } = require("../servicos/perguntarViaIA");

function isGestor(numero) {
  const numerosGestores = [
    "+554731703288", // exemplo
    "+5547999999999"
  ];
  return numerosGestores.includes(numero);
}

router.post("/", async (req, res, next) => {
  try {
    const payload = req.body.payload;
    if (
      !payload ||
      !payload.user ||
      !(payload.message || payload.Message) ||
      !payload.channel
    ) {
      console.warn("[ROTA /conversa] Payload inválido:", req.body);
      return res.status(400).json({ error: "Payload incompleto" });
    }

    const message = payload.message || payload.Message;
    const user    = payload.user;
    const texto   = message.text || message.caption || "[attachment]";
    const numeroUser = "+" + (user.Phone || "");

    // ✅ Se for GESTOR e conter "?" → pergunta a ser interpretada pela IA
    if (isGestor(numeroUser) && texto.includes("?")) {
      console.log("[IA GESTOR] Interpretando pergunta via IA:", texto);
      await perguntarViaIA({ textoPergunta: texto, numeroGestor: numeroUser });
      return res.json({ status: "Pergunta do gestor respondida via IA" });
    }

    // 👉 Continua para o fluxo normal (cliente/vendedor)
    next();

  } catch (err) {
    console.error("[ERRO /conversa]", err.message);
    res.status(500).json({ error: "Erro interno na análise de gestor." });
  }
});

module.exports = router;
