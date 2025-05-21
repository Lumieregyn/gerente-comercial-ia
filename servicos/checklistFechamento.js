const axios = require("axios");
const { OpenAI } = require("openai");
const { buscarMemoria } = require("../utils/memoria");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Gatilho de Checklist Final de Fechamento
 */
async function checklistFechamento({ nomeCliente, nomeVendedor, numeroVendedor, contexto, texto, clienteId }) {
  if (!contexto || contexto.trim().length === 0) {
    console.warn("[WARN] Contexto extra vazio. Pulando checklist.");
    return;
  }

  // Buscar histórico semântico
  const hist = await buscarMemoria(contexto, clienteId, 3);
  const histText = hist
    .map((h, i) => `#${i + 1} [${h.score.toFixed(2)}]: ${h.metadata.evento} → ${h.metadata.texto}`)
    .join("\n");

  // Preparar prompts
  const systemPrompt = `
Você é um Gerente Comercial IA experiente. 
Analise o contexto e retorne apenas uma lista numerada de pendências críticas para fechar o pedido.
`.trim();

  const userPrompt = `
Cliente: ${nomeCliente}
Contexto:\n${contexto}

Histórico relevante:\n${histText}

Quais pendências críticas precisam ser ajustadas antes de gerar o pedido?
`.trim();

  // Executar análise via GPT
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    max_tokens: 200
  });

  const pendencias = completion.choices[0].message.content.trim();

  // Enviar alerta apenas se houver pendências
  if (!pendencias.toLowerCase().includes("nenhuma pendência")) {
    const mensagem = `✅ *Checklist Final de Fechamento - Análise IA*\n\n⚠️ Prezado(a) *${nomeVendedor}*, identificamos pendências:\n\n${pendencias}\n\n💡 Recomendamos validar com o cliente antes de concluir o pedido.`;

    await axios.post(`${process.env.WPP_URL}/send-message`, {
      number: numeroVendedor,
      message: mensagem
    });
  }
}

module.exports = { checklistFechamento };
