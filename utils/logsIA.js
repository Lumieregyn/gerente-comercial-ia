// utils/logsIA.js
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const PINECONE_API_KEY   = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_URL = process.env.PINECONE_INDEX_URL;

async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes = {} }) {
  const vector = {
    id: uuidv4(),
    text: texto,             // <-- campo text para o embedder integrado
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

  try {
    const resp = await axios.post(
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
    return resp.data;
  } catch (err) {
    console.error("[PINECONE] Falha no upsert via REST:", err.response?.data || err.message);
  }
}

module.exports = { registrarLogSemantico };
