const { enviarMensagem } = require("./enviarMensagem");
const MENSAGENS = require("../utils/mensagens");

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

/**
 * Verifica se o vendedor respondeu em até 10 minutos e encaminha para o grupo
 */
async function verificarRespostaOuEscalonar({ nomeCliente, nomeVendedor, numeroVendedor }) {
  const houveResposta = false; // simulação por enquanto
  const respostaTexto = null;  // poderia ser algo tipo "Cliente solicitou alteração no projeto..."

  if (houveResposta && respostaTexto) {
    await enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.respostaVendedor(nomeVendedor, respostaTexto));
    console.log(`[ROTEAMENTO] Resposta do vendedor encaminhada com status OK.`);
  } else {
    await enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeVendedor, nomeCliente));
    console.log(`[ROTEAMENTO] Nenhuma resposta detectada. Escalonado para grupo.`);
  }
}

module.exports = { verificarRespostaOuEscalonar };
