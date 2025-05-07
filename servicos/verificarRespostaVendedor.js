const { enviarMensagem } = require("./enviarMensagem");
const MENSAGENS = require("../utils/mensagens");

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

async function verificarRespostaOuEscalonar({ nomeCliente, nomeVendedor, numeroVendedor }) {
  // 🔁 Simulação: capturar uma resposta (isso virá de um webhook no futuro)
  const houveResposta = true; // mudar para false para simular atraso
  const respostaTexto = "Cliente solicitou alteração no modelo, vai confirmar amanhã.";

  if (houveResposta && respostaTexto) {
    const foiPontual = true; // aqui no futuro será comparado com o tempo real

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
