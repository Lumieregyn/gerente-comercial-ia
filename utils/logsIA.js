// utils/logsIA.js

const axios     = require("axios");
const { v4: uuidv4 } = require("uuid");
const { OpenAI }= require("openai");

const {
  PINECONE_API_KEY,
  PINECONE_ENVIRONMENT,
  PINECONE_INDEX_NAME,
  OPENAI_API_KEY
} = process.env;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

let pineconeClient = null;
let indexInstance  = null;

// Importa dinamicamente o módulo ESM do Pinecone
async function getPineconeClient() {
  if (pineconeClient) return pineconeClient;
  const mod = await import("@pinecone-database/pinecone");
  // pega a classe exportada
  pineconeClient = mod.PineconeClient || mod.Pinecone;
  if (typeof pineconeClient !== "function") {
    throw new Error("Não encontrei PineconeClient no módulo ESM");
  }
  return pineconeClient;
}

// Inicializa o client e o index
async function initPinecone() {
  if (indexInstance) return indexInstance;

  const Client = await getPineconeClient();
  const client = new Client();
  await client.init({
    apiKey:    PINECONE_API_KEY,
    environment: PINECONE_ENVIRONMENT
  });
  indexInstance = client.Index(PINECONE_INDEX_NAME);
  console.log(`[PINECONE] inicializado: ${PINECONE_INDEX_NAME}`);
  return indexInstance;
}

/**
 * Registra um log semântico no Pinecone:
 * 1) Gera embedding local via OpenAI (ADA-002)
 * 2) Faz upsert via REST no índice de 1536 dims
 */
async function registrarLogSemantico({
  cliente,
  vendedor,
  evento,
  tipo,
  texto,
  decisaoIA,
  detalhes = {}
}) {
  try {
    const idx = await initPinecone();

    // 1) gera embedding
    const embRes = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: texto
    });
    const values = embRes.data[0].embedding; // array de 1536 floats

    // 2) upsert
    const id = uuidv4();
    await idx.upsert({
      upsertRequest: {
        vectors: [{
          id,
          values,
          metadata: {
            cliente,
            vendedor,
            evento,
            tipo,
            texto,
            decisaoIA,
            detalhes,
            timestamp: new Date().toISOString()
          }
        }]
      }
    });

    console.log(`[PINECONE] Vetor upsert OK: ${id}`);
  } catch (err) {
    console.error("[PINECONE] Falha no upsert:", err.response?.data || err.message);
  }
}

module.exports = { registrarLogSemantico };
