const { enviarMensagem } = require("./enviarMensagem");
const MENSAGENS = require("../utils/mensagens");

async function checklistFechamento({ nomeCliente, nomeVendedor, numeroVendedor, contexto, texto }) {
  const pendencias = [];

  // 🔍 Verificações básicas simuladas
  if (!contexto.includes("prazo")) {
    pendencias.push("❌ *Prazo de entrega ou produção não informado*");
  }

  if (!contexto.match(/110|220/)) {
    pendencias.push("❌ *Tensão elétrica (110V ou 220V) não foi confirmada*");
  }

  if (contexto.includes("pedido") && !contexto.includes("imagem")) {
    pendencias.push("❌ *Produto sem imagem ou descrição clara*");
  }

  // ... aqui podemos evoluir para comparar PDF vs imagem, cor, modelo etc.

  if (pendencias.length === 0) {
    console.log("[CHECKLIST] Tudo OK. Nenhum alerta gerado.");
    return;
  }

  const corpo = pendencias.map(p => `* ${p}`).join("\n");

  const mensagem = MENSAGENS.alertaChecklist(nomeVendedor, nomeCliente, corpo);
  await enviarMensagem(numeroVendedor, mensagem);
  console.log(`[CHECKLIST] Alerta enviado para ${nomeVendedor}.`);
}

module.exports = { checklistFechamento };
