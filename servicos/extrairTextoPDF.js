const axios = require("axios");
const pdfParse = require("pdf-parse");

async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const data = await pdfParse(resp.data);

    console.log("[PDF] Texto extraído com sucesso.");
    return data.text;
  } catch (err) {
    console.error("[ERRO PDF]", err.message);
    return null;
  }
}

module.exports = { extrairTextoPDF };
