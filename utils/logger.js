// utils/logger.js

const { registrarLogSemantico } = require("./logsIA");

/**
 * Log semântico para eventos relacionados à IA Gerente Comercial.
 * @param {Object} params - Detalhes do log.
 * @param {string} params.cliente - Nome do cliente.
 * @param {string} params.vendedor - Nome do vendedor responsável.
 * @param {string} params.evento - Descrição do evento (ex: "Checklist executado").
 * @param {string} params.tipo - Tipo do evento ("alerta", "checklist", "erro", "observacao", etc).
 * @param {string} params.texto - Texto analisado ou conteúdo de origem.
 * @param {string} params.decisaoIA - Descrição da ação ou decisão da IA.
 * @param {Object} [params.detalhes] - Detalhes extras para enriquecer a consulta semântica.
 */
async function logIA({ cliente, vendedor, evento, tipo, texto, decisaoIA, detalhes = {} }) {
  try {
    await registrarLogSemantico({
      cliente,
      vendedor,
      evento,
      tipo,
      texto,
      decisaoIA,
      detalhes
    });
  } catch (err) {
    console.error("[LOGGER] Falha ao registrar log IA:", err.message);
  }
}

module.exports = { logIA };
