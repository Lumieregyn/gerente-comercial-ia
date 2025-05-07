const axios = require("axios");
const Tesseract = require("tesseract.js");

async function analisarImagemComOCR(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(resp.data);
    console.log("[OCR] Iniciando análise de imagem com Tesseract...");

    const resultado = await Tesseract.recognize(buffer, "por", {
      logger: m => console.log(`[OCR] ${m.status} ${m.progress ? `- ${Math.round(m.progress * 100)}%` : ""}`)
    });

    const texto = resultado.data.text?.trim();
    if (texto && texto.length >= 3) {
      console.log("[OCR] Texto extraído:", texto);
      return texto;
    } else {
      console.log("[OCR] Nenhum texto relevante encontrado.");
      return null;
    }
  } catch (err) {
    console.error("[ERRO OCR]", err.message);
    return null;
  }
}

async function fallbackComGPT4Vision(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const base64 = Buffer.from(resp.data).toString("base64");

    const resposta = await axios.post(`${process.env.API_URL || "http://localhost:3000"}/analisar-imagem`, {
      imagemBase64: base64
    });

    const descricao = resposta.data.descricao;
    if (descricao) {
      console.log("[GPT-4o Vision] Descrição retornada:", descricao);
      return descricao;
    } else {
      console.log("[GPT-4o Vision] Nenhuma descrição retornada.");
      return null;
    }
  } catch (erro) {
    console.error("[ERRO GPT-4o Vision Fallback]", erro.message);
    return null;
  }
}

async function analisarImagem(url) {
  const resultadoOCR = await analisarImagemComOCR(url);
  if (resultadoOCR) return resultadoOCR;

  console.log("[FALLBACK] Ativando fallback visual com GPT-4o...");
  const resultadoVision = await fallbackComGPT4Vision(url);
  return resultadoVision || null;
}

module.exports = { analisarImagem };
