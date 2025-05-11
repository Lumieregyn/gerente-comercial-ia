// servicos/compararImagemProduto.js
const axios = require("axios");
const { OpenAI } = require("openai");
const { buscarMemoria } = require("../utils/memoria");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Compara imagem enviada pelo cliente com a imagem do orçamento após sinal de fechamento.
 */
async function compararImagemProduto({ nomeCliente, nomeVendedor, numeroVendedor, imagemClienteDesc, imagemOrcamentoDesc, contexto, clienteId }) {
  // 1) Recuperar histórico relevante do cliente
  const hist = await buscarMemoria("imagem produto", clienteId, 3);
  const histText = hist
    .map((h, i) => `#${i+1} [${h.score.toFixed(2)}]: ${h.metadata.evento} → ${h.metadata.texto}`)
    .join("\n");

  // 2) Prompt para análise visual comparativa
  const systemPrompt = `
Você é um assistente comercial especializado em análise de divergência visual entre produtos.
Compare a descrição da imagem enviada pelo cliente com o que foi incluído no orçamento.
`.trim();

  const userPrompt = `
Cliente: ${nomeCliente}

🖼️ Imagem enviada pelo cliente:
${imagemClienteDesc}

📄 Produto no orçamento:
${imagemOrcamentoDesc}

📚 Histórico do cliente:
${histText}

Analise se há divergência de cor, modelo ou tipo de luminária. Se houver, diga qual. Se estiver coerente, responda "Imagem compatível com orçamento".
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    max_tokens: 150
  });

  const resultado = completion.choices[0].message.content.trim();

  if (!resultado.toLowerCase().includes("imagem compatível")) {
    const mensagem = `📸 *Alerta de Divergência de Imagem*\n\n⚠️ Prezado(a) *${nomeVendedor}*, ao revisar o material enviado pelo cliente *${nomeCliente}*, identificamos uma possível divergência:\n\n${resultado}\n\n👉 Recomendamos revisar com o cliente antes de gerar o pedido para evitar retrabalho.`;

    await axios.post(`${process.env.WPP_URL}/send-message`, {
      number: numeroVendedor,
      message: mensagem
    });
  }
}

module.exports = { compararImagemProduto };
