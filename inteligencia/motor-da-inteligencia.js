const axios = require("axios");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
const { horasUteisEntreDatas } = require("../utils/horario-util");
const { getCliente, marcarAlerta } = require("../utils/controleDeAlertas");
const { registrarLogSemantico } = require("../utils/logsIA");

class MotorIA {
  constructor({ openaiApiKey, vendedores, mensagens }) {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.vendedores = vendedores;
    this.mensagens = mensagens;
  }

  async extrairTextoPDF(url) { /* ...igual */ }
  async transcreverAudio(url) { /* ...igual */ }
  async construirContextoMultimodal(message = {}) { /* ...igual */ }

  validarPorPalavraChave(texto) {
    const termos = ["orçamento", "proposta", "valor", "preço", "quanto custa", "quanto fica", "me passa", "me envia"];
    const t = texto.toLowerCase();
    return termos.some(term => t.includes(term));
  }

  async detectarAguardandoOrcamento(cliente, contexto) {
  const prompt = `
Você é a Gerente Comercial IA da Lumiéregyn.

Sua função é identificar quando um cliente está aguardando o envio de um orçamento comercial com base em uma nova mensagem recebida. 

Analise se a seguinte mensagem **continua um contexto onde o cliente está esperando retorno da equipe comercial** com valores, proposta, aprovação ou fechamento.

Exemplos de mensagens que indicam essa expectativa:
- "Você conseguiu ver aquele valor?"
- "Pode seguir com aquela proposta"
- "Estou aguardando a proposta"
- "Vai ser aquela de 2 unidades mesmo"

Mensagens que NÃO indicam essa expectativa:
- "kkk"
- "tá bom, obrigado"
- "beleza, vamos falando"
- "qual seu nome?"

Agora avalie o caso a seguir:

Cliente: ${cliente}

Mensagem e contexto:

"${contexto}"

Responda apenas com "Sim" ou "Não".
`;

  const completion = await this.openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }]
  });

  const resposta = completion.choices[0].message.content.toLowerCase();
  return resposta.includes("sim");
}


  async decidirAlerta({ nomeCliente, nomeVendedor, numeroVendedor, criadoEm, texto, contexto }) {
    const agora = new Date();
    const clienteId = nomeCliente.toLowerCase().replace(/\s+/g, ".");

    await registrarLogSemantico({
      cliente: nomeCliente,
      vendedor: nomeVendedor,
      evento: "Nova mensagem recebida",
      tipo: "observacao",
      texto,
      decisaoIA: "Observação geral"
    });

    const aguardando = await this.detectarAguardandoOrcamento(nomeCliente, `${texto}\n${contexto}`);
    const validadoLocalmente = this.validarPorPalavraChave(texto + contexto);

    if (!aguardando || !validadoLocalmente) {
      await registrarLogSemantico({
        cliente: nomeCliente,
        vendedor: nomeVendedor,
        evento: "Análise de intenção",
        tipo: "analise",
        texto,
        decisaoIA: "Cliente não está aguardando orçamento (filtro IA + palavras-chave)"
      });
      return { status: "sem ação" };
    }

    const statusAtual = getCliente(clienteId) || {
      clienteId,
      vendedor: nomeVendedor,
      alertas: {},
      grupoGestoresAcionado: false
    };

    const horas = horasUteisEntreDatas(criadoEm, agora);
    let acao = null;

    if (horas >= 18 && !statusAtual.alertas["18h"]) {
      acao = "alertaFinal";
      marcarAlerta(clienteId, "18h");
    } else if (horas >= 12 && !statusAtual.alertas["12h"]) {
      acao = "alerta2";
      marcarAlerta(clienteId, "12h");
    } else if (horas >= 6 && !statusAtual.alertas["6h"]) {
      acao = "alerta1";
      marcarAlerta(clienteId, "6h");
    } else {
      await registrarLogSemantico({
        cliente: nomeCliente,
        vendedor: nomeVendedor,
        evento: "Monitoramento de atraso",
        tipo: "espera",
        texto,
        decisaoIA: `Cliente está aguardando, mas ainda não atingiu limite para alerta (${horas}h)`
      });
      return { status: "sem ação" };
    }

    const mensagem = this.mensagens[acao](nomeVendedor, nomeCliente);
    await axios.post(process.env.WPP_URL + "/send-message", {
      number: numeroVendedor,
      message: mensagem
    });

    await registrarLogSemantico({
      cliente: nomeCliente,
      vendedor: nomeVendedor,
      evento: `Envio de ${acao}`,
      tipo: "alerta",
      texto,
      decisaoIA: `Alerta ${acao} enviado com ${horas} horas úteis.`,
      detalhes: { tempoUtil: horas }
    });

    console.log(`[IA] ${acao} enviado para ${nomeVendedor} - ${nomeCliente}`);
    return { status: "alerta enviado", acao };
  }
}

module.exports = MotorIA;
