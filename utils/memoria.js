const axios = require("axios");
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
 * Busca os N registros mais similares ao texto de consulta.
 * @param {string} text
 * @param {number} topK
 * @returns {Promise<Array<{score:number, metadata:object}>>}
 */
async function buscarMemoria(text, topK = 5) {
  const vector = await gerarEmbedding(text);

  const resp = await axios.post(
    `${PINECONE_INDEX_URL}/query`,
    {
      topK,
      includeMetadata: true,
      vector
    },
    { headers: { "Api-Key": PINECONE_API_KEY } }
  );

  return resp.data.matches.map(m => ({
    score: m.score,
    metadata: m.metadata
  }));
}

/**
 * Busca todos os vetores da Pinecone com paginação.
 * @returns {Promise<Array<{id: string, metadata: object}>>}
 */
async function buscarTodosLogs() {
  let todos = [];
  let nextToken = null;

  do {
    const params = new URLSearchParams({
      includeMetadata: "true",
      limit: "1000"
    });
    if (nextToken) {
      params.append("next", nextToken);
    }

    const resp = await axios.get(
      `${PINECONE_INDEX_URL}/vectors?${params.toString()}`,
      { headers: { "Api-Key": PINECONE_API_KEY } }
    );

    const data = resp.data;
    todos.push(...(data.vectors || []));
    nextToken = data?.next;
  } while (nextToken);

  return todos;
}

module.exports = { buscarMemoria, buscarTodosLogs };
