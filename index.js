const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require('pdf-parse');
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Environment variables
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Map of sellers (lowercase)
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Predefined alert messages
const MENSAGENS = {
  alerta1: (cliente, vendedor) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${vendedor}*, o cliente *${cliente}* aguarda orçamento há 6h úteis.\nSolicitamos atenção para concluir o atendimento o quanto antes.\nAgradecemos pela colaboração.`,
  alerta2: (cliente, vendedor) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${vendedor}*, reforçamos que o cliente *${cliente}* permanece aguardando orçamento há 12h úteis.\nSolicitamos providências imediatas para evitar impacto negativo no atendimento.`,
  alertaFinal: (cliente, vendedor) =>
    `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${vendedor}*, o cliente *${cliente}* está há 18h úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (cliente, vendedor) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${cliente}* segue sem retorno após 18h úteis.\nResponsável: *${vendedor}*\n\n⚠️ Por favor, verificar esse caso com urgência.`
};

// Compute business hours difference
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

// Send message via WPPConnect
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

// Transcribe audio via OpenAI Whisper
async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const form = new FormData();
    form.append('file', Buffer.from(resp.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });
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

// Extract text from PDF
async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const data = await pdfParse(resp.data);
    return data.text;
  } catch (err) {
    console.error('[ERRO] Leitura de PDF falhou:', err);
    return null;
  }
}

// Determine if client awaits quote via AI
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Você é Gerente Comercial IA, detecte se o cliente aguarda orçamento.' },
        { role: 'user', content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto ? '\nContexto extra: ' + contexto : ''}` }
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
    const body = req.body;
    const payload = body.payload;
    if (!payload || !payload.user || !payload.attendant || !payload.message) {
      console.error('[ERRO] Payload incompleto:', body);
      return res.status(400).json({ error: 'Payload incompleto.' });
    }

    const cliente = payload.user.Name;
    const vendedor = payload.attendant.Name.trim();
    const msg = payload.message;
    let textoMensagem = msg.text || msg.caption || '[attachment]';
    const tipo = msg.type || 'text';
    console.log(`[LOG] Nova mensagem recebida de ${cliente}: "${textoMensagem}"`);

    // Handle attachments
    let contextoExtra = '';
    if (msg.attachments && msg.attachments.length) {
      console.log('[ANEXOS RECEBIDOS]', msg.attachments);
      for (const a of msg.attachments) {
        if (a.type === 'audio' && a.payload?.url) {
          const trans = await transcreverAudio(a.payload.url);
          if (trans) {
            console.log('[TRANSCRICAO]', trans);
            contextoExtra += trans + ' ';
          }
        }
        if (a.type === 'file' && a.payload?.url && a.FileName?.toLowerCase().endsWith('.pdf')) {
          const pdfText = await extrairTextoPDF(a.payload.url);
          if (pdfText) {
            console.log('[PDF-TEXTO]', pdfText);
            contextoExtra += pdfText + ' ';
          }
        }
      }
    }

    // AI intent detection
    const awaiting = await isWaitingForQuote(cliente, textoMensagem, contextoExtra.trim());
    if (!awaiting) {
      console.log('[INFO] Cliente não aguarda orçamento. Sem alertas.');
      return res.json({ status: 'Sem ação necessária.' });
    }

    // Timing logic
    const criadoEm = new Date(payload.message.CreatedAt || payload.timestamp);
    const horas = horasUteisEntreDatas(criadoEm, new Date());
    const numVend = VENDEDORES[vendedor.toLowerCase()];
    if (!numVend) {
      console.warn(`[ERRO] Vendedor "${vendedor}" não está mapeado.`);
      return res.json({ warning: 'Vendedor não mapeado.' });
    }

    // Alerts by hours
    if (horas >= 18) {
      await enviarMensagem(numVend, MENSAGENS.alertaFinal(cliente, vendedor));
      setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(cliente, vendedor)), 10*60*1000);
    } else if (horas >= 12) {
      await enviarMensagem(numVend, MENSAGENS.alerta2(cliente, vendedor));
    } else if (horas >= 6) {
      await enviarMensagem(numVend, MENSAGENS.alerta1(cliente, vendedor));
    }

    res.json({ status: 'Processado' });

  } catch (err) {
    console.error('[ERRO] Falha ao processar:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor do Gerente Comercial IA rodando na porta ${PORT}`));
