const axios = require("axios");
const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_URL = process.env.PINECONE_INDEX_URL;

if (!PINECONE_API_KEY || !PINECONE_INDEX_URL) {
  console.warn("[PINECONE] Variáveis não configuradas.");
}

/**
 * Registra um log semântico no Pinecone usando embedding local.
 */
async function registrarLogSemantico({
  cliente,
  vendedor,
  evento,
  tipo,
  texto,
  decisaoIA,
  detalhes = {},
}) {
  if (!texto || texto.trim().length < 3) {
    console.warn("[LOGIA] Ignorado: texto vazio ou muito curto.");
    return;
  }

  let values;
  try {
    const resp = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: texto,
    });
    values = resp.data[0].embedding;
  } catch (err) {
    console.error("[IA] Erro ao gerar embedding:", err.message);
    return;
  }

  const cleanId = `cliente_${cliente.replace(/\s+/g, "_")}_log_${uuidv4()}`;

  const vector = {
    id: cleanId,
    values,
    metadata: {
      cliente,
      vendedor,
      evento,
      tipo,
      texto,
      decisaoIA,
      ...detalhes,
      timestamp: new Date().toISOString(),
    },
  };

  try {
    await axios.post(
      `${PINECONE_INDEX_URL}/vectors/upsert`,
      { vectors: [vector] },
      {
        headers: {
          "Api-Key": PINECONE_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`[PINECONE] Vetor upsert OK: ${vector.id}`);
  } catch (err) {
    console.error("[PINECONE] Falha no upsert:", err.response?.data || err.message);
  }
}

module.exports = { registrarLogSemantico };
