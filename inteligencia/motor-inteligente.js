const { OpenAI } = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function analisarMensagem(mensagem, nomeCliente, nomeVendedor) {
  if (!mensagem || mensagem.length < 4) return null;

  const prompt = `
Mensagem recebida de um cliente: "${mensagem}"

Analise como IA Gerente Comercial e responda apenas se for necessário alertar o vendedor.

1. O cliente sinalizou intenção de fechamento?
2. Existe alguma pendência crítica?
3. Quais pontos devem ser validados antes de finalizar a venda?

Formato da resposta: markdown resumido para envio no WhatsApp.

Use linguagem natural, objetiva e com tom consultivo.
Se nada for necessário, retorne apenas: null
`;

  const completion = await openai.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "gpt-4o"
  });

  const output = completion.choices[0]?.message?.content;
  if (output && output.includes("null")) return null;
  return `🤖 *Alerta IA:* ${output}`;
}

module.exports = { analisarMensagem };