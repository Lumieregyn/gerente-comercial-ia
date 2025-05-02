const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdf = require('pdf-parse');
const { OpenAI } = require("openai");
require("dotenv").config();

// Initialize
const app = express();
app.use(bodyParser.json());
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Sellers map
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Alert messages
default const MENSAGENS = {
  alerta1: (cliente, vendedor) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${vendedor}*, o cliente *${cliente}* aguarda orçamento há 6h úteis.\nSolicitamos atenção para concluir o atendimento o quanto antes.\nAgradecemos pela colaboração.`,
  alerta2: (cliente, vendedor) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${vendedor}*, reforçamos que o cliente *${cliente}* permanece aguardando orçamento há 12h úteis.\nSolicitamos providências imediatas para evitar impacto negativo no atendimento.`,
  alertaFinal: (cliente, vendedor) =>
    `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${vendedor}*, o cliente *${cliente}* está há 18h úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (cliente, vendedor) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${cliente}* segue sem retorno após 18h úteis.\nResponsável: *${vendedor}*\n\n⚠️ Por favor, verificar esse caso com urgência.`
};

// Calculate business hours between two dates
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const cur = new Date(start);
  while (cur < end) {
    const h = cur.getHours();
    const d = cur.getDay();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) horas++;
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

// Send WhatsApp message
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
    console.log(`Mensagem enviada para ${numero}: ${texto}`);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

// Transcribe audio via Whisper
async function transcreverAudio(url) {
  try {
    const audioResp = await axios.get(url, { responseType: 'arraybuffer' });
    const form = new FormData();
    form.append('file', Buffer.from(audioResp.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-1');
    const resp = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    return resp.data.text;
  } catch (err) {
    console.error('[ERRO] Transcrição de áudio falhou:', err.response?.data || err.message);
    return '';
  }
}

// Extract text from PDF
async function extrairTextoPDF(url) {
  try {
    const pdfResp = await axios.get(url, { responseType: 'arraybuffer' });
    const data = await pdf(pdfResp.data);
    return data.text;
  } catch (err) {
    console.error('[ERRO] Leitura de PDF falhou:', err.message);
    return '';
  }
}

// Analyze image via GPT
async function analisarImagem(url) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Você é Gerente Comercial IA, descreva esta imagem.' },
        { role: 'user', content: `Analise o conteúdo desta imagem: ${url}` }
      ]
    });
    return completion.choices[0].message.content;
  } catch (err) {
    console.error('[ERRO] Análise de imagem falhou:', err);
    return '';
  }
}

// Determine if client awaits quote using GPT
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Detecte se o cliente está aguardando orçamento.' },
        { role: 'user', content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto ? '\nContexto: ' + contexto : ''}` }
      ]
    });
    const resposta = completion.choices[0].message.content.toLowerCase();
    return resposta.includes('sim') || resposta.includes('aguard') || resposta.includes('precisa');
  } catch (err) {
    console.error('[ERRO] Análise de intenção falhou:', err);
    return false;
  }
}

// Main webhook handler
app.post('/conversa', async (req, res) => {
  const ev = req.body;
  if (ev.type !== 'message-received') {
    console.warn('[ERRO] Payload incompleto ou evento não suportado:', ev);
    return res.status(400).end();
  }
  const { payload } = ev;
  if (!payload?.user || !payload?.message) {
    console.error('[ERRO] Payload incompleto:', ev);
    return res.status(400).end();
  }

  const cliente = payload.user.Name;
  const vendedor = payload.attendant.Name;
  const tipo = payload.message.type;
  let texto = payload.message.text || payload.message.caption || '';
  if (!texto && payload.message.attachments?.length) texto = '[attachment]';
  console.log(`[LOG] Nova mensagem recebida de ${cliente}: "${texto}"`);

  // Gather extra context
  let contexto = '';
  if (tipo === 'audio' && payload.message.payload?.url) {
    const t = await transcreverAudio(payload.message.payload.url);
    if (t) {
      console.log('[TRANSCRICAO]', t);
      contexto += t;
    }
  }
  if (tipo === 'file' && payload.message.payload?.url) {
    const txtPDF = await extrairTextoPDF(payload.message.payload.url);
    if (txtPDF) {
      console.log('[PDF-TEXTO]', txtPDF);
      contexto += txtPDF;
    }
  }
  if (tipo === 'image' && payload.message.payload?.url) {
    const imgDesc = await analisarImagem(payload.message.payload.url);
    if (imgDesc) {
      console.log('[IMG-ANALISE]', imgDesc);
      contexto += imgDesc;
    }
  }

  // Check intent
  const awaiting = await isWaitingForQuote(cliente, texto, contexto);
  if (!awaiting) {
    console.log('[INFO] Cliente não aguarda orçamento. Sem alertas.');
    return res.json({ status: 'Sem ação necessária.' });
  }

  // Calculate hours
  const created = new Date(payload.message.CreatedAt || ev.timestamp);
  const horas = horasUteisEntreDatas(created, new Date());
  const numV = VENDEDORES[vendedor.toLowerCase().trim()];
  if (!numV) {
    console.error(`[ERRO] Vendedor "${vendedor}" não está mapeado.`);
    return res.json({ status: 'Vendedor não mapeado.' });
  }

  // Send alerts
  if (horas >= 18) {
    await enviarMensagem(numV, MENSAGENS.alertaFinal(cliente, vendedor));
    setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(cliente, vendedor)), 10*60*1000);
  } else if (horas >= 12) {
    await enviarMensagem(numV, MENSAGENS.alerta2(cliente, vendedor));
  } else if (horas >= 6) {
    await enviarMensagem(numV, MENSAGENS.alerta1(cliente, vendedor));
  }

  res.json({ status: 'Processado' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor do Gerente Comercial IA rodando na porta', PORT));
