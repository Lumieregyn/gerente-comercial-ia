const axios = require("axios");
const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { PINECONE_API_KEY, PINECONE_INDEX_URL } = process.env;

/**
 * Gera o vetor de embedding com o modelo da OpenAI (text-embedding-ada-002)
 * @param {string} text - Texto que será convertido em vetor.
 * @returns {Promise<number[]>} Vetor com 1536 dimensões.
 */
async function gerarEmbedding(text) {
  if (!text || text.trim().length < 1) {
    throw new Error("Texto vazio para embedding");
  }

  const resp = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text
  });

  return resp.data[0].embedding;
}

/**
 * Consulta no Pinecone os registros mais similares ao texto informado.
 * @param {string} text - Consulta textual a ser transformada em embedding.
 * @param {number} topK - Quantidade de resultados mais próximos.
 * @returns {Promise<Array<{ score: number, metadata: object }>>}
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

module.exports = {
  buscarMemoria,
  gerarEmbedding
};
