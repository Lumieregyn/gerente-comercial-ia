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

    const acao = match[1].trim();
    const entidade = match[2].trim();
    const nome = match[3].trim();
    const contexto = match[4].trim();

    console.log("[IA GESTOR] Interpretado:", { acao, entidade, nome, contexto });

    if (!nome) {
      await enviarRespostaWhatsApp(numeroGestor, "❌ Nenhum nome foi identificado para análise.");
      return;
    }

    const memorias = await buscarMemoria(nome, 10);

    if (["resumo", "sentimento", "status"].includes(acao) && memorias.length > 0) {
      const historicoTexto = memorias
        .map(m => m.metadata.texto?.trim())
        .filter(Boolean)
        .slice(0, 8)
        .map((t, i) => `• ${t}`)
        .join("\n");

      console.log("[DEBUG] Enviando histórico para análise do GPT:", historicoTexto);

      const resumoPrompt = `
Você é um assistente comercial. Resuma os principais pontos abaixo com foco em atendimento, qualidade, atrasos e sentimento geral.

Histórico:
${historicoTexto}

Gere um parágrafo objetivo e direto.
      `.trim();

      const resumo = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: resumoPrompt }],
        max_tokens: 200
      });

      const analise = resumo.choices[0].message.content.trim();

      const mensagemFinal = `
📋 *Resumo de Atendimento - ${nome}*

🧠 Interpretação:
• AÇÃO: ${acao}
• ENTIDADE: ${entidade}
• CONTEXTO: ${contexto}

📝 Análise:
${analise}

🤖 IA Comercial LumièreGyn.
      `.trim();

      return await enviarRespostaWhatsApp(numeroGestor, mensagemFinal);
    }

    let respostaContexto = "⚠️ Nenhum dado encontrado para análise.";
    if (memorias.length > 0) {
      respostaContexto = memorias
        .map((m, i) => `#${i + 1}: ${m.metadata.evento} → ${m.metadata.texto}`)
        .join("\n");
    }

    const fallback = `
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

    await enviarRespostaWhatsApp(numeroGestor, fallback);
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
