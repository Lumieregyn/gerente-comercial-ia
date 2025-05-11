const { OpenAI } = require("openai");
const { buscarMemoria } = require("../utils/memoria");
const axios = require("axios");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Analisa a pergunta enviada via WhatsApp e responde com base nos logs.
 */
async function perguntarViaIA({ textoPergunta, numeroGestor }) {
  // Extrai intenção e palavras-chave usando GPT-4o
  const promptIntencao = `
Você é um assistente de IA treinado para interpretar perguntas de gestores comerciais sobre clientes e vendedores.
Com base na pergunta abaixo, diga qual é a intenção da consulta (ex: atendimento_cliente, status_vendedor, checklist_pendente) e identifique o nome da pessoa mencionada.

Pergunta: "${textoPergunta}"

Responda no formato:
INTENCAO: ...
NOME: ...
`.trim();

  const interpretacao = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: promptIntencao }],
    max_tokens: 100
  });

  const respostaIA = interpretacao.choices[0].message.content;
  const match = respostaIA.match(/INTENCAO:\s*(.+)\nNOME:\s*(.+)/i);

  if (!match) {
    await enviarRespostaWhatsApp(numeroGestor, "❌ Não consegui entender a pergunta. Pode reformular?");
    return;
  }

  const [, intencao, nome] = match;

  // Buscar memória baseada na intenção
  const memoria = await buscarMemoria(nome, nome, 5); // busca por nome no embedding e no campo cliente/vendedor

  const respostaContexto = memoria.length
    ? memoria.map((m, i) => `#${i + 1}: ${m.metadata.evento} → ${m.metadata.texto}`).join("\n")
    : "🧠 Nenhum dado relevante encontrado.";

  const respostaFinal = `
📋 *Resposta para sua pergunta sobre "${nome}"*

🔎 Intenção detectada: ${intencao}
📂 Contexto encontrado:
${respostaContexto}

🤖 IA LumièreGyn em ação.
`.trim();

  await enviarRespostaWhatsApp(numeroGestor, respostaFinal);
}

async function enviarRespostaWhatsApp(numero, mensagem) {
  await axios.post(`${process.env.WPP_URL}/send-message`, {
    number: numero,
    message: mensagem
  });
}

module.exports = { perguntarViaIA };
