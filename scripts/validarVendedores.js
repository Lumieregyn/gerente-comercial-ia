const VENDEDORES = require("../vendedores.json");

function validarGruposVendedores() {
  console.log("🔍 Validando vendedores...\n");

  let total = 0;
  let semGrupo = 0;

  for (const nome in VENDEDORES) {
    total++;
    const vendedor = VENDEDORES[nome];

    if (!vendedor.grupoAlerta || !vendedor.grupoAlerta.endsWith("@g.us")) {
      console.warn(`⚠️ Vendedor "${nome}" está SEM grupoAlerta válido.`);
      semGrupo++;
    } else {
      console.log(`✅ ${nome} → grupo: ${vendedor.grupoAlerta}`);
    }
  }

  console.log(`\n📊 Resultado: ${total - semGrupo} com grupo | ${semGrupo} faltando | Total: ${total}`);
}

validarGruposVendedores();
