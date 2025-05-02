const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Environment variables
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Sellers map
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Approved alert templates
const MENSAGENS = {
  alerta1: (cli, vend) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\n` +
    `Prezada(o) *${vend}*, o cliente *${cli}* aguarda orçamento há 6h úteis.\n` +
    `Solicitamos atenção para concluir o atendimento o quanto antes.\n` +
    `Agradecemos pela colaboração.`,
  alerta2: (cli, vend) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\n` +
    `Prezada(o) *${vend}*, reforçamos que o cliente *${cli}* permanece aguardando orçamento há 12h úteis.\n` +
    `Solicitamos providências imediatas para evitar impacto negativo no atendimento.`,
  alertaFinal: (cli, vend) =>
    `‼️ *Último Alerta (18h úteis)*\n\n` +
    `Prezada(o) *${vend}*, o cliente *${cli}* está há 18h úteis aguardando orçamento.\n` +
    `Você tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (cli, vend) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\n` +
    `Cliente *${cli}* segue sem retorno após 18h úteis.\n` +
    `Responsável: *${vend}*\n\n` +
    `⚠️ Por favor, verificar esse caso com urgência.`
};

// Compute business hours difference
function horasUteisEntreDatas(inicio, fim) {
  let cur = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  while (cur < end) {
    const h = cur.getHours();
    const d = cur.getDay();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) horas++;
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
  } catch (e) {
    console.error('Erro ao enviar mensagem:', e.response?.data || e.message);
  }
}

// Transcribe audio via Whisper
async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const form = new FormData();
    form.append('file', Buffer.from(resp.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-1');
    const r = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    return r.data.text;
  } catch (e) {
    console.error('[ERRO] Transcrição falhou:', e.response?.data || e.message);
    return null;
  }
}

// Extract text from PDF via pdf-parse
async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const data = await pdfParse(resp.data);
    return data.text.trim();
  } catch (e) {
    console.error('[ERRO] PDF parse falhou:', e.message);
    return null;
  }
}

// Decide if client awaits quote via AI
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const comp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Você é Gerente Comercial IA. Detecte se o cliente aguarda orçamento.' },
        { role: 'user', content: `Cliente: ${cliente}\nMensagem: ${mensagem}` + (contexto ? `\nContexto extra: ${contexto}` : '') }
      ]
    });
    const reply = comp.choices[0].message.content.toLowerCase();
    return reply.includes('sim') || reply.includes('aguard') || reply.includes('precisa');
  } catch (e) {
    console.error('[ERRO] Intenção falhou:', e.message);
    return false;
  }
}

// Analyze image placeholder
async function analisarImagem(url) {
  try {
    // placeholder - custom vision logic here
    console.log('[INFO] Analisando imagem em', url);
    return null;
  } catch (e) {
    console.error('[ERRO] Análise de imagem falhou:', e.message);
    return null;
  }
}

// Main webhook handler
app.post('/conversa', async (req, res) => {
  try {
    const pl = req.body.payload;
    if (!pl || !pl.user || !pl.attendant || !pl.message) {
      console.error('[ERRO] Payload incompleto:', req.body);
      return res.status(400).json({ error: 'Payload incompleto.' });
    }
    const cliente = pl.user.Name;
    const vendedor = pl.attendant.Name.trim();

    let texto = pl.message.text || pl.message.caption || null;
    let ctx = '';
    let tipo = pl.message.type || 'text';

    // attachments handling
    if (!texto && Array.isArray(pl.message.attachments) && pl.message.attachments.length>0) {
      const at = pl.message.attachments[0];
      tipo = at.type;
      const url = at.payload?.url;
      if (tipo === 'audio' && url) {
        const t = await transcreverAudio(url);
        console.log('[TRANSCRICAO]', t);
        ctx = t || '';
        texto = '[áudio]';
      } else if (tipo === 'file' && url) {
        const t = await extrairTextoPDF(url);
        console.log('[PDF-TEXTO]', t);
        ctx = t || '';
        texto = '[pdf]';
      } else if (tipo === 'image' && url) {
        const t = await analisarImagem(url);
        if (t) console.log('[IMG-ANALISE]', t);
        ctx = t||'';
        texto = '[imagem]';
      } else {
        texto = '[attachment]';
      }
    }
    console.log(`[LOG] Nova mensagem de ${cliente}: "${texto}"`);

    // Decide awaiting
    const aguarda = await isWaitingForQuote(cliente, texto, ctx);
    if (!aguarda) {
      console.log('[INFO] Cliente não aguarda orçamento.');
      return res.json({ status: 'Sem ação' });
    }

    // compute hours
    const criado = new Date(pl.message.CreatedAt || pl.timestamp);
    const h = horasUteisEntreDatas(criado, new Date());
    const numVend = VENDEDORES[vendedor.toLowerCase()];
    if (!numVend) {
      console.warn(`[ERRO] Vendedor não mapeado: ${vendedor}`);
      return res.json({ warning: 'Vendedor não mapeado.' });
    }

    // send alerts
    if (h >= 18) {
      await enviarMensagem(numVend, MENSAGENS.alertaFinal(cliente, vendedor));
      setTimeout(()=>enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(cliente, vendedor)), 10*60*1000);
    } else if (h >= 12) {
      await enviarMensagem(numVend, MENSAGENS.alerta2(cliente, vendedor));
    } else if (h >= 6) {
      await enviarMensagem(numVend, MENSAGENS.alerta1(cliente, vendedor));
    }

    res.json({ status: 'Processado' });
  } catch (e) {
    console.error('[ERRO] Falha ao processar:', e);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Servidor rodando na porta ${PORT}`));
