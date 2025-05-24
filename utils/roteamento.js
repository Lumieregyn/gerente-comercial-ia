const VENDEDORES = require("../vendedores.json");
const { normalizeNome } = require("./normalizeNome");

/**
 * Retorna o ID do grupo de alerta do vendedor, validando existência e formato.
 * Se inválido, loga o erro e retorna null.
 */
function obterGrupoDoVendedor(nomeVendedor) {
  const chave = normalizeNome(nomeVendedor);
  const vendedor = VENDEDORES[chave];

  if (!vendedor) {
    console.warn(`[ERRO] Vendedor "${nomeVendedor}" não encontrado no vendedores.json`);
    return null;
  }

  if (!vendedor.grupoAlerta || !vendedor.grupoAlerta.endsWith("@g.us")) {
    console.warn(`[ERRO] grupoAlerta inválido ou ausente para "${nomeVendedor}".`);
    return null;
  }

  return vendedor.grupoAlerta;
}

module.exports = { obterGrupoDoVendedor };
