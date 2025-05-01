const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const { Configuration, OpenAIApi } = require("openai");
require("dotenv").config();

// Configuração OpenAI para transcrição
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

// IDs e mapeamentos
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Mensagens aprovadas
const MENSAGENS = {
  alerta1: (c, v) =>
    `🚨 Primeiro alerta (6h):\n⚠️ Prezado(a) ${v}, informamos que o cliente ${c} encontra-se há 6 horas úteis aguardando o orçamento solicitado.\nSolicitamos atenção para concluir o atendimento o quanto antes.\nAgradecemos pela colaboração.`,
  alerta2: (c, v) =>
    `🚨 Segundo alerta (12h):\n⚠️ Prezado(a) ${v}, reforçamos que o cliente ${c} permanece aguardando o orçamento há 12 horas úteis.\nSolicitamos providências imediatas para evitar impacto negativo no atendimento.\nAguardamos seu retorno.`,
  alertaFinal: (c, v) =>
    `🚨 Último alerta (18h):\n🚨 Prezado(a) ${v}, o cliente ${c} está há 18 horas úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.\nCaso contrário, o atendimento será transferido e a situação será registrada junto à Gerência Comercial IA.`,
  alertaGestores: (c, v) =>
    `🚨 Atenção Gerência Comercial IA:\nO cliente ${c} permaneceu 18 horas sem receber o orçamento solicitado e o vendedor ${v} não respondeu no prazo de 10 minutos.\nProvidências serão tomadas quanto à redistribuição do atendimento.`,
  fechamentoSinal: (c, v) =>
    `🔔 Sinal de fechamento detectado\nO cliente ${c} indicou possível fechamento. Reforce o contato e envie o orçamento formal.`,
  anexosCriticos: (c, tipo) => {
    const emoji = tipo === 'audio' ? '🎙️' : tipo === 'image' ? '🖼️' : '📄';
    return `📎 ${emoji} Anexo recebido de ${c}\nNão se esqueça de validar o conteúdo e confirmar todos os itens do orçamento com o cliente.`;
  }
};

// Cálculo de horas úteis
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const current = new Date(start);
  while (current < end) {
    const h = current.getHours();
    const d = current.getDay();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) horas++;
    current.setHours(current.getHours() + 1);
  }
  return horas;
}

// Envio de mensagem via WppConnect
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido ou ausente: "${numero}"`);
    return;
  }
  try {
    await axios.post(`${process.env.WPP_URL}/send-message`, { number: numero, message: texto });
    console.log(`Mensagem enviada para ${numero}: ${texto}`);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

// Detecção de intenção de fechamento
function detectarFechamento(texto) {
  const sinais = ["fechar", "aprovado", "vamos seguir", "quero esse", "pode seguir"]; 
  return sinais.some(sig => texto.toLowerCase().includes(sig));
}

// Verifica anexos críticos
function contemArquivoCritico(m) {
  return ['document', 'image', 'audio', 'file'].includes(m.type);
}

// Transcrição de áudio via Whisper
async function transcreverAudio(url) {
  const resp = await axios.get(url, { responseType: 'arraybuffer' });
  const tmp = '/tmp/audio.ogg';
  fs.writeFileSync(tmp, Buffer.from(resp.data));
  const form = new FormData();
  form.append('file', fs.createReadStream(tmp));
  form.append('model', 'whisper-1');
  const result = await openai.createTranscription(form, { headers: form.getHeaders() });
  return result.data.text;
}

// Leitura de PDF
async function lerPDF(url) {
  const resp = await axios.get(url, { responseType: 'arraybuffer' });
  const data = await pdfParse(resp.data);
  return data.text;
}

// Rota principal de conversa
app.post("/conversa", async (req, res) => {
  try {
    const { payload, message } = req.body;
    if (!payload || !payload.user || !payload.attendant || (!message.text && !message.attachments)) {
      console.error('[ERRO] Payload incompleto:', req.body);
      return res.status(400).json({ error: 'Payload incompleto.' });
    }

    const cliente = payload.user.Name;
    const vendedorNome = payload.attendant.Name.trim().toLowerCase();
    const vendedorNumero = VENDEDORES[vendedorNome];
    const texto = message.text || '';
    const criadoEm = new Date(message.CreatedAt || Date.now());
    const agora = new Date();
    const horas = horasUteisEntreDatas(criadoEm, agora);

    console.log(`[LOG] Nova mensagem recebida de ${cliente}: "${texto || '[attachment]' }"`);

    // Se anexo crítico: transcrever/ler e alertar vendedor
    if (message.attachments?.length) {
      for (const att of message.attachments) {
        let conteudo = '';
        if (att.type === 'audio') {
          const txt = await transcreverAudio(att.payload.url);
          console.log('[TRANSCRIÇÃO]', txt);
          conteudo = txt;
          await enviarMensagem(vendedorNumero, `🤖 Transcrição de áudio de ${cliente}: ${txt}`);
        } else if (att.type === 'file' || att.type === 'document') {
          const pdfText = await lerPDF(att.payload.url);
          console.log('[PDF TEXT]', pdfText.substring(0, 200));
          await enviarMensagem(vendedorNumero, `🤖 Conteúdo do PDF de ${cliente}: ${pdfText.substring(0,200)}...`);
        }
        // alerta de anexo
        await enviarMensagem(vendedorNumero, MENSAGENS.anexosCriticos(cliente, att.type));
      }
    }

    // Se não for vendedor mapeado
    if (!vendedorNumero) {
      console.warn(`[ERRO] Vendedor "${payload.attendant.Name}" não está mapeado.`);
      return res.json({ warning: 'Vendedor não mapeado. Nenhuma ação executada.' });
    }

    // Fluxo de alertas de orçamento
    if (horas >= 18) {
      await enviarMensagem(vendedorNumero, MENSAGENS.alertaFinal(cliente, payload.attendant.Name));
      setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(cliente, payload.attendant.Name)), 10*60*1000);
    } else if (horas >= 12) {
      await enviarMensagem(vendedorNumero, MENSAGENS.alerta2(cliente, payload.attendant.Name));
    } else if (horas >= 6) {
      await enviarMensagem(vendedorNumero, MENSAGENS.alerta1(cliente, payload.attendant.Name));
    }

    // Sinal de fechamento + checklist
    if (detectarFechamento(texto)) {
      await enviarMensagem(vendedorNumero, MENSAGENS.fechamentoSinal(cliente, payload.attendant.Name));
      // TODO: implementar checklist completo após sinal de fechamento
    }

    return res.json({ status: 'Processado com sucesso.' });
  } catch (err) {
    console.error('[ERRO] Falha ao processar conversa:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor do Gerente Comercial IA rodando na porta ${PORT}`));
