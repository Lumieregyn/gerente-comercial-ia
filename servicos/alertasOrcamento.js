const { dentroDoHorarioUtil } = require("../utils/dentroDoHorarioUtil");
const { logIA } = require("../utils/logger");
const calcularHorasUteis = require("../utils/horario-util");

const HISTORICO = new Map();

async function processarAlertaDeOrcamento({ nomeCliente, nomeVendedor, numeroVendedor, criadoEm, texto }) {
  const textoCheck = texto.toLowerCase();
  if (!textoCheck.includes("orcamento") && !textoCheck.includes("preço") && !textoCheck.includes("valor")) {
    console.log(`[INFO] Mensagem sem indicativo claro de orçamento. Ignorado: "${texto}"`);
    return;
  }

  if (!dentroDoHorarioUtil()) {
    console.log("[PAUSA] Fora do horário útil. Alerta de orçamento não será processado.");
    return;
  }

  const chave = nomeCliente;
  const horaReferencia = criadoEm || new Date();

  if (!HISTORICO.has(chave)) {
    HISTORICO.set(chave, { inicio: horaReferencia });
  }

  const { inicio } = HISTORICO.get(chave);
  const horasUteis = calcularHorasUteis(inicio, new Date());

  if (horasUteis < 6) {
    console.log(`[INFO] Cliente ${nomeCliente} ainda não atingiu 6h úteis de espera.`);
    return;
  }

  console.log(`[ALERTA] Cliente ${nomeCliente} está aguardando orçamento há ${horasUteis}h úteis.`);
  await logIA({
    cliente: nomeCliente,
    vendedor: nomeVendedor,
    evento: "Orçamento em atraso",
    tipo: "alerta",
    texto: `Cliente esperando desde ${inicio.toISOString()}`,
    decisaoIA: "Aguardando orçamento há mais de 6h úteis"
  });
}

module.exports = { processarAlertaDeOrcamento };
