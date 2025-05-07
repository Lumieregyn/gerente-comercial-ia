const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function detectarIntencao(cliente, mensagem, contexto = "") {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Você é Gerente Comercial IA: detecte se cliente está aguardando orçamento."
        },
        {
          role: "user",
          content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto ? "\nContexto: " + contexto : ""}`
        }
      ]
    });

    const resposta = completion.choices[0].message.content.toLowerCase();
    const aguardando = resposta.includes("sim") || resposta.includes("aguard");

    console.log(`[INTENÇÃO] Cliente "${cliente}" está aguardando orçamento?`, aguardando);
    return aguardando;
  } catch (err) {
    console.error("[ERRO INTENÇÃO]", err.message);
    return false;
  }
}

module.exports = { detectarIntencao };
