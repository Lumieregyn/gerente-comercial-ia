// servicos/verificarPedidoEspecial.js
const axios = require("axios");
const { OpenAI } = require("openai");
const { buscarMemoria } = require("../utils/memoria");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Gatilho de Negociação Especial
 */
async function verificarPedidoEspecial({ nomeCliente, nomeVendedor, numeroVendedor, contexto }) {
  const systemPrompt = `
Você é um Gerente Comercial IA. Avalie se o pedido especial está completo.
Retorne uma lista numerada de itens faltantes ou problemas críticos.
`.trim();

  const hist = await buscarMemoria(contexto, 3);
  const histText = hist.map((h,i)=>`#${i+1}[${h.score.toFixed(2)}]: ${h.metadata.evento}`).join("\n");

  const userPrompt = `
Cliente: ${nomeCliente}
Contexto:\n${contexto}

Histórico relevante:\n${histText}

Liste itens faltantes ou riscos na negociação especial.
`.trim();

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    max_tokens: 200
  });

  const faltas = response.choices[0].message.content.trim();
  if (!/nenhum|nada/i.test(faltas)) {
    const msg = `🚨 *Alerta de Negociação Especial*\n\n⚠️ Prezado(a) *${nomeVendedor}*, encontramos riscos:\n\n${faltas}\n\n💡 Verifique e confirme com o cliente antes de prosseguir.`;
    await axios.post(`${process.env.WPP_URL}/send-message`, {
      number: numeroVendedor,
      message: msg
    });
  }
}

module.exports = { verificarPedidoEspecial };
