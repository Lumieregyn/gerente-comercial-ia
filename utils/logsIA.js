// utils/logsIA.js

const { PineconeClient } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// PineconeClient v0.2.2
const pinecone = new PineconeClient();
let pineconeIndex = null;

// Inicializa Pinecone uma única vez
(async () => {
  try {
    await pinecone.init({
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT // ex: "us-east-1"
    });
    pineconeIndex = pinecone.Index("lumiere-logs");
    console.log("[PINECONE] Conexão com índice (v0.2.2) estabelecida.");
  } catch (err) {
    console.error("[PINECONE] Falha ao inicializar:", err.message);
  }
})();

// Gera embedding com OpenAI
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

// Registra log
async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes = {} }) {
  if (!pineconeIndex) {
    console.warn("[PINECONE] Índice não pronto ainda.");
    return;
  }
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

  try {
    await pineconeIndex.upsert([vector]);
    console.log(`[PINECONE] Log inserido: ${evento} (${cliente})`);
  } catch (err) {
    console.error("[PINECONE] Falha ao upsert:", err.message);
  }
}

module.exports = { registrarLogSemantico };
