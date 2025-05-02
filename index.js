const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdf = require('pdf-parse');
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize OpenAI client (GPT-4o + Whisper)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Environment
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

// Business hours difference
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let hrs = 0;
  const cur = new Date(start);
  while (cur < end) {
    const h = cur.getHours(), d = cur.getDay();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) hrs++;
    cur.setHours(cur.getHours() + 1);
  }
  return hrs;
}

// Send via WPPConnect
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

// Transcribe audio with Whisper
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

// AI check if waiting for quote
async function isWaitingForQuote(cliente, msg, contexto) {
  try {
    const comp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Você é Gerente Comercial IA, detecte se o cliente aguarda orçamento.' },
        { role: 'user', content: `Cliente: ${cliente}\nMensagem: ${msg}${contexto ? '\nContexto extra: ' + contexto : ''}` }
      ]
    });
    const r = comp.choices[0].message.content.toLowerCase();
    return r.includes('sim') || r.includes('aguard') || r.includes('precisa');
  } catch (err) {
    console.error('[ERRO] Análise de intenção falhou:', err);
    return false;
  }
}

app.post('/conversa', async (req, res) => {
  try {
    const payload = req.body.payload;
    if (!payload || !payload.user || !payload.attendant || !payload.message) {
      console.error('[ERRO] Payload incompleto:', req.body);
      return res.status(400).json({ error: 'Payload incompleto.' });
    }
    const nomeCliente = payload.user.Name;
    const nomeVendedor = payload.attendant.Name;
    const attachments = payload.message.attachments || [];
    const textoMensagem = payload.message.text || payload.message.caption || (attachments[0]?.type ? `[${attachments[0].type}]` : '[attachment]');
    const tipo = payload.message.type || attachments[0]?.type || 'text';
    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    let contextoExtra = '';
    // audio
    if (tipo === 'audio' && attachments.length) {
      const url = attachments[0].payload.url.replace(/;$/, '');
      const txt = await transcreverAudio(url);
      if (txt) {
        console.log('[TRANSCRICAO]', txt);
        contextoExtra = txt;
      }
    }
    // pdf
    if ((tipo === 'file' || tipo === 'document') && attachments.length) {
      const url = attachments[0].payload.url.replace(/;$/, '');
      try {
        const resp = await axios.get(url, { responseType: 'arraybuffer' });
        const pdfData = await pdf(resp.data);
        console.log('[PDF TEXTO]', pdfData.text.substring(0,200));
        contextoExtra += '\n' + pdfData.text;
      } catch (err) {
        console.error('[ERRO] Parser PDF falhou:', err.message);
      }
    }

    const awaiting = await isWaitingForQuote(nomeCliente, textoMensagem, contextoExtra);
    if (!awaiting) {
      console.log('[INFO] Cliente não aguarda orçamento. Sem alertas.');
      return res.json({ status: 'Sem ação necessária.' });
    }

    const criadoEm = new Date(payload.message.CreatedAt || payload.timestamp || Date.now() - 19*3600*1000);
    const horas = horasUteisEntreDatas(criadoEm, new Date());
    const numeroVendedor = VENDEDORES[nomeVendedor.toLowerCase().trim()];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: 'Vendedor não mapeado.' });
    }

    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, nomeVendedor));
      setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, nomeVendedor)), 10*60*1000);
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeCliente, nomeVendedor));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeCliente, nomeVendedor));
    }

    res.json({ status: 'Processado' });
  } catch (err) {
    console.error('[ERRO] Falha ao processar:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor rodando na porta', PORT));
