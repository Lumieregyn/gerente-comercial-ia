// index.js

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Environment
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Map of sellers (Name lowercased)
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Approved alert messages
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

// Extract text from PDF
async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const data = await pdfParse(resp.data);
    return data.text;
  } catch (err) {
    console.error('[ERRO] Extração de PDF falhou:', err.response?.data || err.message);
    return null;
  }
}

// Determine if client is awaiting quote via AI
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
    const payload = req.body.payload;
    if (!payload || !payload.user || !payload.attendant || !payload.message) {
      console.error('[ERRO] Payload incompleto:', req.body);
      return res.status(400).json({ error: 'Payload incompleto.' });
    }

    const nomeCliente = payload.user.Name;
    const nomeVendedor = payload.attendant.Name;
    let textoMensagem = payload.message.text || payload.message.caption || '';
    let contextoExtra = '';

    // Handle attachments (audio, PDF, image, etc.)
    const attachments = payload.message.attachments || [];
    if ((!textoMensagem || textoMensagem === '') && attachments.length > 0) {
      const at = attachments[0];
      const url = at.payload?.url;
      if (at.type === 'audio' && url) {
        const transcript = await transcreverAudio(url);
        if (transcript) {
          console.log('[TRANSCRICAO]', transcript);
          contextoExtra += transcript;
          textoMensagem = '[audio]';
        }
      } else if (at.type === 'file' && url) {
        const pdfText = await extrairTextoPDF(url);
        if (pdfText) {
          console.log('[PDF-TEXTO]', pdfText);
          contextoExtra += pdfText;
          textoMensagem = '[file]';
        }
      } else {
        textoMensagem = '[attachment]';
      }
    }

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    // Only trigger quote alerts if AI says client awaits quote
    const awaiting = await isWaitingForQuote(nomeCliente, textoMensagem, contextoExtra);
    if (!awaiting) {
      console.log('[INFO] Cliente não aguarda orçamento. Sem alertas.');
      return res.json({ status: 'Sem ação necessária.' });
    }

    // timing
    const criadoEm = new Date(payload.message.CreatedAt || payload.timestamp || Date.now() - 19*3600*1000);
    const horas = horasUteisEntreDatas(criadoEm, new Date());
    const numeroVendedor = VENDEDORES[nomeVendedor.toLowerCase()];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: 'Vendedor não mapeado.' });
    }

    // Alerts by hours
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
app.listen(PORT, () => console.log(`Servidor do Gerente Comercial IA rodando na porta ${PORT}`));
