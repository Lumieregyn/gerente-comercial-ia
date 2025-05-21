function dentroDoHorarioUtil(data = new Date()) {
  // Ajustar para o fuso de Brasília (GMT-3)
  const dataBrasil = new Date(data.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));

  const dia = dataBrasil.getDay(); // 0 = domingo, 6 = sábado
  const hora = dataBrasil.getHours();

  const diaUtil = dia >= 1 && dia <= 5; // segunda a sexta
  const horarioComercial = hora >= 8 && hora < 19;

  return diaUtil && horarioComercial;
}

module.exports = { dentroDoHorarioUtil };
