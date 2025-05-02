const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdf = require('pdf-parse');
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// WhatsApp endpoint & group
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Sellers mapping
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035",
};

// Alert messages
const MENSAGENS = {
  alerta1: (c, v) => `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\nSolicitamos atenção para concluir o atendimento o quanto antes.\nAgradecemos pela colaboração.`,
  alerta2: (c, v) => `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, reforçamos que o cliente *${c}* permanece aguardando orçamento há 12h úteis.\nSolicitamos providências imediatas para evitar impacto negativo no atendimento.`,
  alertaFinal: (c, v) => `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (c, v) => `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${c}* segue sem retorno após 18h úteis.\nResponsável: *${v}*\n\n⚠️ Por favor, verificar esse caso com urgência.`
};

// Track when client first awaited
const waitingSince = {};

// Business hours between dates
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const cur = new Date(start);
  while (cur < end) {
    const dia = cur.getDay(), hora = cur.getHours();
    if (dia >=1 && dia <=5 && hora >=8 && hora <19) horas++;
    cur.setHours(cur.getHours()+1);
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
  } catch(err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

// Transcribe audio via Whisper
async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType:'arraybuffer' });
    const form = new FormData();
    form.append('file', Buffer.from(resp.data), { filename:'audio.ogg', contentType:'audio/ogg' });
    form.append('model','whisper-1');
    const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}`} }
    );
    return res.data.text;
  } catch(err) {
    console.error('[ERRO] Transcrição de áudio falhou:', err.response?.data || err.message);
    return null;
  }
}

// Extract text from PDF
async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType:'arraybuffer' });
    const data = await pdf(resp.data);
    return data.text;
  } catch(err) {
    console.error('[ERRO] Leitura de PDF falhou:', err.message);
    return null;
  }
}

// Analyze image with GPT
async function analisarImagem(url, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model:'gpt-4o-mini',
      messages:[
        { role:'system', content:'Você é Gerente Comercial IA, analise o que a imagem mostra e verifique divergências.' },
        { role:'user', content:`Imagem: ${url}${contexto? '\nContexto: '+contexto : ''}` }
      ]
    });
    return completion.choices[0].message.content;
  } catch(err) {
    console.error('[ERRO] Análise de imagem falhou:', err);
    return null;
  }
}

// Detect if waiting for quote via AI
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model:'gpt-4o-mini',
      messages:[
        { role:'system', content:'Você é Gerente Comercial IA, detecte se o cliente aguarda orçamento.' },
        { role:'user', content:`Cliente: ${cliente}\nMensagem: ${mensagem}${contexto?'\nContexto: '+contexto:''}` }
      ]
    });
    const reply = completion.choices[0].message.content.toLowerCase();
    return reply.includes('sim') || reply.includes('aguard') || reply.includes('precisa');
  } catch(err) {
    console.error('[ERRO] Análise de intenção falhou:', err);
    return false;
  }
}

app.post('/conversa', async (req, res) => {
  try {
    const { payload } = req.body;
    if (!payload || !payload.user || !payload.message) {
      console.error('[ERRO] Payload incompleto ou evento não suportado:', req.body);
      return res.status(400).json({ error:'Payload incompleto.' });
    }
    const cliente = payload.user.Name;
    const vendedor = payload.attendant?.Name?.trim();
    console.log(`[LOG] Nova mensagem recebida de ${cliente}:`);

    // Determine content
    let texto = payload.message.text || payload.message.caption || '';
    let contexto = '';

    // Handle attachments
    const atts = payload.message.attachments || [];
    for (const att of atts) {
      const url = att.payload?.url;
      if (!url) continue;
      if (att.type==='audio') {
        const t = await transcreverAudio(url);
        if (t) { console.log('[TRANSCRICAO]', t); contexto += t+'\n'; }
      }
      else if(att.type==='file' && att.payload.filename?.toLowerCase().endsWith('.pdf')) {
        const t = await extrairTextoPDF(url);
        if (t) { console.log('[PDF-TEXTO]', t.slice(0,200)+'...'); contexto += t+'\n'; }
      }
      else if(att.type==='image') {
        const t = await analisarImagem(url, contexto);
        if (t) { console.log('[IMG-ANALISE]', t); contexto += t+'\n'; }
      }
    }

    // Use placeholder if no text
    if (!texto && contexto) texto='[attachment]';
    console.log(`[LOG] Texto: ${texto}`);

    // Detect waiting signal
    const aguardando = await isWaitingForQuote(cliente, texto, contexto);
    if (!aguardando) {
      console.log('[INFO] Cliente não aguarda orçamento. Sem alertas.');
      return res.json({ status:'sem ação' });
    }

    // Track first wait
    const chave = payload.user.Id;
    if (!waitingSince[chave]) waitingSince[chave] = new Date();
    const horas = horasUteisEntreDatas(waitingSince[chave], new Date());

    // Find seller number
    const numV = VENDEDORES[vendedor?.toLowerCase()];
    if (!numV) {
      console.warn(`[ERRO] Vendedor "${vendedor}" não está mapeado.`);
      return res.json({ warning:'Vendedor não mapeado.' });
    }

    // Send alerts
    if (horas >= 18) {
      await enviarMensagem(numV, MENSAGENS.alertaFinal(cliente, vendedor));
      setTimeout(()=> enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(cliente, vendedor)), 10*60*1000);
    } else if (horas >= 12) {
      await enviarMensagem(numV, MENSAGENS.alerta2(cliente, vendedor));
    } else if (horas >= 6) {
      await enviarMensagem(numV, MENSAGENS.alerta1(cliente, vendedor));
    }

    res.json({ status:'processado' });
  } catch(err) {
    console.error('[ERRO] Falha ao processar:', err);
    res.status(500).json({ error:'Erro interno.' });
  }
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Servidor do Gerente Comercial IA rodando na porta', PORT));
