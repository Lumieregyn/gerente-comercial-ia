// utils/logsIA.js
const axios    = require("axios");
const { v4: uuidv4 } = require("uuid");

const PINECONE_API_KEY   = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_URL = process.env.PINECONE_INDEX_URL; 
// e.g. https://lumiere-logs-gqv3rnm.svc.aped-4627-b74a.pinecone.io

async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes = {} }) {
  const vector = {
    id: uuidv4(),
    text: texto,       // **IMPORTANTE**: use exatamente "text", nada de "content" ou outro nome
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
    console.error("[PINECONE] Falha no upsert via REST:", err.response?.data || err.message);
  }
}

module.exports = { registrarLogSemantico };
