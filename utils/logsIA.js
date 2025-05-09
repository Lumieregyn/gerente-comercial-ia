// utils/logsIA.js

const { v4: uuidv4 } = require("uuid");
const { PineconeClient } = require("@pinecone-database/pinecone");

const {
  PINECONE_API_KEY,
  PINECONE_ENVIRONMENT,
  PINECONE_INDEX_NAME,
} = process.env;

let index = null;

/**
 * Inicializa o PineconeClient e aponta para o índice.
 */
async function initPinecone() {
  if (index) return;
  const client = new PineconeClient();
  await client.init({
    apiKey: PINECONE_API_KEY,
    environment: PINECONE_ENVIRONMENT,
  });
  index = client.Index(PINECONE_INDEX_NAME);
  console.log(`[PINECONE] inicializado: ${PINECONE_INDEX_NAME}`);
}

/**
 * Registra um log semântico no Pinecone (via Integrated Embedding).
 * @param {{cliente:string,vendedor:string,evento:string,tipo:string,texto:string,decisaoIA:string,detalhes?:object}} opts
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
  try {
    await initPinecone();

    const id = uuidv4();
    const record = {
      id,
      text: `[${evento}] cliente=${cliente} vendedor=${vendedor} tipo=${tipo}\n${texto}\n→ decisão: ${decisaoIA}`,
      metadata: {
        cliente,
        vendedor,
        evento,
        tipo,
        decisaoIA,
        detalhes,
        timestamp: new Date().toISOString(),
      },
    };

    // Usando integrated embedding: basta passar `records`
    await index.upsert({
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
