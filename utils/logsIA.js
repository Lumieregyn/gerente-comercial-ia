// utils/logsIA.js

const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let pineconeIndex = null;

// Carrega dinamicamente o PineconeClient (CommonJS ou ESM fallback)
const initPromise = (async () => {
  try {
    // Tenta require normal
    let PineconeClient;
    try {
      const pkg = require("@pinecone-database/pinecone");
      // fallback para CommonJS legados ou ESM transpiled
      PineconeClient =
        pkg.PineconeClient ||
        pkg.Pinecone ||
        (pkg.default && (pkg.default.PineconeClient || pkg.default.Pinecone)) ||
        pkg.default;
    } catch {
      // se require falhar (ESM puro), usa import
      const pkg = await import("@pinecone-database/pinecone");
      PineconeClient = pkg.PineconeClient || pkg.Pinecone;
    }

    if (typeof PineconeClient !== "function") {
      throw new Error("Não consegui encontrar o construtor PineconeClient/Pinecone");
    }

    // Instancia e inicializa
    const pinecone = new PineconeClient({
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT,
    });
    if (typeof pinecone.init === "function") {
      // v0.x usa init()
      await pinecone.init({
        apiKey: process.env.PINECONE_API_KEY,
        environment: process.env.PINECONE_ENVIRONMENT,
      });
    }
    pineconeIndex = pinecone.Index("lumiere-logs");
    console.log("[PINECONE] Conexão com índice estabelecida.");
  } catch (err) {
    console.error("[PINECONE] Falha ao inicializar:", err.message);
  }
})();

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
    metadata: { cliente, vendedor, evento, tipo, texto, decisaoIA, ...detalhes, timestamp: new Date().toISOString() },
  };

  try {
    // tanto v0.x (upsert([vectors])) quanto v5.x (upsert({ vectors }))
    if (typeof pineconeIndex.upsert === "function") {
      // detectar formato de assinatura
      const arity = pineconeIndex.upsert.length;
      if (arity === 1) {
        // v5.x
        await pineconeIndex.upsert({ vectors: [vector] });
      } else {
        // v0.x
        await pineconeIndex.upsert([vector]);
      }
    }
    console.log(`[PINECONE] Registro inserido: ${evento} (${cliente})`);
  } catch (err) {
    console.error("[PINECONE] Falha ao upsert:", err.message);
  }
}

module.exports = { registrarLogSemantico };
