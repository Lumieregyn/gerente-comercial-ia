// /utils/logsIA.js

const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");
const crypto = require("crypto");

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const INDEX_NAME = "lumiere-logs";
const NAMESPACE = "atendimentos"; // opcional, se quiser segmentar

async function gerarEmbedding(texto) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texto
  });
  return response.data[0].embedding;
}

async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes = {} }) {
  try {
    const index = pinecone.Index(INDEX_NAME);
    const vetor = await gerarEmbedding(texto);
    const id = crypto.randomUUID();

    await index.upsert([
      {
        id,
        values: vetor,
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
      }
    ], NAMESPACE);

    console.log("[LOG IA] Registrado com sucesso em memória semântica.");
  } catch (err) {
    console.error("[ERRO LOG IA]", err.message);
  }
}

module.exports = { registrarLogSemantico };
