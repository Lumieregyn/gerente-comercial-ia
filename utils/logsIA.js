// utils/logsIA.js
const { PineconeClient } = require('@pinecone-database/pinecone');
const { OpenAI }       = require('openai');
const { v4: uuidv4 }   = require('uuid');

const pinecone = new PineconeClient();
let _initialized = false;

async function initPinecone() {
  if (_initialized) return;
  await pinecone.init({
    apiKey:    process.env.PINECONE_API_KEY,
    environment: process.env.PINECONE_ENVIRONMENT
  });
  _initialized = true;
}

const index = () => pinecone.Index(process.env.PINECONE_INDEX_NAME);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Registra um log semântico no Pinecone.
 * @param {Object} params
 * @param {string} params.cliente
 * @param {string} params.vendedor
 * @param {string} params.evento
 * @param {'analise'|'espera'|'alerta'} params.tipo
 * @param {string} params.texto
 * @param {string} params.decisaoIA
 * @param {Object} [params.detalhes]
 */
async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes }) {
  try {
    await initPinecone();

    // 1) gerar embedding do texto
    const embs = await openai.embeddings.create({
      model: 'text-embed-ada-002',
      input: texto
    });
    const vector = embs.data[0].embedding; // array de 1536 floats

    // 2) montar registro e upsert
    const id = uuidv4();
    await index().upsert({
      upsertRequest: {
        vectors: [{
          id,
          values: vector,
          metadata: {
            cliente,
            vendedor,
            evento,
            tipo,
            texto,
            decisaoIA,
            detalhes: detalhes || {},
            timestamp: new Date().toISOString()
          }
        }]
      }
    });

    console.log(`[PINECONE] Log upserted ${id}`);
  } catch (err) {
    console.error('[PINECONE] Falha no upsert:', err);
  }
}

module.exports = { registrarLogSemantico };
