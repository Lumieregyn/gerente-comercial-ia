const frasesFracas = [
  "só conferindo",
  "ok",
  "blz",
  "beleza",
  "isso",
  "tá bom",
  "👍",
  "confirmado",
  "valeu",
  "entendido"
];

function mensagemEhRuido(texto) {
  if (!texto) return true;

  const t = texto.trim().toLowerCase();
  if (t.length <= 3) return true;

  return frasesFracas.some(f => t.includes(f));
}

module.exports = { mensagemEhRuido };
