// servicos/transcreverAudio.js
const axios = require("axios");
const FormData = require("form-data");

/**
 * Faz a transcrição do áudio via Whisper da OpenAI.
 * @param {string} url URL do arquivo de áudio
 * @returns {Promise<string|null>} Texto transcrito ou null em caso de erro
 */
async function transcreverAudio(url) {
  try {
    console.log(`[AUDIO] Baixando áudio de: ${url}`);
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    console.log("[AUDIO] Áudio baixado, tamanho:", resp.data.byteLength);

    const form = new FormData();
    form.append("file", Buffer.from(resp.data), {
      filename: "audio.ogg",
      contentType: "audio/ogg"
    });
    form.append("model", "whisper-1");

    console.log("[AUDIO] Enviando para Whisper...");
    const result = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        }
      }
    );

    const texto = result.data.text?.trim();
    if (texto) {
      console.log("[AUDIO] Transcrição obtida:", texto);
      return texto;
    } else {
      console.log("[AUDIO] Transcrição vazia retornada.");
      return null;
    }
  } catch (err) {
    console.error(
      "[ERRO] Transcrição de áudio falhou:",
      err.response?.data || err.message
    );
    return null;
  }
}

module.exports = { transcreverAudio };
