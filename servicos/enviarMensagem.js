const axios = require("axios");
const WPP_URL = process.env.WPP_URL;

async function enviarMensagem(numero, texto) {
  // Se quisermos pausar todos os alertas, basta ativar PAUSE_ALERTS
  if (process.env.PAUSE_ALERTS === "true") {
    console.log(`[PAUSA] PAUSE_ALERTS ativo, não enviando mensagem para ${numero}`);
    return;
  }

  // detecta se é grupo (@g.us) ou contato puro
  const isGroup = numero.endsWith("@g.us");
  const isPhone = /^[0-9]{11,13}$/.test(numero);
  if (!numero || (!isGroup && !isPhone)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }

  try {
    await axios.post(`${WPP_URL}/send-message`, {
      number: numero,
      message: texto
    });
  } catch (err) {
    console.error("[ERRO] falha ao enviar pelo WppConnect:", err.response?.data || err.message);
  }
}

module.exports = { enviarMensagem };
