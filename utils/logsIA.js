// utils/logsIA.js

const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let pineconeIndex = null;

// Promise única de inicialização
const initPromise = (async () => {
  try {
    // Import dinâmico do ESM da Pinecone v5+
    const pineconePkg = await import("@pinecone-database/pinecone");
    // Fallback entre named export e default export
    const PineconeClass = pineconePkg.Pinecone ?? pineconePkg.default;
    if (typeof PineconeClass !== "function") {
      throw new Error("Classe Pinecone não encontrada no módulo");
    }

    // Instancia com chave e ambiente
    const pinecone = new PineconeClass({
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT, // ex: "us-east-1"
    });

    pineconeIndex = pinecone.Index("lumiere-logs");
    console.log("[PINECONE] Conexão com índice (v5.x) estabelecida.");
  } catch (err) {
    console.error("[PINECONE] Falha ao inicializar:", err.message);
  }
})();

// Gera embedding com OpenAI
async function gerarEmbedding(texto) {
  try {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: texto,
    });
    return res.data[0].embedding;
  } catch (err) {
    console.error("[IA] Erro ao gerar embedding:", err.message);
    return null;
  }
}

// Registra log semântico no Pinecone, aguardando initPromise
async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes = {} }) {
  // Garante que o índice foi inicializado
  await initPromise;

  if (!pineconeIndex) {
    console.warn("[PINECONE] Índice não ficou pronto.");
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
      timestamp: new Date().toISOString(),
    },
  };

  try {
    // upsert espera objeto com key 'vectors' na v5.x
    await pineconeIndex.upsert({ vectors: [vector] });
    console.log(`[PINECONE] Registro inserido: ${evento} (${cliente})`);
  } catch (err) {
    console.error("[PINECONE] Falha ao upsert:", err.message);
  }
}

module.exports = { registrarLogSemantico };
