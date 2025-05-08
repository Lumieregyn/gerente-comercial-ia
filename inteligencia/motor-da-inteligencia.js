const axios = require("axios");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
const { horasUteisEntreDatas } = require("../utils/horario-util");
const { getCliente, atualizarCliente, marcarAlerta } = require("../utils/controleDeAlertas");
const { registrarLogSemantico } = require("../utils/logsIA");

class MotorIA {
  constructor({ openaiApiKey, vendedores, mensagens }) {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.vendedores = vendedores;
    this.mensagens = mensagens;
  }

  async extrairTextoPDF(url) {
    try {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      const data = await pdfParse(response.data);
      return data.text;
    } catch (err) {
      console.error("[ERRO PDF]", err.message);
      return "";
    }
  }

  async transcreverAudio(url) {
    try {
      const response = await axios.get(url, { responseType: "stream" });
      const transcription = await this.openai.audio.transcriptions.create({
        file: response.data,
        model: "whisper-1"
      });
      return transcription.text;
    } catch (err) {
      console.error("[ERRO ÁUDIO]", err.message);
      return "";
    }
  }

  async construirContextoMultimodal(message = {}) {
    const textoBase = message.text || message.caption || "";
    let textoExtra = "";

    const attachments = message.attachments || [];
    for (const att of attachments) {
      const url = att.payload?.url;
      if (att.type === "document" && url && att.FileName?.toLowerCase().endsWith(".pdf")) {
        textoExtra += "\n\n" + await this.extrairTextoPDF(url);
      } else if (att.type === "audio" && url) {
        textoExtra += "\n\n" + await this.transcreverAudio(url);
      }
    }

    return `${textoBase.trim()}\n\n${textoExtra.trim()}`.trim();
  }

  async detectarAguardandoOrcamento(cliente, contexto) {
    const prompt = `O cliente "${cliente}" enviou a seguinte mensagem e anexos:\n\n"${contexto}"\n\nCom base nisso, ele está claramente aguardando um orçamento da equipe comercial?\n\nResponda apenas com "Sim" ou "Não".`;

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

    // ⬇️ Log semântico de qualquer mensagem recebida
    await registrarLogSemantico({
      cliente: nomeCliente,
      vendedor: nomeVendedor,
      evento: "Nova mensagem recebida",
      tipo: "observacao",
      texto,
      decisaoIA: "Observação geral: mensagem recebida e processada",
      detalhes: { contexto }
    });

    const aguardando = await this.detectarAguardandoOrcamento(nomeCliente, `${texto}\n${contexto}`);
    if (!aguardando) {
      await registrarLogSemantico({
        cliente: nomeCliente,
        vendedor: nomeVendedor,
        evento: "Análise de intenção",
        tipo: "analise",
        texto,
        decisaoIA: "Cliente não está aguardando orçamento"
      });
      return { status: "sem ação", motivo: "cliente não está aguardando orçamento" };
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
        decisaoIA: `Cliente está aguardando, mas ainda não atingiu limite para alerta. (${horas}h)`
      });
      return { status: "sem ação", motivo: "nenhum alerta necessário agora" };
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
      decisaoIA: `Alerta ${acao} enviado com ${horas} horas úteis de espera.`,
      detalhes: { tempoUtil: horas }
    });

    console.log(`[IA] ${acao} enviado para ${nomeVendedor} - ${nomeCliente}`);

    return { status: "alerta enviado", acao, para: numeroVendedor };
  }
}

module.exports = MotorIA;
