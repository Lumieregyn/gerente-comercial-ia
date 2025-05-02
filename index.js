const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const FormData = require('form-data');
const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');
require('dotenv').config();

// Configurações iniciais
const app = express();
app.use(bodyParser.json());
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Mapeamento de vendedores
const VENDEDORES = {
  'cindy loren': '5562994671766',
  'ana clara martins': '5562991899053',
  'emily sequeira': '5562981704171',
  'fernando fonseca': '5562985293035'
};

// Mensagens de alerta
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

// Cálculo de horas úteis entre duas datas
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const cur = new Date(start);
  while (cur < end) {
    const dia = cur.getDay();
    const hora = cur.getHours();
    if (dia >= 1 && dia <= 5 && hora >= 8 && hora < 19) horas++;
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

// Envia mensagem via WPPConnect
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

// Transcribe áudio com Whisper
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

// Extrai texto de PDF
async function extrairTextoPdf(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const data = await pdfParse(resp.data);
    return data.text;
  } catch (err) {
    console.error('[ERRO] Leitura de PDF falhou:', err.message);
    return null;
  }
}

// Descreve imagem via GPT
async function descreverImagem(url) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Você é assistente que descreve imagens.' },
        { role: 'user', content: `Descreva esta imagem: ${url}` }
      ]
    });
    return completion.choices[0].message.content;
  } catch (err) {
    console.error('[ERRO] Análise de imagem falhou:', err);
    return null;
  }
}

// Verifica se cliente aguarda orçamento via IA
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
    return /sim|aguard|precisa/.test(reply);
  } catch (err) {
    console.error('[ERRO] Análise de intenção falhou:', err);
    return false;
  }
}

// Rota principal
app.post('/conversa', async (req, res) => {
  const body = req.body;
  const payload = body.payload;
  if (!payload || payload.type !== 'message-received') {
    console.error('[ERRO] Payload incompleto ou evento não suportado:', body);
    return res.status(400).json({ error: 'Payload incompleto ou evento ignorado.' });
  }
  try {
    const user = payload.user;
    const attendant = payload.attendant;
    const msg = payload.message || payload.Message;
    const timestamp = payload.timestamp;

    const nomeCliente = user.Name;
    const nomeVendedor = attendant.Name?.trim();

    // determina texto e tipo
    let tipo = 'text';
    let texto = msg.text || msg.caption || '';
    if (!texto && Array.isArray(msg.attachments) && msg.attachments.length > 0) {
      const att = msg.attachments[0];
      tipo = att.type;
      texto = att.caption || `[${att.type.toUpperCase()}]`;
      msg.payload = att.payload;
      msg.filename = att.FileName || att.filename;
    }
    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${texto}"`);

    // Contexto extra: multimodal
    let contextoExtra = '';
    if (tipo === 'audio' && msg.payload?.url) {
      const txtAudio = await transcreverAudio(msg.payload.url);
      if (txtAudio) {
        console.log('[TRANSCRICAO]', txtAudio);
        contextoExtra += txtAudio;
      }
    }
    if (tipo === 'file' && msg.payload?.url && msg.filename?.toLowerCase().endsWith('.pdf')) {
      const txtPdf = await extrairTextoPdf(msg.payload.url);
      if (txtPdf) {
        console.log('[PDF-TEXTO]', txtPdf.substring(0, 500));
        contextoExtra += txtPdf;
      }
    }
    if (tipo === 'image' && msg.payload?.url) {
      const descImg = await descreverImagem(msg.payload.url);
      if (descImg) {
        console.log('[IMAGEM-ANALISE]', descImg);
        contextoExtra += descImg;
      }
    }

    // Verifica espera de orçamento
    const aguardando = await isWaitingForQuote(nomeCliente, texto, contextoExtra);
    if (!aguardando) {
      console.log('[INFO] Cliente não aguarda orçamento. Sem alertas.');
      return res.json({ status: 'Sem ação necessária.' });
    }

    // Cálculo de horas úteis
    const criadoEm = new Date(msg.createdAt || timestamp);
    const horas = horasUteisEntreDatas(criadoEm, new Date());
    const numeroVendedor = VENDEDORES[nomeVendedor.toLowerCase()];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: 'Vendedor não mapeado.' });
    }

    // Dispara alertas conforme horas
    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, nomeVendedor));
      setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, nomeVendedor)), 10 * 60 * 1000);
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
