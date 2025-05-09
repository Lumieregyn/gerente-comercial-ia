// utils/logsIA.js

const { v4: uuidv4 } = require("uuid");
const { PineconeClient } = require("@pinecone-database/pinecone");

const {
  PINECONE_API_KEY,
  PINECONE_ENVIRONMENT,
  PINECONE_INDEX_NAME,
} = process.env;

const pinecone = new PineconeClient();
let indexInstance = null;

// inicializa o client Pinecone e seleciona o index
async function initPinecone() {
  if (!indexInstance) {
    await pinecone.init({
      apiKey: PINECONE_API_KEY,
      environment: PINECONE_ENVIRONMENT,
    });
    indexInstance = pinecone.Index(PINECONE_INDEX_NAME);
    console.log("[PINECONE] Cliente inicializado, index:", PINECONE_INDEX_NAME);
  }
}

async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes }) {
  try {
    await initPinecone();

    const id = uuidv4();
    const record = {
      id,
      // "text" será convertido automaticamente em vetor de 1024 dims
      text: `[${evento}] cliente=${cliente} vendedor=${vendedor} tipo=${tipo}\n${texto}\n→ decisão: ${decisaoIA}`,
      metadata: {
        cliente,
        vendedor,
        evento,
        tipo,
        decisaoIA,
        detalhes: detalhes || {},
        timestamp: new Date().toISOString(),
      },
    };

    await indexInstance.upsert({
      records: [record],
    });

    console.log(`[PINECONE] log upserted id=${id}`);
  } catch (err) {
    console.error("[PINECONE] Falha no upsert:", err);
  }
}

module.exports = {
  registrarLogSemantico,
};
