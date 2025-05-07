const axios = require("axios");

const WPP_URL = process.env.WPP_URL;

async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido para envio: ${numero}`);
    return;
  }

  try {
    await axios.post(`${WPP_URL}/send-message`, {
      number: numero,
      message: texto
    });
    console.log(`[WPP] Mensagem enviada para ${numero}`);
  } catch (err) {
    console.error("[ERRO WPP]", err.response?.data || err.message);
  }
}

module.exports = { enviarMensagem };
