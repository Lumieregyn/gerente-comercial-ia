const { PineconeClient } = require('@pinecone-database/pinecone');
const { OpenAI } = require('openai');
const { v4: uuidv4 } = require('uuid');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const pinecone = new PineconeClient();
let pineconeIndex = null;

(async () => {
  try {
    await pinecone.init({
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT,
    });

    pineconeIndex = pinecone.Index('lumiere-logs');
    console.log('[PINECONE] Conexão com índice estabelecida.');
  } catch (err) {
    console.error('[PINECONE] Erro ao inicializar:', err.message);
  }
})();

async function gerarEmbedding(texto) {
  try {
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texto,
    });
    return res.data[0].embedding;
  } catch (err) {
    console.error('[IA] Erro ao gerar embedding:', err.message);
    return null;
  }
}

async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes = {} }) {
  try {
    if (!pineconeIndex) {
      console.warn('[PINECONE] Índice não está pronto ainda.');
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
        timestamp: new Date().toISOString(),
      },
    };

    await pineconeIndex.upsert({ vectors: [vector] });
    console.log(`[PINECONE] Registro inserido: ${evento} (${cliente})`);
  } catch (err) {
    console.error('[PINECONE] Falha ao registrar log:', err.message);
  }
}

module.exports = { registrarLogSemantico };
