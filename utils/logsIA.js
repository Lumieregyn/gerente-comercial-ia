const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

const indexName = "lumiere-logs";
const namespace = undefined;

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

async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes = {} }) {
  try {
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

    const index = pinecone.index(indexName);
    await index.upsert([vector], namespace);

    console.log(`[PINECONE] Registro inserido: ${evento} (${cliente})`);
  } catch (err) {
    console.error("[PINECONE] Falha ao registrar log:", err.message);
  }
}

module.exports = { registrarLogSemantico };
