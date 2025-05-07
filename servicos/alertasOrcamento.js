const { enviarMensagem } = require("./enviarMensagem");
const MENSAGENS = require("../utils/mensagens");
const { horasUteisEntreDatas } = require("../utils/horario-util");
const { verificarRespostaOuEscalonar } = require("./verificarRespostaVendedor");
const { dentroDoHorarioUtil } = require("../utils/dentroDoHorarioUtil");

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

/**
 * Dispara alertas conforme tempo útil e verifica resposta em 10 min
 */
async function processarAlertaDeOrcamento({ nomeCliente, nomeVendedor, numeroVendedor, criadoEm, texto }) {
  // ❌ Fora do horário? Pausa tudo
  if (!dentroDoHorarioUtil()) {
    console.log("[PAUSA] Fora do horário útil. Alerta não será enviado.");
    return;
  }

  const horas = horasUteisEntreDatas(criadoEm, new Date());

  if (horas >= 18) {
    await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeVendedor, nomeCliente));

    setTimeout(() => {
      verificarRespostaOuEscalonar({
        nomeCliente,
        nomeVendedor,
        numeroVendedor
      });
    }, 10 * 60 * 1000);

  } else if (horas >= 12) {
    await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeVendedor, nomeCliente));
  } else if (horas >= 6) {
    await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeVendedor, nomeCliente));
  } else {
    console.log(`[INFO] Cliente ${nomeCliente} ainda não atingiu 6h úteis de espera.`);
  }
}

module.exports = { processarAlertaDeOrcamento };
