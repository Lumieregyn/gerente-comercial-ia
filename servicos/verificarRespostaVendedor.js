const { enviarMensagem } = require("./enviarMensagem");
const MENSAGENS = require("../utils/mensagens");

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

async function verificarRespostaOuEscalonar({ nomeCliente, nomeVendedor, numeroVendedor }) {
  const houveResposta = true; // Altere para false se quiser simular sem resposta
  const respostaTexto = "Cliente disse que vai confirmar amanhã.";

  if (houveResposta && respostaTexto) {
    const foiPontual = true; // Altere para false para simular resposta atrasada

    const status = foiPontual ? "✅ Resposta dentro do prazo." : "⚠️ Resposta enviada com atraso.";
    const mensagem = `📩 *${nomeVendedor}:* ${respostaTexto}\n${status}`;

    await enviarMensagem(GRUPO_GESTORES_ID, mensagem);
    console.log(`[RESPOSTA VENDA] Resposta do vendedor encaminhada ao grupo (${status})`);
  } else {
    await enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeVendedor, nomeCliente));
    console.log(`[ESCALONAMENTO] Sem resposta detectada. Alerta final enviado ao grupo.`);
  }
}

module.exports = { verificarRespostaOuEscalonar };
