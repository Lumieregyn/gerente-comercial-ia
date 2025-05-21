// servicos/detectarIntencao.js

const { OpenAI } = require("openai");

// Instancia o cliente OpenAI já com a chave de API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Retorna true se a IA entender que o cliente está aguardando orçamento.
 */
async function detectarIntencao(nomeCliente, texto, contexto = "") {
  const prompt = `
Você é a Gerente Comercial IA da Lumiéregyn.
Analise se o cliente "${nomeCliente}" está aguardando um orçamento comercial
com base na seguinte mensagem e contexto:

Mensagem:
"${texto.replace(/\n/g, " ")}"

Contexto adicional:
"${contexto.replace(/\n/g, " ")}"

Responda apenas com "Sim" ou "Não".
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }]
    });
    const resposta = completion.choices[0].message.content.toLowerCase();
    return resposta.includes("sim");
  } catch (err) {
    console.error("[ERRO] Falha na detecção de intenção:", err.message);
    return false;
  }
}

module.exports = { detectarIntencao };
