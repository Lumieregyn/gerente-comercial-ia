// utils/logsIA.js

const axios        = require("axios");
const { OpenAI }   = require("openai");
const { v4: uuidv4 } = require("uuid");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Variáveis de ambiente que você deve ter definidas:
// PINECONE_API_KEY, PINECONE_INDEX_URL (ex: https://lumiere-logs-ada-xxx.svc.us-east-1.pinecone.io)

const PINECONE_API_KEY   = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_URL = process.env.PINECONE_INDEX_URL; 

if (!PINECONE_API_KEY || !PINECONE_INDEX_URL) {
  console.warn("[PINECONE] Variáveis PINECONE_API_KEY ou PINECONE_INDEX_URL não configuradas.");
}

/**
 * Registra um log semântico no Pinecone usando embedding local (ADA-002) e REST upsert.
 * @param {{cliente:string,vendedor:string,evento:string,tipo:string,texto:string,decisaoIA:string,detalhes?:object}} opts
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
  // 1) Cria o embedding localmente
  let values;
  try {
    const resp = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: texto,
    });
    values = resp.data[0].embedding; // array de 1536 floats
  } catch (err) {
    console.error("[IA] Erro ao gerar embedding:", err.message);
    return;
  }

  // 2) Monta o vetor para upsert
  const vector = {
    const asciiCliente = cliente.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, "_");
id: `cliente_${asciiCliente}_log_${uuidv4()}`,
, // Agrupamento por cliente
    values,
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

  // 3) Faz o upsert via REST no seu índice Pinecone
  try {
    await axios.post(
      `${PINECONE_INDEX_URL}/vectors/upsert`,
      { vectors: [vector] },
      {
        headers: {
          "Api-Key": PINECONE_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`[PINECONE] Vetor upsert OK: ${vector.id}`);
  } catch (err) {
    console.error(
      "[PINECONE] Falha no upsert via REST:",
      err.response?.data || err.message
    );
  }
}

module.exports = { registrarLogSemantico };
