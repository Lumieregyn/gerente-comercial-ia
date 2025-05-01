
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function analisarMensagemComIA(nomeCliente, nomeVendedor, mensagem) {
  if (!mensagem || mensagem.trim().length < 3) return { mensagemFinal: null };

  const prompt = `
Analise a mensagem do cliente ${nomeCliente}: "${mensagem}".
1. O cliente sinalizou intenção de fechamento?
2. Existe alguma pendência crítica?
3. Quais pontos devem ser validados antes de finalizar a venda?
Se a mensagem não for conclusiva, diga "[IA] Sem alerta necessário para ${nomeVendedor}".
Se houver alerta, gere um texto com sugestão de ação.

Formato da resposta:
[ANÁLISE IA]:
1. ...
2. ...
3. ...
[IA] Sem alerta necessário para ${nomeVendedor} // OU mensagem de alerta`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });

    const content = completion.choices[0].message.content;
    if (content.includes("[IA] Sem alerta")) return { mensagemFinal: null };
    return { mensagemFinal: `🤖 *Alerta IA:*
${content}` };
  } catch (error) {
    console.error("[ERRO IA]", error.message);
    return { mensagemFinal: null };
  }
}

module.exports = { analisarMensagemComIA };
