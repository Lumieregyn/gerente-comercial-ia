// servicos/analisarImagem.js
const axios = require("axios");
const Tesseract = require("tesseract.js");
const { OpenAI } = require("openai");

// instancia o OpenAI com sua chave de ambiente
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function analisarImagemComOCR(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(resp.data);

    console.log("[OCR] Iniciando análise de imagem com Tesseract...");
    const resultado = await Tesseract.recognize(buffer, "por", {
      logger: m => {
        const p = m.progress ? ` - ${Math.round(m.progress * 100)}%` : "";
        console.log(`[OCR] ${m.status}${p}`);
      }
    });

    const texto = resultado.data.text?.trim();
    if (texto && texto.length >= 3) {
      console.log("[OCR] Texto extraído:", texto);
      return texto;
    }
    console.log("[OCR] Nenhum texto relevante encontrado.");
    return null;

  } catch (err) {
    console.error("[ERRO OCR]", err.message);
    return null;
  }
}

async function fallbackComGPT4Vision(url) {
  try {
    console.log("[FALLBACK] Ativando GPT-4o Vision...");
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const base64 = Buffer.from(resp.data).toString("base64");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "Você é um especialista técnico em iluminação. " +
            "Descreva o tipo de luminária, cor, modelo e aplicação do produto na imagem."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analise e descreva tecnicamente essa luminária:" },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${base64}` }
            }
          ]
        }
      ],
      max_tokens: 500
    });

    const descricao = completion.choices[0].message.content.trim();
    console.log("[GPT-4o Vision] Descrição:", descricao);
    return descricao;

  } catch (err) {
    console.error("[ERRO GPT-4o Vision Fallback]", err.message);
    return null;
  }
}

async function analisarImagem(url) {
  const ocr = await analisarImagemComOCR(url);
  if (ocr) return ocr;

  return await fallbackComGPT4Vision(url);
}

module.exports = { analisarImagem };
