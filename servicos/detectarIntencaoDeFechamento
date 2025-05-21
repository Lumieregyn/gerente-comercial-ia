const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Retorna true se a IA entender que o cliente sinalizou intenção de fechamento do pedido.
 */
async function detectarIntencaoDeFechamento(nomeCliente, texto, contexto = "") {
  const prompt = `
Você é a Gerente Comercial IA da Lumiéregyn.
Seu papel é identificar se o cliente "${nomeCliente}" está sinalizando que deseja FECHAR um pedido ou APROVAR o orçamento.

Mensagem recebida:
"${texto.replace(/\n/g, " ")}"

Contexto anterior:
"${contexto.replace(/\n/g, " ")}"

Sinais típicos de fechamento:
- "Pode fechar"
- "Vamos seguir com esse"
- "Aprovado"
- "Pode fazer o pedido"
- "Pode emitir a nota"
- "Esse mesmo"

⚠️ Importante: NÃO considerar como fechamento dúvidas, perguntas de valor, ou solicitação de orçamento.

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
    console.error("[ERRO] Falha na detecção de fechamento:", err.message);
    return false;
  }
}

module.exports = { detectarIntencaoDeFechamento };
