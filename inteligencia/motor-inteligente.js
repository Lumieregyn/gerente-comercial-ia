
// inteligencia/motor-inteligente.js
// Módulo com integração ao GPT-4o para análise inteligente de mensagens, áudio e documentos

const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

async function analisarMensagemComIA(payload) {
  const nomeCliente = payload.user?.Name || "Cliente";
  const nomeVendedor = payload.attendant?.Name || "Vendedor";
  const mensagem = payload.message?.text || "";
  const tipo = payload.message?.type || "text";

  const prompt = `
Você é uma assistente comercial inteligente da Lumiéregyn.
Analise a seguinte mensagem de um cliente para decidir se devemos gerar um alerta ao vendedor.

Dados:
Cliente: ${nomeCliente}
Vendedor: ${nomeVendedor}
Tipo de mensagem: ${tipo}
Mensagem: "${mensagem}"

Perguntas:
1. O cliente está esperando orçamento?
2. O cliente indicou que já decidiu fechar?
3. Existe algum risco de erro, dúvida ou item pendente?
4. Há divergência entre o que foi dito e o que foi orçado?

Responda em JSON com as chaves: "alertaOrcamento", "fechamentoDetectado", "checklistNecessario", "mensagemExplicativa"
`;

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    });

    const resposta = completion.data.choices[0].message.content;
    const parsed = JSON.parse(resposta);
    return parsed;
  } catch (error) {
    console.error("[IA] Erro ao analisar com GPT:", error.message);
    return {
      alertaOrcamento: false,
      fechamentoDetectado: false,
      checklistNecessario: false,
      mensagemExplicativa: "[IA] Erro ao interpretar a mensagem."
    };
  }
}

module.exports = {
  analisarMensagemComIA
};
