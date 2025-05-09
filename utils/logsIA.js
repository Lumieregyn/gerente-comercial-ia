// utils/logsIA.js
// logo no início de utils/logsIA.js
;(async()=>{
  try {
    const pineconeModule = await import("@pinecone-database/pinecone");
    console.log("[DEBUG pineconeModule keys]", Object.keys(pineconeModule));
    console.log("[DEBUG pineconeModule default?]", typeof pineconeModule.default);
  } catch(err){
    console.error("[DEBUG pinecone import ERR]", err);
  }
})();

const { v4: uuidv4 } = require("uuid");

const {
  PINECONE_API_KEY,
  PINECONE_ENVIRONMENT,
  PINECONE_INDEX_NAME,
} = process.env;

let index = null;

async function initPinecone() {
  if (index) return;

  let pineconeMod;
  try {
    // import dinâmico para ESM
    pineconeMod = await import("@pinecone-database/pinecone");
  } catch (err) {
    console.error("[PINECONE] import falhou:", err);
    return;
  }

  // pega o construtor de todas as formas possíveis
  const PineconeClient =
    pineconeMod.PineconeClient ||
    pineconeMod.Pinecone ||
    pineconeMod.default?.PineconeClient ||
    pineconeMod.default;

  if (typeof PineconeClient !== "function") {
    console.error(
      "[PINECONE] Falha ao inicializar: não encontrei um construtor Pinecone válido no módulo!"
    );
    return;
  }

  try {
    const client = new PineconeClient();
    await client.init({
      apiKey: PINECONE_API_KEY,
      environment: PINECONE_ENVIRONMENT,
    });
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

module.exports = { registrarLogSemantico };
