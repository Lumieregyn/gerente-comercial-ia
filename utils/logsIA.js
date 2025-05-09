// utils/logsIA.js

const axios = require("axios");
const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_URL = process.env.PINECONE_INDEX_URL; 
// Exemplo: "https://lumiere-logs-xxxxxxxx.svc.us-east-1.pinecone.io"

if (!PINECONE_API_KEY || !PINECONE_INDEX_URL) {
  console.warn("[PINECONE] Attention: PINECONE_API_KEY or PINECONE_INDEX_URL not set.");
}

async function gerarEmbedding(texto) {
  try {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: texto
    });
    return res.data[0].embedding;
  } catch (err) {
    console.error("[IA] Erro ao gerar embedding:", err.message);
    return null;
  }
}

/**
 * Envia um vetor para o Pinecone via REST Upsert.
 * @param {Object} vector objeto com id, values e metadata.
 */
async function upsertVector(vector) {
  try {
    await axios.post(
      `${PINECONE_INDEX_URL}/vectors/upsert`,
      { vectors: [vector] },
      {
        headers: {
          "Api-Key": PINECONE_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );
    console.log(`[PINECONE] Vetor upsert OK: ${vector.id}`);
  } catch (err) {
    console.error("[PINECONE] Falha no upsert via REST:", err.message);
  }
}

/**
 * Registra um log semântico convertendo texto em embedding e enviando ao Pinecone.
 */
async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes = {} }) {
  if (!PINECONE_API_KEY || !PINECONE_INDEX_URL) return;

  const embedding = await gerarEmbedding(texto);
  if (!embedding) return;

  const vector = {
    id: uuidv4(),
    values: embedding,
    metadata: {
      cliente,
      vendedor,
      evento,
      tipo,
      texto,
      decisaoIA,
      ...detalhes,
      timestamp: new Date().toISOString()
    }
  };

  await upsertVector(vector);
}

module.exports = { registrarLogSemantico };
