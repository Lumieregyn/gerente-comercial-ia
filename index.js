// index.js atualizado com suporte completo a áudio, PDF e imagem via OpenAI Vision

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
const https = require("https");

require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035",
  "marcelle menezes": "5562985405172"
};

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

async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) return;
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
    console.log(`Mensagem enviada para ${numero}`);
  } catch (err) {
    console.error("[ERRO] Envio mensagem:", err.response?.data || err.message);
  }
}

async function transcreverAudio(url) {
  try {
    const resposta = await axios.get(url, { responseType: 'arraybuffer' });
    const form = new FormData();
    form.append('file', Buffer.from(resposta.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-1');
    const resp = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    return resp.data.text;
  } catch (err) {
    console.error('[ERRO] Transcrição falhou:', err.response?.data || err.message);
    return null;
  }
}

async function lerPdf(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const texto = await pdfParse(response.data);
    return texto.text;
  } catch (err) {
    console.error('[ERRO] Leitura de PDF falhou:', err.message);
    return null;
  }
}

async function analisarImagem(url) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Descreva o que você vê na imagem." },
        { role: "user", content: [
          { type: "image_url", image_url: { url } }
        ] }
      ]
    });
    return completion.choices[0].message.content;
  } catch (err) {
    console.error('[ERRO] Análise de imagem falhou:', err.response?.data || err.message);
    return null;
  }
}

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
    console.error('[ERRO] Intenção falhou:', err);
    return false;
  }
}

app.post('/conversa', async (req, res) => {
  try {
    const { type, payload } = req.body;
    if (type !== 'message-received' || !payload?.user || !payload?.attendant || !payload?.Message) {
      console.error('[ERRO] Payload incompleto ou evento não suportado:', req.body);
      return res.status(200).json({ status: 'Ignorado' });
    }

    const nomeCliente = payload.user.Name || 'Cliente';
    const nomeVendedor = (payload.attendant.Name || '').trim().toLowerCase();
    const numeroVendedor = VENDEDORES[nomeVendedor];

    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${payload.attendant.Name}" não mapeado.`);
      return res.status(200).json({ status: 'Vendedor não mapeado' });
    }

    const msg = payload.Message;
    const textoMensagem = msg.text || msg.caption || '[attachment]';
    const tipo = msg.attachments?.[0]?.type || 'text';

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    let contextoExtra = '';

    if (tipo === 'audio' && msg.attachments?.[0]?.payload?.url) {
      contextoExtra = await transcreverAudio(msg.attachments[0].payload.url);
      if (contextoExtra) console.log('[TRANSCRICAO]', contextoExtra);
    }

    if (tipo === 'file' && msg.attachments?.[0]?.payload?.url) {
      contextoExtra = await lerPdf(msg.attachments[0].payload.url);
      if (contextoExtra) console.log('[PDF-TEXTO]\n\n' + contextoExtra);
    }

    if (tipo === 'image' && msg.attachments?.[0]?.payload?.url) {
      contextoExtra = await analisarImagem(msg.attachments[0].payload.url);
      if (contextoExtra) console.log('[IMAGEM-ANALISE]\n\n' + contextoExtra);
    }

    const aguardando = await isWaitingForQuote(nomeCliente, textoMensagem, contextoExtra);
    if (!aguardando) return res.json({ status: 'Sem ação necessária.' });

    const criadoEm = new Date(msg.CreatedAt || payload.timestamp || Date.now() - 19*3600*1000);
    const horas = horasUteisEntreDatas(criadoEm, new Date());

    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, payload.attendant.Name));
      setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, payload.attendant.Name)), 10*60*1000);
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeCliente, payload.attendant.Name));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeCliente, payload.attendant.Name));
    }

    res.json({ status: 'Processado' });
  } catch (err) {
    console.error('[ERRO] Falha geral:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor do Gerente Comercial IA rodando na porta', PORT));
