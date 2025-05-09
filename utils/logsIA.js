// utils/logsIA.js

const { v4: uuidv4 } = require("uuid");
const { Pinecone } = require("@pinecone-database/pinecone");

const {
  PINECONE_API_KEY,
  PINECONE_ENVIRONMENT,
  PINECONE_INDEX_NAME,
} = process.env;

let indexInstance = null;

// inicializa o client Pinecone e seleciona o index
async function initPinecone() {
  if (!indexInstance) {
    const pinecone = new Pinecone();
    await pinecone.init({
      apiKey: PINECONE_API_KEY,
      environment: PINECONE_ENVIRONMENT,
    });
    indexInstance = pinecone.Index(PINECONE_INDEX_NAME);
    console.log("[PINECONE] inicializado:", PINECONE_INDEX_NAME);
  }
}

/**
 * Registra um log semântico no Pinecone.
 * @param {{ cliente: string, vendedor: string, evento: string, tipo: string, texto: string, decisaoIA: string, detalhes?: object }} opts
 */
async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes }) {
  try {
    await initPinecone();

    const id = uuidv4();
    const record = {
      id,
      // ao usar Integrated Embedding, o campo `text` será convertido
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
