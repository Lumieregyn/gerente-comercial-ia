const axios = require("axios");
const { OpenAI } = require("openai");
const pdf = require("pdf-parse");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function extractPdfText(url) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const data = await pdf(response.data);
  return data.text;
}

async function transcribeAudio(url) {
  const response = await axios.get(url, { responseType: "stream" });
  const transcription = await openai.audio.transcriptions.create({
    file: response.data,
    model: "whisper-1"
  });
  return transcription.text;
}

async function analisarMensagemComIA(payload) {
  const nomeCliente = payload.user.Name;
  const msg = payload.message || payload.Message || {};
  const texto = msg.text || "";
  let attachmentText = "";
  const atts = msg.attachments || [];
  if (atts.length) {
    const att = atts[0];
    const url = att.payload?.url;
    if (att.type === "document" && url) {
      try { attachmentText = await extractPdfText(url);} catch {}
    } else if (att.type === "audio" && url) {
      try { attachmentText = await transcribeAudio(url);} catch {}
    }
  }
  const fullText = texto + (attachmentText ? "\n\n" + attachmentText : "");
  const prompt = `Você é a Gerente Comercial IA da LumièreGyn.
Analise a mensagem do cliente ${nomeCliente}:
"${fullText}"
1. Intenção de fechamento?
2. Pendências críticas?
3. Pontos a validar antes de finalizar a venda?
Retorne apenas "Sem alerta" ou a análise.`;
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
  });
  const content = completion.choices[0].message.content;
  return content.includes("Sem alerta") ? null : content;
}

async function verificarDivergenciaVisual(descricaoImagem, descricaoOrcamento, nomeCliente) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Você é um assistente técnico da Gerência Comercial IA. Compare a descrição de uma imagem enviada pelo cliente com a descrição do item orçado no orçamento. Se houver divergência significativa de tipo, modelo ou cor, diga "Alerta: Divergência detectada". Caso contrário, diga "OK: Descrição coerente".`
        },
        {
          role: "user",
          content: `Cliente: ${nomeCliente}\n\nDescrição da imagem: ${descricaoImagem}\n\nDescrição do orçamento: ${descricaoOrcamento}\n\nA análise deve ser rigorosa caso o item não esteja no sistema.`
        }
      ]
    });

    const resposta = completion.choices[0].message.content.trim();
    return resposta.includes("Alerta") ? resposta : null;
  } catch (err) {
    console.error("[ERRO] Falha na verificação visual:", err.message);
    return null;
  }
}

module.exports = {
  analisarMensagemComIA,
  verificarDivergenciaVisual
};
