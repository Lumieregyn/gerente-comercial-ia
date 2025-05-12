const axios = require("axios");
const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_URL = process.env.PINECONE_INDEX_URL;

if (!PINECONE_API_KEY || !PINECONE_INDEX_URL) {
  console.warn("[PINECONE] Variáveis PINECONE_API_KEY ou PINECONE_INDEX_URL não configuradas.");
}

/**
 * Sanitiza nomes para garantir que o ID do vetor seja ASCII seguro.
 */
function sanitize(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^\w\s]/gi, "")        // remove pontuação
    .replace(/\s+/g, "_");           // espaços para _
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
  // ignora logs sem texto válido
  if (!texto || texto.trim().length < 3) {
    console.warn("[LOGIA] Ignorado: texto vazio ou muito curto.");
    return;
  }

  // 1) Cria o embedding localmente
  let values;
  try {
    const resp = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: texto,
    });
    values = resp.data[0].embedding;
  } catch (err) {
    console.error("[IA] Erro ao gerar embedding:", err.message);
    return;
  }

  // 2) Monta o ID sanitizado
  const idSanitizado = `cliente_${sanitize(cliente)}_log_${uuidv4()}`;

  // 3) Monta o vetor para upsert
  const vector = {
    id: idSanitizado,
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

  // 4) Faz o upsert via REST no seu índice Pinecone
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
