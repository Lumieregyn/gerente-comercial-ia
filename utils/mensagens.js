const MENSAGENS = {
  alerta1: (vendedor, cliente) => 
    `⚠️ Prezado(a) *${vendedor}*, informamos que o cliente *${cliente}* encontra-se há 6 horas úteis aguardando o orçamento solicitado.\nSolicitamos atenção para concluir o atendimento o quanto antes.\nAgradecemos pela colaboração.`,

  alerta2: (vendedor, cliente) =>
    `⚠️ Prezado(a) *${vendedor}*, reforçamos que o cliente *${cliente}* permanece aguardando o orçamento há 12 horas úteis.\nSolicitamos providências imediatas para evitar impacto negativo no atendimento.\nAguardamos seu retorno.`,

  alertaFinal: (vendedor, cliente) =>
    `🚨 Prezado(a) *${vendedor}*, o cliente *${cliente}* está há 18 horas úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.\nCaso contrário, o atendimento será transferido e a situação será registrada junto à Gerência Comercial IA.`,

  alertaGestores: (vendedor, cliente) =>
    `🚨 *Atenção Gerência Comercial IA:*\n\nO cliente *${cliente}* permaneceu 18 horas sem receber o orçamento solicitado e o vendedor *${vendedor}* não respondeu no prazo de 10 minutos.\nProvidências serão tomadas quanto à redistribuição do atendimento.`,

  alertaChecklist: (vendedor, cliente, lista) => 
    `✅ *Checklist Final de Fechamento - Análise IA*\n\n⚠️ Prezado(a) *${vendedor}*, ao revisar o atendimento com o cliente *${cliente}*, identificamos pendências que devem ser ajustadas antes de gerar o pedido:\n\n${lista}\n\n💡 Recomendamos validar com o cliente para garantir que tudo está alinhado e evitar problemas futuros.\n\n🤖 Análise automatizada e inteligente realizada pelo Gerente Comercial IA.`,

  respostaVendedor: (vendedor, msg) =>
    `📩 *${vendedor}:* ${msg}`
};

module.exports = MENSAGENS;
