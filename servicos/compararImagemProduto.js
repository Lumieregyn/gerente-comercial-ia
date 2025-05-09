// servicos/compararImagemProduto.js
const axios = require("axios");
const { OpenAI } = require("openai");
const { buscarMemoria } = require("../utils/memoria");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Gatilho de Alerta de Divergência de Imagem
 */
async function compararImagemProduto({ nomeCliente, nomeVendedor, numeroVendedor, imagemBase64, contexto }) {
  const systemPrompt = `
Você é um especialista em produtos de iluminação. Compare a imagem enviada pelo cliente com o que foi orçado.
Retorne 'Alerta' se houver divergência significativa ou 'OK' se estiver coerente.
`.trim();

  const hist = await buscarMemoria(contexto, 3);
  const histText = hist.map((h,i)=>`#${i+1}[${h.score.toFixed(2)}]: ${h.metadata.evento}`).join("\n");

  const userPrompt = `
Cliente: ${nomeCliente}
Contexto:\n${contexto}

Histórico relevante:\n${histText}

Analise esta imagem base64 e informe divergências (tipo, cor, modelo).
`.trim();

  const resp = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      {
        role: "user",
        content: {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${imagemBase64}` }
        }
      }
    ]
  });

  const resultado = resp.choices[0].message.content.trim();
  if (/alerta/i.test(resultado)) {
    const msg = `📸 *Alerta de Divergência de Imagem*\n\n⚠️ Prezado(a) *${nomeVendedor}*, possível divergência detectada:\n${resultado}\n\n💡 Valide antes de gerar o pedido.`;
    await axios.post(`${process.env.WPP_URL}/send-message`, {
      number: numeroVendedor,
      message: msg
    });
  }
}

module.exports = { compararImagemProduto };
