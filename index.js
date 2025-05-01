const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

const MENSAGENS = {
  alerta1: (cliente, vendedor) =>
    `⚠️ *Alerta de Atraso - Orçamento*

Prezado(a) *${vendedor}*, o cliente *${cliente}* aguarda orçamento há 6h úteis.
Solicitamos atenção para concluir o atendimento o quanto antes.
Agradecemos pela colaboração.`,
  alerta2: (cliente, vendedor) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*

Prezado(a) *${vendedor}*, o cliente *${cliente}* permanece aguardando o orçamento há 12h úteis.
Solicitamos providências imediatas para evitar impacto negativo no atendimento. Aguardamos seu retorno.`,
  alertaFinal: (cliente, vendedor) =>
    `‼️ *Último Alerta (18h úteis)*

Prezado(a) *${vendedor}*, o cliente *${cliente}* está há 18h úteis aguardando orçamento.
Você tem 10 minutos para responder. Caso contrário, o atendimento será transferido e registrado junto à Gerência Comercial IA.`,
  alertaGestores: (cliente, vendedor) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*

Cliente *${cliente}* segue sem retorno após 18h úteis.
Responsável: *${vendedor}*
Por favor, verificar esse caso com urgência.`
};

function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const current = new Date(start);
  while (current < end) {
    const hora = current.getHours();
    const dia = current.getDay();
    if (dia >= 1 && dia <= 5 && hora >= 8 && hora < 19) {
      horas++;
    }
    current.setHours(current.getHours() + 1);
  }
  return horas;
}

async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${process.env.WPP_URL}/send-message`, {
      number: numero,
      message: texto,
    });
    console.log(`Mensagem enviada para ${numero}: ${texto}`);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

function detectarFechamento(mensagem) {
  const sinais = ["fechar", "aprov", "vamos fechar", "quero esse", "pode seguir"];
  return sinais.some(p => mensagem.toLowerCase().includes(p));
}

app.post("/conversa", async (req, res) => {
  try {
    const payload = req.body?.payload;
    if (!payload || !payload.user || !payload.attendant) {
      return res.status(400).json({ error: "Payload incompleto." });
    }

    const nomeCliente = payload.user.Name;
    const nomeVendedor = payload.attendant.Name.trim().toLowerCase();
    const textoMensagem = payload.message?.text || "[attachment]";
    const criadoEm = new Date(payload.message?.CreatedAt || Date.now() - 19*60*60*1000);
    const agora = new Date();
    const horas = horasUteisEntreDatas(criadoEm, agora);
    const numeroVendedor = VENDEDORES[nomeVendedor];

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${payload.attendant.Name}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    // 1) Alertas de atraso de orçamento
    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, payload.attendant.Name));
      setTimeout(() => {
        enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, payload.attendant.Name));
      }, 10*60*1000);
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeCliente, payload.attendant.Name));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeCliente, payload.attendant.Name));
    }

    // 2) Sinal de fechamento
    if (detectarFechamento(textoMensagem)) {
      await enviarMensagem(numeroVendedor,
        `🔔 *Sinal de fechamento detectado*

O cliente *${nomeCliente}* indicou possível fechamento. Reforce o contato e envie o orçamento formal.`);
    }

    // 3) Tratamento de anexos: image, audio, document, file (PDF)
    const attachments = payload.message?.attachments || [];
    if (attachments.length > 0) {
      const att = attachments[0];
      console.log(`[LOG] Anexo recebido de ${nomeCliente}: tipo=${att.type}`);
      if (att.type === "file") {
        // PDF
        const url = att.payload.url;
        const tmpPath = path.join("/tmp", `${att.payload.attachment_id}.pdf`);
        try {
          const resp = await axios.get(url, { responseType: "arraybuffer" });
          await fs.promises.writeFile(tmpPath, resp.data);
          const data = await pdfParse(resp.data);
          console.log("[PDF_TEXT]", data.text);
          const resumo = data.text.split("\n").slice(0,5).join(" ");
          await enviarMensagem(numeroVendedor,
            `📄 *PDF recebido de ${nomeCliente}*  
Resumo: ${resumo}…`);
        } catch (e) {
          console.error("[ERRO] ao processar PDF:", e);
        }
      } else {
        // image, audio, document
        const icons = { image: "🖼️ Imagem", audio: "🎙️ Áudio", document: "📄 Documento" };
        const tipoIcon = icons[att.type] || "📎 Arquivo";
        await enviarMensagem(numeroVendedor,
          `📎 *${tipoIcon} recebido de ${nomeCliente}*

Não se esqueça de validar o conteúdo e confirmar todos os itens do orçamento com o cliente.`);
      }
    }

    res.json({ status: "Mensagem processada com sucesso." });
  } catch (err) {
    console.error("[ERRO] Falha ao processar conversa:", err);
    res.status(500).json({ error: "Erro interno ao processar a mensagem." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor do Gerente Comercial IA rodando na porta", PORT);
});
