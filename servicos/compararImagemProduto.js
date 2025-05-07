const axios = require("axios");
const { enviarMensagem } = require("./enviarMensagem");
const MENSAGENS = require("../utils/mensagens");

async function compararImagemProduto({ nomeCliente, nomeVendedor, numeroVendedor, imagemBase64, contexto }) {
  try {
    const { OpenAI } = require("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Você é um revisor técnico. Analise se a imagem do cliente corresponde ao produto orçado no seguinte contexto. Se houver divergência visual, aponte."
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Contexto do orçamento:\n${contexto}\n\nA imagem abaixo foi enviada pelo cliente:` },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imagemBase64}`
              }
            }
          ]
        }
      ],
      max_tokens: 500
    });

    const resposta = completion.choices[0].message.content.toLowerCase();

    const houveDivergencia = resposta.includes("divergência") || resposta.includes("não corresponde") || resposta.includes("diferença");

    if (houveDivergencia) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaImagem(nomeVendedor, nomeCliente));
      console.log(`[DIVERGÊNCIA] Alerta de imagem enviado para ${nomeVendedor}.`);
    } else {
      console.log("[DIVERGÊNCIA] Imagem validada. Sem divergência.");
    }
  } catch (err) {
    console.error("[ERRO DIVERGÊNCIA]", err.message);
  }
}

module.exports = { compararImagemProduto };
