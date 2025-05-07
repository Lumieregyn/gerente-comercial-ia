const { enviarMensagem } = require("./enviarMensagem");
const MENSAGENS = require("../utils/mensagens");

async function verificarPedidoEspecial({ nomeCliente, nomeVendedor, numeroVendedor, contexto }) {
  const texto = contexto.toLowerCase();
  const pendencias = [];

  const ehPedidoEspecial = texto.includes("pedido") && !texto.includes("sku") && !texto.includes("código");

  if (!ehPedidoEspecial) {
    console.log("[PEDIDO] Produto parece cadastrado. Sem alerta.");
    return;
  }

  if (!texto.includes("imagem")) {
    pendencias.push("❌ *Produto não tem imagem clara enviada ou referenciada*");
  }

  if (!texto.includes("aprovado") && !texto.includes("confirmado") && !texto.includes("pode seguir")) {
    pendencias.push("❌ *Falta confirmação do cliente no diálogo (ex: aprovado, pode seguir)*");
  }

  if (!texto.includes("prazo") && !texto.includes("disponível") && !texto.includes("entrega")) {
    pendencias.push("❌ *Prazos de produção ou entrega não informados*");
  }

  if (!texto.includes("tensão") && !texto.includes("110") && !texto.includes("220")) {
    pendencias.push("❌ *Tensão elétrica não confirmada com o cliente*");
  }

  if (pendencias.length === 0) {
    console.log("[PEDIDO] Produto especial formalizado corretamente.");
    return;
  }

  const corpo = pendencias.map(p => `* ${p}`).join("\n");

  const mensagem = `📎 *Alerta de Produto sem Cadastro Formal*\n\n⚠️ Prezado(a) *${nomeVendedor}*, ao revisar o atendimento com o cliente *${nomeCliente}*, identificamos que o item negociado parece ser um produto *sem cadastro padrão (SKU ou imagem)* e apresenta as seguintes pendências:\n\n${corpo}\n\n💡 Recomendamos revisar com o cliente antes de gerar o pedido.\n\n🤖 Gerente Comercial IA`;

  await enviarMensagem(numeroVendedor, mensagem);
  console.log(`[PEDIDO] Alerta de formalização incompleta enviado para ${nomeVendedor}`);
}

module.exports = { verificarPedidoEspecial };
