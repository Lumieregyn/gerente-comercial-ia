// utils/logsIA.js

import { v4 as uuidv4 } from "uuid";
import { PineconeClient } from "@pinecone-database/pinecone";

const {
  PINECONE_API_KEY,
  PINECONE_ENVIRONMENT,
  PINECONE_INDEX_NAME,
} = process.env;

const pinecone = new PineconeClient();

let index;
async function initPinecone() {
  if (index) return;
  await pinecone.init({
    apiKey: PINECONE_API_KEY,
    environment: PINECONE_ENVIRONMENT,
  });
  index = pinecone.Index(PINECONE_INDEX_NAME);
}

export async function registrarLogSemantico({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes }) {
  try {
    await initPinecone();

    const id = uuidv4();
    const record = {
      id,
      // o campo "text" será automaticamente embarcado em um vetor de dimensão 1024
      text: `[${evento}] cliente=${cliente} vendedor=${vendedor} tipo=${tipo}\n${texto}\n→ decisão: ${decisaoIA}`,
      metadata: {
        cliente,
        vendedor,
        evento,
        tipo,
        decisaoIA,
        detalhes,
        timestamp: new Date().toISOString(),
      },
    };

    await index.upsert({
      records: [record],
    });

    console.log(`[PINECONE] log upserted id=${id}`);
  } catch (err) {
    console.error("[PINECONE] Falha no upsert:", err);
  }
}
