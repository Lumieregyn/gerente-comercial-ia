// utils/logsIA.js

const { v4: uuidv4 } = require("uuid");
const pineconeModule = require("@pinecone-database/pinecone");

// fallback para encontrar a classe correta
const PineconeConstructor =
  pineconeModule.PineconeClient ||
  pineconeModule.Pinecone ||
  pineconeModule.default ||
  null;

if (!PineconeConstructor) {
  console.error(
    "[PINECONE] Falha ao inicializar: não encontrei PineconeClient, Pinecone ou default no módulo!"
  );
}

const {
  PINECONE_API_KEY,
  PINECONE_ENVIRONMENT,
  PINECONE_INDEX_NAME,
} = process.env;

let index = null;

async function initPinecone() {
  if (index || !PineconeConstructor) return;
  try {
    // v5.x usa init({ apiKey, environment })
    const client = new PineconeConstructor();
    if (typeof client.init === "function") {
      await client.init({
        apiKey: PINECONE_API_KEY,
        environment: PINECONE_ENVIRONMENT,
      });
    } else if (client.ApiKey) {
      // fallback antigo
      client.ApiKey = PINECONE_API_KEY;
      client.Environment = PINECONE_ENVIRONMENT;
    }
    index = client.Index
      ? client.Index(PINECONE_INDEX_NAME)
      : client.Indexes?.get(PINECONE_INDEX_NAME);
    console.log(`[PINECONE] inicializado: ${PINECONE_INDEX_NAME}`);
  } catch (err) {
    console.error("[PINECONE] Falha ao inicializar:", err);
  }
}

/**
 * Registra um log semântico no Pinecone (via integrated embedding).
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
  await initPinecone();
  if (!index) return;

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

  try {
    await index.upsert({ records: [record] });
    console.log(`[PINECONE] log upserted id=${id}`);
  } catch (err) {
    console.error("[PINECONE] Falha no upsert:", err);
  }
}

module.exports = {
  registrarLogSemantico,
};
