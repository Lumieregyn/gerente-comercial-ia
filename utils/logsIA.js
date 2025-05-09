// utils/logsIA.js

const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let pineconeIndex = null;

// Inicialização única do Pinecone 5.x via dynamic import
const initPromise = (async () => {
  try {
    // Carrega como ESM
    const pkg = await import("@pinecone-database/pinecone");
    const PineconeClass = pkg.Pinecone || pkg.default?.Pinecone;
    if (typeof PineconeClass !== "function") {
      throw new Error("Classe Pinecone não encontrada no módulo");
    }

    // Instancia e configura
    const pinecone = new PineconeClass({
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT // ex: "us-east-1"
    });

    // Obtém o índice
    pineconeIndex = pinecone.Index("lumiere-logs");
    console.log("[PINECONE] Conexão com índice estabelecida.");
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

// Registra log semântico aguardando initPromise
async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes = {} }) {
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
      timestamp: new Date().toISOString()
    }
  };

  try {
    // Na v5.x, upsert recebe um objeto com key 'vectors'
    await pineconeIndex.upsert({ vectors: [vector] });
    console.log(`[PINECONE] Registro inserido: ${evento} (${cliente})`);
  } catch (err) {
    console.error("[PINECONE] Falha ao upsert:", err.message);
  }
}

module.exports = { registrarLogSemantico };
