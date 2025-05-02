const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require('pdf-parse');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
require("dotenv").config();

// OpenAI client
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
app.use(bodyParser.json());

// Environment vars
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Sellers mapping
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Alert messages
const MENSAGENS = {
  alerta1: (c, v) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\nSolicitamos atenção para concluir o atendimento o quanto antes.\nAgradecemos pela colaboração.`,
  alerta2: (c, v) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, reforçamos que o cliente *${c}* permanece aguardando orçamento há 12h úteis.\nSolicitamos providências imediatas para evitar impacto negativo no atendimento.`,
  alertaFinal: (c, v) =>
    `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (c, v) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${c}* segue sem retorno após 18h úteis.\nResponsável: *${v}*\n\n⚠️ Por favor, verificar esse caso com urgência.`
};

// Calculate business hours between dates
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const cur = new Date(start);
  while (cur < end) {
    const hora = cur.getHours();
    const dia = cur.getDay();
    if (dia >= 1 && dia <= 5 && hora >= 8 && hora < 19) horas++;
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
    console.error('Erro ao enviar mensagem:', err.response?.data || err.message);
  }
}

// Transcribe audio using Whisper
async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const form = new FormData();
    form.append('file', Buffer.from(resp.data), {
      filename: 'audio.ogg', contentType: 'audio/ogg'
    });
    form.append('model', 'whisper-1');
    const result = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    return result.data.text;
  } catch (err) {
    console.error('[ERRO] Transcrição de áudio falhou:', err.response?.data || err.message);
    return null;
  }
}

// Extract text from PDF using pdf-parse + pdfjs fallback
async function extrairTextoPDF(buffer) {
  let txt = '';
  try {
    const data = await pdfParse(buffer);
    txt = data.text;
  } catch {};
  // Fallback with pdfjs
  if (!txt || txt.trim().length < 20) {
    try {
      const loadingTask = pdfjsLib.getDocument({ data: buffer });
      const pdf = await loadingTask.promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => item.str).join(' '));
      }
      txt = pages.join('\n');
    } catch (e) {
      console.error('[ERRO] Fallback PDFJS falhou:', e);
    }
  }
  return txt;
}

// AI: detect if client awaits a quote
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Você é Gerente Comercial IA, detecte se o cliente aguarda orçamento.' },
        { role: 'user', content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto? '\nContexto: '+contexto : ''}` }
      ]
    });
    const reply = completion.choices[0].message.content.toLowerCase();
    return reply.includes('sim') || reply.includes('aguard') || reply.includes('precisa');
  } catch (err) {
    console.error('[ERRO] Análise de intenção falhou:', err);
    return false;
  }
}

app.post('/conversa', async (req, res) => {
  try {
    const { payload } = req.body;
    if (!payload || !payload.user || !payload.attendant || !payload.message) {
      console.error('[ERRO] Payload incompleto', req.body);
      return res.status(400).json({ error: 'Payload incompleto.' });
    }
    const cliente = payload.user.Name;
    const vendedorNome = payload.attendant.Name.trim();
    const tipo = payload.message.type;
    let texto = payload.message.text || payload.message.caption || '[attachment]';
    console.log(`[LOG] Nova mensagem recebida de ${cliente}: "${texto}"`);

    let contextoExtra = '';
    // Audio
    if (tipo === 'audio' && payload.message.payload?.url) {
      const t = await transcreverAudio(payload.message.payload.url);
      if (t) { console.log('[TRANSCRICAO]', t); contextoExtra += t; }
    }
    // PDF
    if (tipo === 'file' && payload.message.payload?.url?.endsWith('.pdf')) {
      const resp = await axios.get(payload.message.payload.url, { responseType: 'arraybuffer' });
      const pdfTxt = await extrairTextoPDF(resp.data);
      console.log('[PDF-TEXTO]', pdfTxt);
      contextoExtra += pdfTxt;
    }

    // Decide alerts
    const espera = await isWaitingForQuote(cliente, texto, contextoExtra);
    if (!espera) {
      console.log('[INFO] Cliente não aguarda orçamento.');
      return res.json({ status: 'Sem ação.' });
    }

    // Tempo de espera
    const criado = new Date(payload.message.CreatedAt || payload.timestamp);
    const horas = horasUteisEntreDatas(criado, new Date());
    const numeroVendedor = VENDEDORES[vendedorNome.toLowerCase()];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${vendedorNome}" não mapeado.`);
      return res.json({ warning: 'Vendedor não mapeado.' });
    }

    // Disparos
    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(cliente, vendedorNome));
      setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(cliente, vendedorNome)), 10*60*1000);
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(cliente, vendedorNome));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(cliente, vendedorNome));
    }

    res.json({ status: 'Processado' });
  } catch (err) {
    console.error('[ERRO] Falha ao processar:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor do Gerente Comercial IA rodando na porta ${PORT}`));
