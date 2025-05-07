function dentroDoHorarioUtil(data = new Date()) {
  const dia = data.getDay(); // 0 = domingo, 6 = sábado
  const hora = data.getHours();

  const diaUtil = dia >= 1 && dia <= 5; // segunda a sexta
  const horarioComercial = hora >= 8 && hora < 19;

  return diaUtil && horarioComercial;
}

module.exports = { dentroDoHorarioUtil };
