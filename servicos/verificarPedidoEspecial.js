// servicos/verificarPedidoEspecial.js
const axios = require("axios");
const { OpenAI } = require("openai");
const { buscarMemoria } = require("../utils/memoria");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Verifica itens sem SKU ou imagem formal no orçamento após intenção de fechamento.
 */
async function verificarPedidoEspecial({ nomeCliente, nomeVendedor, numeroVendedor, contexto, texto }) {
  // 1) histórico relevante do cliente
  const hist = await buscarMemoria(texto, 3);
  const histText = hist
    .map((h, i) => `#${i+1} [${h.score.toFixed(2)}]: ${h.metadata.evento} → ${h.metadata.texto}`)
    .join("\n");

  // 2) prompts de análise
  const systemPrompt = `
Você é um especialista comercial treinado para revisar negociações especiais.
Seu trabalho é garantir que todos os pontos críticos foram validados antes de fechar o pedido.
`.trim();

  const userPrompt = `
Cliente: ${nomeCliente}
Produto especial detectado (sem SKU formalizado).

Contexto atual:\n${contexto}
Histórico do cliente:\n${histText}

Valide os seguintes pontos:
1. Imagem coerente com o que foi negociado?
2. Cor e modelo alinhados?
3. Voltagem informada?
4. Prazos discutidos claramente?
5. Formalização clara e documentada?

Liste apenas os pontos críticos a serem ajustados. Se tudo estiver ok, diga "Negociação validada".
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    max_tokens: 250
  });

  const analise = completion.choices[0].message.content.trim();
  if (!analise.toLowerCase().includes("negociação validada")) {
    const mensagem = `✅ *Checklist de Produto Especial - IA*\n\n⚠️ Prezado(a) *${nomeVendedor}*, identificamos pontos que devem ser validados antes de fechar o pedido:\n\n${analise}\n\n📎 Produto sem cadastro formal — atenção redobrada.`;

    await axios.post(`${process.env.WPP_URL}/send-message`, {
      number: numeroVendedor,
      message: mensagem
    });
  }
}

module.exports = { verificarPedidoEspecial };
