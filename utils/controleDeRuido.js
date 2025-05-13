const axios = require("axios");
const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const {
  PINECONE_API_KEY,
  PINECONE_INDEX_URL
} = process.env;

/**
 * Gera embedding com OpenAI (text-embedding-ada-002)
 * @param {string} text
 * @returns {Promise<number[]>}
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
 * Consulta Pinecone por similaridade vetorial
 * @param {string} text
 * @param {number} topK
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

/**
 * Busca todos os vetores da Pinecone com paginação automática
 * @returns {Promise<Array<{ id: string, metadata: object }>>}
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

/**
 * Detecta se uma mensagem é ruído (curta, automatizada ou irrelevante).
 * @param {string} texto
 * @returns {boolean}
 */
function mensagemEhRuido(texto = "") {
  const normalizado = texto.trim().toLowerCase();

  const padroes = [
    "ok", "👍", "👋", "obrigado", "brigado", "valeu",
    "boa tarde", "bom dia", "boa noite", "certo", "entendi",
    "😊", "🙌", "sim", "não", "obg", "grato", "agradeço",
    "kkk", "haha", "blz", "👍🏻", "😅", "😄"
  ];

  return (
    normalizado.length < 3 ||
    padroes.some(p => normalizado === p || normalizado.includes(p)) ||
    /^[\W\d\s]+$/.test(normalizado) // Apenas símbolos ou números
  );
}

module.exports = {
  gerarEmbedding,
  buscarMemoria,
  buscarTodosLogs,
  mensagemEhRuido
};
