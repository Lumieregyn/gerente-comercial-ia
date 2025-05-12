const axios = require("axios");
const { OpenAI } = require("openai");
const { buscarMemoria } = require("../utils/memoria");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function perguntarViaIA({ textoPergunta, numeroGestor }) {
  try {
    const prompt = `
Você é um analista de atendimento inteligente.

Interprete a pergunta abaixo e retorne:
- ACAO: contagem, atraso, resumo, sentimento, status, outro
- ENTIDADE: vendedor, cliente, todos
- NOME: nome citado, se houver
- CONTEXTO: atendimento, orçamento, satisfação, outro

Pergunta: "${textoPergunta}"

Responda assim:
ACAO: ...
ENTIDADE: ...
NOME: ...
CONTEXTO: ...
    `.trim();

    const interpretacao = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100
    });

    const resposta = interpretacao.choices[0].message.content;
    const match = resposta.match(
      /ACAO:\s*(.+)\nENTIDADE:\s*(.+)\nNOME:\s*(.+)\nCONTEXTO:\s*(.+)/i
    );

    if (!match) {
      await enviarRespostaWhatsApp(numeroGestor, "❌ Não consegui entender a pergunta. Pode reformular?");
      return;
    }

    // ✅ Aplicando .trim() em todos os campos
    const acao = match[1].trim();
    const entidade = match[2].trim();
    const nome = match[3].trim();
    const contexto = match[4].trim();

    console.log("[IA GESTOR] Interpretado:", { acao, entidade, nome, contexto });

    const memorias = nome && nome.length > 2
      ? await buscarMemoria(nome, 5)
      : [];

    let respostaContexto = "⚠️ Nenhum dado encontrado para análise.";

    if (memorias.length > 0) {
      respostaContexto = memorias.map((m, i) => `#${i + 1}: ${m.metadata.evento} → ${m.metadata.texto}`).join("\n");
    }

    const mensagemFinal = `
📋 *Resposta da IA - Análise Comercial*

📌 Pergunta: "${textoPergunta}"
🧠 Interpretação:
• AÇÃO: ${acao}
• ENTIDADE: ${entidade}
• NOME: ${nome}
• CONTEXTO: ${contexto}

📚 Histórico relevante:
${respostaContexto}

🤖 IA Comercial LumièreGyn.
`.trim();

    await enviarRespostaWhatsApp(numeroGestor, mensagemFinal);
  } catch (err) {
    console.error("[ERRO perguntarViaIA]", err.message);
    await enviarRespostaWhatsApp(numeroGestor, "⚠️ Ocorreu um erro ao processar sua pergunta. Tente novamente.");
  }
}

async function enviarRespostaWhatsApp(numero, mensagem) {
  await axios.post(`${process.env.WPP_URL}/send-message`, {
    number: numero,
    message: mensagem
  });
}

module.exports = { perguntarViaIA };
