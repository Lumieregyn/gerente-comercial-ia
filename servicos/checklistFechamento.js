const axios = require("axios");
const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Executa o checklist de fechamento usando análise contextual com GPT-4o.
 * Só dispara alerta se houver pendência real.
 */
async function checklistFechamento({ nomeCliente, nomeVendedor, numeroVendedor, contexto, texto }) {
  const textoCompleto = `${texto}\n\n${contexto || ""}`.trim();

  if (!textoCompleto || textoCompleto.length < 10) {
    console.warn("[WARN] Texto e contexto insuficientes para checklist.");
    return;
  }

  const systemPrompt = `
Você é o Gerente Comercial IA da Lumiéregyn.
Seu papel é revisar a conversa abaixo entre cliente e vendedor para confirmar se tudo está pronto para gerar o pedido de venda.
Use linguagem comercial clara e objetiva.
`.trim();

  const userPrompt = `
Cliente: ${nomeCliente}
Vendedor: ${nomeVendedor}

💬 Conversa analisada:
${textoCompleto}

✅ Verifique os seguintes pontos:

1. A imagem do produto corresponde ao que foi orçado?
2. A cor e o modelo foram informados?
3. A voltagem (110v, 220v ou bivolt) foi informada ou inferida?
4. Os prazos de produção e entrega foram discutidos?
5. O cliente demonstrou que entendeu e aprovou tudo claramente?

⚠️ Se qualquer um desses pontos estiver incompleto, responda com uma lista de pendências numeradas.
Se estiver tudo certo, responda apenas: "Checklist OK. Nenhuma pendência.".
`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 300
    });

    const analise = completion.choices[0].message.content.trim();
    console.log("[Checklist IA]", analise);

    if (!analise.toLowerCase().includes("nenhuma pendência")) {
      const mensagem = `✅ *Checklist Final de Fechamento - Análise IA*\n\n⚠️ Prezado(a) *${nomeVendedor}*, identificamos pendências que devem ser ajustadas antes de fechar o pedido:\n\n${analise}\n\n💡 Recomendamos validar com o cliente para evitar problemas futuros.`;

      await axios.post(`${process.env.WPP_URL}/send-message`, {
        number: numeroVendedor,
        message: mensagem
      });
    }
  } catch (err) {
    console.error("[ERRO Checklist IA]", err.message);
  }
}

module.exports = { checklistFechamento };
