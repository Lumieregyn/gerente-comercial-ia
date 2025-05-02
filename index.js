const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const FormData = require('form-data');
const pdfParse = require('pdf-parse');
require('dotenv').config();
const { OpenAI } = require('openai');

const app = express();
app.use(bodyParser.json());

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Environment variables
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Map of sellers (lowercased name -> phone number)
const VENDEDORES = {
  'cindy loren': '5562994671766',
  'ana clara martins': '5562991899053',
  'emily sequeira': '5562981704171',
  'fernando fonseca': '5562985293035'
};

// Approved alert messages
const MENSAGENS = {
  alerta1: (cliente, vendedor) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\n` +
    `Prezada(o) *${vendedor}*, o cliente *${cliente}* aguarda orçamento há 6h úteis.\n` +
    `Solicitamos atenção para concluir o atendimento o quanto antes.\n` +
    `Agradecemos pela colaboração.`,
  alerta2: (cliente, vendedor) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\n` +
    `Prezada(o) *${vendedor}*, reforçamos que o cliente *${cliente}* permanece aguardando orçamento há 12h úteis.\n` +
    `Solicitamos providências imediatas para evitar impacto negativo no atendimento.`,
  alertaFinal: (cliente, vendedor) =>
    `‼️ *Último Alerta (18h úteis)*\n\n` +
    `Prezada(o) *${vendedor}*, o cliente *${cliente}* está há 18h úteis aguardando orçamento.\n` +
    `Você tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (cliente, vendedor) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\n` +
    `Cliente *${cliente}* segue sem retorno após 18h úteis.\n` +
    `Responsável: *${vendedor}*\n\n` +
    `⚠️ Por favor, verificar esse caso com urgência.`
};

// Compute business hours between two dates
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const cur = new Date(start);
  while (cur < end) {
    const day = cur.getDay();
    const hour = cur.getHours();
    if (day >= 1 && day <= 5 && hour >= 8 && hour < 19) {
      horas++;
    }
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

// Send WhatsApp message via WPPConnect
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
    console.log(`Mensagem enviada para ${numero}: ${texto}`);
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err.response?.data || err.message);
  }
}

// Transcribe audio using OpenAI Whisper
async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const form = new FormData();
    form.append('file', Buffer.from(resp.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-1');
    const result = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    return result.data.text;
  } catch (err) {
    console.error('[ERRO] Transcrição de áudio falhou:', err.response?.data || err.message);
    return null;
  }
}

// Extract text from PDF
async function extrairPdf(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const data = await pdfParse(resp.data);
    return data.text;
  } catch (err) {
    console.error('[ERRO] Leitura de PDF falhou:', err.message);
    return null;
  }
}

// AI detection: client waiting for quote?
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const msgs = [
      { role: 'system', content: 'Você é Gerente Comercial IA, detecte se o cliente aguarda orçamento.' },
      { role: 'user', content: `Cliente: ${cliente}\nMensagem: ${mensagem}` + (contexto ? `\nContexto: ${contexto}` : '') }
    ];
    const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: msgs });
    const reply = completion.choices[0].message.content.toLowerCase();
    return reply.includes('sim') || reply.includes('aguard') || reply.includes('precisa');
  } catch (err) {
    console.error('[ERRO] Análise de intenção falhou:', err);
    return false;
  }
}

// Webhook endpoint
app.post('/conversa', async (req, res) => {
  const body = req.body;
  const payload = body.payload;
  if (!payload || !payload.user || !payload.attendant || !payload.message) {
    console.error('[ERRO] Payload incompleto:', body);
    return res.status(400).json({ error: 'Payload incompleto.' });
  }

  const cliente = payload.user.Name;
  const vendedor = payload.attendant.Name.trim();
  const mensagemRaw = payload.message.text || payload.message.caption || '[attachment]';
  const tipo = payload.message.type;
  console.log(`[LOG] Nova mensagem recebida de ${cliente}: "${mensagemRaw}"`);

  let contextoExtra = '';
  // handle audio
  if (tipo === 'audio' && payload.message.payload?.url) {
    const trans = await transcreverAudio(payload.message.payload.url);
    if (trans) {
      console.log('[TRANSCRICAO]', trans);
      contextoExtra += trans;
    }
  }
  // handle PDF/file
  if (tipo === 'file' && payload.message.payload?.url) {
    const textoPdf = await extrairPdf(payload.message.payload.url);
    if (textoPdf) {
      console.log('[PDF-TEXTO]', textoPdf);
      contextoExtra += (contextoExtra ? '\n' : '') + textoPdf;
    }
  }

  // determine if awaiting quote
  const awaiting = await isWaitingForQuote(cliente, mensagemRaw, contextoExtra);
  if (!awaiting) {
    console.log('[INFO] Cliente não aguarda orçamento. Sem alertas.');
    return res.json({ status: 'Sem ação necessária.' });
  }

  // timing and alert logic
  const criadoEm = new Date(payload.timestamp || Date.now() - 19 * 3600 * 1000);
  const horas = horasUteisEntreDatas(criadoEm, new Date());
  const numVend = VENDEDORES[vendedor.toLowerCase()];
  if (!numVend) {
    console.warn(`[ERRO] Vendedor "${vendedor}" não mapeado.`);
    return res.json({ warning: 'Vendedor não mapeado.' });
  }

  try {
    if (horas >= 18) {
      await enviarMensagem(numVend, MENSAGENS.alertaFinal(cliente, vendedor));
      setTimeout(() => {
        enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(cliente, vendedor));
      }, 10 * 60 * 1000);
  } else if (horas >= 12) {
      await enviarMensagem(numVend, MENSAGENS.alerta2(cliente, vendedor));
  } else if (horas >= 6) {
      await enviarMensagem(numVend, MENSAGENS.alerta1(cliente, vendedor));
  }
    res.json({ status: 'Processado' });
  } catch (err) {
    console.error('[ERRO] Erro enviando alertas:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor do Gerente Comercial IA rodando na porta ${PORT}`));
