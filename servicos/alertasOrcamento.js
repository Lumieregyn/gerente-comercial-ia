const { enviarMensagem } = require("./enviarMensagem");
const MENSAGENS = require("../utils/mensagens");
const { horasUteisEntreDatas } = require("../utils/horario-util");

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

/**
 * Dispara alertas conforme tempo útil e verifica resposta em 10 min
 */
async function processarAlertaDeOrcamento({ nomeCliente, nomeVendedor, numeroVendedor, criadoEm, texto }) {
  const horas = horasUteisEntreDatas(criadoEm, new Date());

  if (horas >= 18) {
    // Alerta final
    await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeVendedor, nomeCliente));

    // Monitorar resposta
    setTimeout(async () => {
      // Em versão futura: IA busca se houve resposta válida aqui
      const houveResposta = false; // Simulação
      if (!houveResposta) {
        await enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeVendedor, nomeCliente));
      }
    }, 10 * 60 * 1000); // 10 minutos

  } else if (horas >= 12) {
    await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeVendedor, nomeCliente));
  } else if (horas >= 6) {
    await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeVendedor, nomeCliente));
  } else {
    console.log(`[INFO] Cliente ${nomeCliente} ainda não atingiu 6h úteis de espera.`);
  }
}

module.exports = { processarAlertaDeOrcamento };
