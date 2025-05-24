const axios = require("axios");
const { dentroDoHorarioUtil } = require("../utils/dentroDoHorarioUtil");
const { logIA } = require("../utils/logger");
const calcularHorasUteis = require("../utils/horario-util");
const VENDEDORES = require("../vendedores.json");
const { normalizeNome } = require("../utils/normalizeNome");

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

  const grupo = VENDEDORES[normalizeNome(nomeVendedor)]?.grupoAlerta;
  if (!grupo) {
    console.warn(`[WARN] Grupo de alerta não encontrado para ${nomeVendedor}. Alerta não enviado.`);
    return;
  }

  const mensagem = `🚨 *Alerta de Orçamento Atrasado*\n\n⚠️ Prezado(a) *${nomeVendedor}*, o cliente *${nomeCliente}* está aguardando o orçamento há *${horasUteis} horas úteis*.\n\nSolicitamos providências para não comprometer o atendimento.`;

  await axios.post(`${process.env.WPP_URL}/send-message`, {
    number: grupo,
    message: mensagem
  });

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
