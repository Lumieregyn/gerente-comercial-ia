// inteligencia/motor-da-inteligencia.js

const axios = require("axios");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
const { horasUteisEntreDatas } = require("../utils/horario-util");
const { getCliente, atualizarCliente, marcarAlerta } = require("../utils/controleDeAlertas");
const { registrarLogSemantico } = require("../utils/logsIA");
const { buscarMemoria } = require("../utils/memoria");

class MotorIA {
  /**
   * @param {Object} params
   * @param {string} params.openaiApiKey
   * @param {Object} params.vendedores  mapeamento nome→telefone
   * @param {Object} params.mensagens   funções que geram texto de alerta
   */
  constructor({ openaiApiKey, vendedores, mensagens }) {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.vendedores = vendedores;
    this.mensagens = mensagens;
  }

  /** Extrai texto de um PDF a partir de URL */
  async extrairTextoPDF(url) {
    try {
      const resp = await axios.get(url, { responseType: "arraybuffer" });
      const data = await pdfParse(resp.data);
      return data.text.trim();
    } catch (err) {
      console.error("[ERRO PDF]", err.message);
      return "";
    }
  }

  /** Transcreve áudio pela Whisper API */
  async transcreverAudio(url) {
    try {
      const resp = await axios.get(url, { responseType: "stream" });
      const result = await this.openai.audio.transcriptions.create({
        file: resp.data,
        model: "whisper-1"
      });
      return result.text.trim();
    } catch (err) {
      console.error("[ERRO ÁUDIO]", err.message);
      return "";
    }
  }

  /**
   * Constrói contexto multimodal (texto + transcrições + PDF)
   * @param {Object} message  objeto de mensagem do webhook
   */
  async construirContextoMultimodal(message = {}) {
    const textoBase = message.text || message.caption || "";
    let extra = "";

    for (const att of message.attachments || []) {
      const url = att.payload?.url;
      if (att.type === "document" && url && att.FileName?.toLowerCase().endsWith(".pdf")) {
        extra += "\n\n" + (await this.extrairTextoPDF(url));
      } else if (att.type === "audio" && url) {
        extra += "\n\n" + (await this.transcreverAudio(url));
      }
    }

    return `${textoBase.trim()}\n\n${extra.trim()}`.trim();
  }

  /**
   * Detecta se o cliente está aguardando orçamento, usando RAG:
   * 1) recupera histórico relevante do Pinecone
   * 2) injeta no prompt antes de perguntar ao GPT-4o
   * @param {string} cliente
   * @param {string} contexto  texto + anexos
   * @returns {Promise<boolean>}
   */
  async detectarAguardandoOrcamento(cliente, contexto) {
    // 1) recuperar histórico semântico
    const hist = await buscarMemoria(contexto, 3);
    const histText = hist
      .map((h, i) => `#${i + 1} [${h.score.toFixed(2)}]: ${h.metadata.evento} → ${h.metadata.texto}`)
      .join("\n");

    // 2) montar prompt com histórico
    const prompt = `
O cliente "${cliente}" enviou:
---
${contexto}

Histórico recente semelhante:
${histText}

Com base nisso, ele está aguardando um orçamento da equipe comercial?
Responda apenas "Sim" ou "Não".
`.trim();

    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }]
    });

    const resposta = completion.choices[0].message.content.toLowerCase();
    const aguardando = resposta.includes("sim");

    // log semântico da decisão
    await registrarLogSemantico({
      cliente,
      vendedor: null,
      evento: "Detecção de intenção",
      tipo: "analise",
      texto: contexto,
      decisaoIA: aguardando ? "Sim" : "Não"
    });

    return aguardando;
  }

  /**
   * Decide e dispara alertas de orçamento com base em horas úteis de espera
   * @param {Object} opts
   * @param {string} opts.nomeCliente
   * @param {string} opts.nomeVendedor
   * @param {string} opts.numeroVendedor
   * @param {Date}   opts.criadoEm
   * @param {string} opts.texto
   */
  async decidirAlerta({ nomeCliente, nomeVendedor, numeroVendedor, criadoEm, texto }) {
    const agora = new Date();
    const clienteId = nomeCliente.toLowerCase().replace(/\s+/g, ".");
    const aguardando = await this.detectarAguardandoOrcamento(nomeCliente, texto);
    if (!aguardando) {
      await registrarLogSemantico({
        cliente: nomeCliente,
        vendedor: nomeVendedor,
        evento: "Alerta não disparado (não aguardando)",
        tipo: "analise",
        texto,
        decisaoIA: "Cliente não aguardando orçamento"
      });
      return { status: "sem ação", motivo: "cliente não aguarda orçamento" };
    }

    const statusAtual = getCliente(clienteId) || {
      clienteId,
      vendedor: nomeVendedor,
      alertas: {}
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
        decisaoIA: `Aguardando, ${horas}h úteis ainda não atingidas`
      });
      return { status: "sem ação", motivo: "nenhum alerta necessário agora" };
    }

    // envia alerta via HTTP para o WPP URL
    const mensagem = this.mensagens[acao](nomeVendedor, nomeCliente);
    await axios.post(`${process.env.WPP_URL}/send-message`, {
      number: numeroVendedor,
      message: mensagem
    });

    await registrarLogSemantico({
      cliente: nomeCliente,
      vendedor: nomeVendedor,
      evento: `Envio de ${acao}`,
      tipo: "alerta",
      texto,
      decisaoIA: `Alerta ${acao} enviado após ${horas}h úteis`
    });

    console.log(`[IA] ${acao} enviado para ${nomeVendedor} - ${nomeCliente}`);
    return { status: "alerta enviado", acao, para: numeroVendedor };
  }
}

module.exports = MotorIA;
