// servicos/perguntarViaIA.js

const axios = require("axios");
const { OpenAI } = require("openai");
const { buscarMemoria } = require("../utils/memoria");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Processa perguntas de gestores via WhatsApp, buscando contexto nos logs.
 * @param {{textoPergunta: string, numeroGestor: string}} param0 
 */
async function perguntarViaIA({ textoPergunta, numeroGestor }) {
  try {
    // 1. Interpretar a intenção e nome mencionados
    const interpretacaoPrompt = `
Você é um assistente de IA que ajuda a entender perguntas de gestores sobre clientes ou vendedores.
Com base na pergunta abaixo, identifique:

INTENCAO: atendimento_cliente, status_vendedor, checklist_pendente, fechamento, pendencias, resumo, outro
NOME: nome mencionado na pergunta

Pergunta:
"${textoPergunta}"

Responda no formato:
INTENCAO: ...
NOME: ...
`.trim();

    const interpretacao = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: interpretacaoPrompt }],
      max_tokens: 100
    });

    const resposta = interpretacao.choices[0].message.content || "";
    const match = resposta.match(/INTENCAO:\s*(.+)\nNOME:\s*(.+)/i);

    if (!match) {
      console.warn("[IA GESTOR] Formato inválido na resposta da IA:", resposta);
      await enviarRespostaWhatsApp(numeroGestor, "❌ Não consegui entender a pergunta. Pode reformular?");
      return;
    }

    const [, intencao, nomeMencionado] = match;

    // 2. Buscar contexto relevante no Pinecone
    const memorias = await buscarMemoria(nomeMencionado, nomeMencionado, 5);

    const respostaContexto = memorias.length
      ? memorias.map((m, i) => `#${i + 1}: ${m.metadata.evento} → ${m.metadata.texto}`).join("\n")
      : "🧠 Nenhum dado relevante encontrado.";

    // 3. Montar resposta para gestor
    const mensagemFinal = `
📋 *Resposta da IA - Análise Comercial*

🔍 Intenção detectada: ${intencao}
👤 Pessoa analisada: ${nomeMencionado}

📚 Histórico encontrado:
${respostaContexto}

🤖 IA Comercial LumièreGyn.
`.trim();

    await enviarRespostaWhatsApp(numeroGestor, mensagemFinal);
  } catch (err) {
    console.error("[ERRO perguntarViaIA]", err?.response?.data || err.message);
    await enviarRespostaWhatsApp(numeroGestor, "⚠️ Ocorreu um erro ao processar sua pergunta. Tente novamente.");
  }
}

async function enviarRespostaWhatsApp(numero, mensagem) {
  try {
    await axios.post(`${process.env.WPP_URL}/send-message`, {
      number: numero,
      message: mensagem
    });
    console.log("[ENVIADO] Mensagem enviada ao gestor:", numero);
  } catch (err) {
    console.error("[ERRO enviarRespostaWhatsApp]", err?.response?.data || err.message);
  }
}

module.exports = { perguntarViaIA };
