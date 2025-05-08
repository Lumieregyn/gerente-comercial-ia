const axios = require("axios");
const WPP_URL = process.env.WPP_URL;

async function enviarMensagem(numero, texto) {
  // detecta se é grupo (termina em @g.us) ou contato (11–13 dígitos)
  const isGroup = numero.endsWith("120363416457397022@g.us");
  const isPhone = /^[0-9]{11,13}$/.test(numero);

  if (!numero || (!isGroup && !isPhone)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }

  try {
    // número já vem formatado com @g.us ou sem sufixo
    await axios.post(`${WPP_URL}/send-message`, {
      number: numero,
      message: texto
    });
  } catch (err) {
    console.error("[ERRO] falha ao enviar pelo WppConnect:", err.response?.data || err.message);
  }
}

module.exports = { enviarMensagem };
