const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Retorna true se a IA entender que o cliente está aguardando orçamento.
 */
async function detectarIntencao(nomeCliente, texto, contexto = "") {
  const prompt = `
Você é a Gerente Comercial IA da Lumiéregyn.
Seu papel é identificar se o cliente "${nomeCliente}" está AGUARDANDO um orçamento comercial,
baseado na seguinte mensagem e contexto.

Mensagem:
"${texto.replace(/\n/g, " ")}"

Contexto:
"${contexto.replace(/\n/g, " ")}"

Interprete com base em linguagem natural. 
Considere mensagens como:
- "Qual o valor desse modelo?"
- "Pode me mandar as opções?"
- "Gostei desse aqui, qual o preço?"
- "Esse modelo tem em dourado?"

Evite confundir com intenção de fechamento (ex: "Pode fechar", "Vamos seguir com esse").

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
