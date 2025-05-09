// utils/logsIA.js

const { v4: uuidv4 } = require("uuid");
const pineconeModule = require("@pinecone-database/pinecone");

// fallback para descobrir onde está a classe
const PineconeConstructor =
  // nome oficial na v5.x
  pineconeModule.PineconeClient ||
  // alias possível
  pineconeModule.Pinecone ||
  // se exportou como default
  pineconeModule.default ||
  // se o require retornou a função diretamente
  (typeof pineconeModule === "function" ? pineconeModule : null);

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
    // instanciação conforme v5.x
    const client = new PineconeConstructor();
    await client.init({
      apiKey: PINECONE_API_KEY,
      environment: PINECONE_ENVIRONMENT,
    });
    // aponta para o índice
    index = client.Index(PINECONE_INDEX_NAME);
    console.log(`[PINECONE] inicializado: ${PINECONE_INDEX_NAME}`);
  } catch (err) {
    console.error("[PINECONE] Falha ao inicializar:", err);
  }
}

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
    metadata: { cliente, vendedor, evento, tipo, decisaoIA, detalhes, timestamp: new Date().toISOString() },
  };

  try {
    await index.upsert({ records: [record] });
    console.log(`[PINECONE] log upserted id=${id}`);
  } catch (err) {
    console.error("[PINECONE] Falha no upsert:", err);
  }
}

module.exports = { registrarLogSemantico };
