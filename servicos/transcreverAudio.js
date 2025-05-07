const axios = require("axios");
const FormData = require("form-data");

async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const form = new FormData();
    form.append("file", Buffer.from(resp.data), {
      filename: "audio.ogg",
      contentType: "audio/ogg"
    });
    form.append("model", "whisper-1");

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

    console.log("[AUDIO] Transcrição obtida com sucesso.");
    return result.data.text;
  } catch (err) {
    console.error("[ERRO WHISPER]", err.message);
    return null;
  }
}

module.exports = { transcreverAudio };
