const {
  gerarEmbedding,
  buscarMemoria,
  buscarTodosLogs,
} = require("./memoria");

/**
 * Detecta se uma mensagem é ruído (curta, automatizada ou irrelevante).
 * @param {string} texto
 * @returns {boolean}
 */
function mensagemEhRuido(texto = "") {
  const normalizado = texto.trim().toLowerCase();

  const padroes = [
    "ok", "👍", "👋", "obrigado", "brigado", "valeu",
    "boa tarde", "bom dia", "boa noite", "certo", "entendi",
    "😊", "🙌", "sim", "não", "obg", "grato", "agradeço",
    "kkk", "haha", "blz", "👍🏻", "😅", "😄"
  ];

  const padroesFrasesComuns = [
    "nossas boas vindas ao atendimento da",
    "para iniciarmos, qual o seu nome",
    "faço parte da equipe de atendimento",
    "obrigado por entrar em contato",
    "te encaminhei para um atendente",
    "em breve retornaremos",
    "estamos te transferindo",
    "sou atendente virtual",
    "em instantes você será atendido"
  ];

  return (
    normalizado.length < 3 ||
    padroes.some(p => normalizado === p || normalizado.includes(p)) ||
    padroesFrasesComuns.some(p => normalizado.includes(p)) ||
    /^[\W\d\s]+$/.test(normalizado)
  );
}

module.exports = {
  gerarEmbedding,
  buscarMemoria,
  buscarTodosLogs,
  mensagemEhRuido
};
