const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function analisarMensagemComIA(payload) {
  const nomeCliente = payload.user?.Name || "cliente";
  const texto = payload.message?.text || "";

  const prompt = `
Você é a Gerente Comercial IA da LumièreGyn. Analise a seguinte mensagem recebida do cliente ${nomeCliente} e diga:
1. O cliente sinalizou intenção de fechamento?
2. Existe alguma pendência crítica?
3. Quais pontos devem ser validados antes de finalizar a venda?

Mensagem recebida:
"${texto}"
  `;

  const resposta = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
  });

  return resposta.choices[0].message.content;
}

module.exports = { analisarMensagemComIA };
