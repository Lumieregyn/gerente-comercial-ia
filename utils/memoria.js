// utils/memoria.js

const axios      = require("axios");
const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const {
  PINECONE_API_KEY,
  PINECONE_INDEX_URL
} = process.env;

/**
 * Gera embedding via OpenAI (text-embedding-ada-002).
 * @param {string} text
 * @returns {number[]} vetor de 1536 floats
 */
async function gerarEmbedding(text) {
  const resp = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text
  });
  return resp.data[0].embedding;
}

/**
 * Busca os N registros mais similares ao texto de consulta, filtrando por cliente.
 * @param {string} text
 * @param {string} cliente
 * @param {number} topK
 * @returns {Promise<Array<{score:number, metadata:object}>>}
 */
async function buscarMemoria(text, cliente, topK = 5) {
  const vector = await gerarEmbedding(text);

  const body = {
    topK,
    includeMetadata: true,
    vector,
    filter: {
      cliente
    }
  };

  const resp = await axios.post(
    `${PINECONE_INDEX_URL}/query`,
    body,
    { headers: { "Api-Key": PINECONE_API_KEY } }
  );

  return resp.data.matches.map(m => ({
    score: m.score,
    metadata: m.metadata
  }));
}

/**
 * Monta contexto com base na memória do cliente
 * @param {string} clienteId 
 * @param {string} texto 
 * @returns {string}
 */
async function montarPromptComMemoria(clienteId, texto) {
  const memorias = await buscarMemoria(texto, clienteId, 5);
  return memorias.length
    ? memorias.map(m => `🧠 ${m.metadata.texto}`).join("\n")
    : "🧠 Nenhum histórico relevante encontrado.";
}

module.exports = {
  buscarMemoria,
  montarPromptComMemoria
};
