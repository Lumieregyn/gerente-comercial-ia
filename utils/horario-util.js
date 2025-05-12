/**
 * Calcula horas úteis entre duas datas.
 * @param {Date} inicio
 * @param {Date} fim
 * @returns {number}
 */
function calcularHorasUteis(inicio, fim) {
  const HORARIO_INICIO = 8;
  const HORARIO_FIM = 19;

  let total = 0;
  let data = new Date(inicio);

  while (data < fim) {
    const hora = data.getHours();
    const dia = data.getDay();

    if (dia >= 1 && dia <= 5 && hora >= HORARIO_INICIO && hora < HORARIO_FIM) {
      total++;
    }

    data.setHours(data.getHours() + 1);
  }

  return total;
}

module.exports = calcularHorasUteis;
