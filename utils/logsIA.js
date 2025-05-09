// utils/logsIA.js

const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let pineconeIndex = null;

// Inicialização única do PineconeClient, seja v0.x ou v5.x
const initPromise = (async () => {
  try {
    let PineconeClient;

    // 1) Tenta require (CommonJS)
    try {
      const pkg = require("@pinecone-database/pinecone");
      PineconeClient = pkg.PineconeClient;      // v0.x
      if (!PineconeClient && pkg.default) {
        PineconeClient = pkg.default.PineconeClient; // possivelmente v5.x
      }
      if (!PineconeClient) throw new Error("nenhum export PineconeClient no require");
    } catch {
      // 2) Fallback para import ESM
      const pkg = await import("@pinecone-database/pinecone");
      PineconeClient = pkg.PineconeClient || (pkg.default && pkg.default.PineconeClient);
      if (!PineconeClient) throw new Error("nenhum export PineconeClient no import");
    }

    // 3) Instancia e inicializa
    const client = new PineconeClient();
    // v0.x tem init, v5.x também
    if (typeof client.init === "function") {
      await client.init({
        apiKey: process.env.PINECONE_API_KEY,
        environment: process.env.PINECONE_ENVIRONMENT // ex: "us-east-1"
      });
    }
    pineconeIndex = client.Index("lumiere-logs");
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

// Registra log no Pinecone
async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes = {} }) {
  // aguarda a inicialização
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
    // suporta tanto assinatura v0.x (upsert([vectors])) quanto v5.x (upsert({ vectors }))
    if (pineconeIndex.upsert.length === 1) {
      // v5.x
      await pineconeIndex.upsert({ vectors: [vector] });
    } else {
      // v0.x
      await pineconeIndex.upsert([vector]);
    }
    console.log(`[PINECONE] Registro inserido: ${evento} (${cliente})`);
  } catch (err) {
    console.error("[PINECONE] Falha ao upsert:", err.message);
  }
}

module.exports = { registrarLogSemantico };
