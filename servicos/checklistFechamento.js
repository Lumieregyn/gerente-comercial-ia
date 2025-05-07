const { enviarMensagem } = require("./enviarMensagem");
const MENSAGENS = require("../utils/mensagens");

async function checklistFechamento({ nomeCliente, nomeVendedor, numeroVendedor, contexto, texto }) {
  const pendencias = [];

  const contextoCompleto = `${texto}\n${contexto}`.toLowerCase();

  // 1. Verifica imagem do produto
  if (!contextoCompleto.includes("imagem")) {
    pendencias.push("❌ *Imagem do produto não localizada ou não enviada*");
  }

  // 2. Cor do produto
  const temCor = /(preto|branco|dourado|cobre|inox|bronze|bege)/.test(contextoCompleto);
  if (!temCor) {
    pendencias.push("❌ *Cor do produto não informada*");
  }

  // 3. Tipo/modelo (plafon, pendente, etc.)
  const temTipo = /(plafon|pendente|arandela|embutido|trilho|trilho|spot|lustre)/.test(contextoCompleto);
  if (!temTipo) {
    pendencias.push("❌ *Modelo ou tipo da luminária não identificado*");
  }

  // 4. Tensão
  if (!contextoCompleto.includes("110") && !contextoCompleto.includes("220")) {
    pendencias.push("❌ *Tensão elétrica (110V ou 220V) não informada*");
  }

  // 5. Prazo de produção e entrega
  const temPrazo1 = /(produção|dispon[ií]vel|pronto|estoque|fabricado|fabricar)/.test(contextoCompleto);
  const temPrazo2 = /(entrega|envio|transporte|frete)/.test(contextoCompleto);
  if (!temPrazo1 || !temPrazo2) {
    pendencias.push("❌ *Prazos de produção ou entrega incompletos*");
  }

  // 6. Formalização de pedido especial
  const produtoEspecial = contextoCompleto.includes("pedido") || contextoCompleto.includes("sob medida");
  if (produtoEspecial && !contextoCompleto.includes("aprovado") && !contextoCompleto.includes("confirmado")) {
    pendencias.push("❌ *Pedido especial não está claramente formalizado no atendimento*");
  }

  if (pendencias.length === 0) {
    console.log("[CHECKLIST] Atendimento validado. Nenhuma pendência encontrada.");
    return;
  }

  const corpo = pendencias.map(p => `* ${p}`).join("\n");
  const mensagem = MENSAGENS.alertaChecklist(nomeVendedor, nomeCliente, corpo);
  await enviarMensagem(numeroVendedor, mensagem);

  console.log(`[CHECKLIST] Pendências encontradas e alerta enviado para ${nomeVendedor}`);
}

module.exports = { checklistFechamento };
