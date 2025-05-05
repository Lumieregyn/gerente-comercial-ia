// index.js – Versão final corrigida (~240 linhas)
// Gerente Comercial IA: texto, áudio (Whisper), PDF (pdf-parse) e imagem (GPT-4V)

require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");

const app = express();
app.use(bodyParser.json({ limit: "100mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "100mb" }));

// Configurações de ambiente
env = process.env;
const PORT = env.PORT || 3000;
const OPENAI_API_KEY = env.OPENAI_API_KEY;
const VISION_MODEL = "gpt-4o-mini"; // ou "gpt-4v"
const WPP_URL = env.WPP_URL;
const GRUPO_GESTORES_ID = env.GRUPO_GESTORES_ID;

// Mapeamento de vendedores
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Templates de alertas
const MENSAGENS = {
  alerta1: (c, v) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.`,
  alerta2: (c, v) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, o cliente *${c}* permanece aguardando orçamento há 12h úteis.`,
  alertaFinal: (c, v) =>
    `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.`,
  alertaGestores: (c, v) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${c}* sem retorno após 18h úteis. Responsável: *${v}*`
};

// Cliente OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Logs
function log(msg) { console.log("[LOG]", msg); }
function logErro(msg) { console.error("[ERRO]", msg); }

// Baixa arquivo remoto como Buffer\async function baixarBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

// Transcrição de áudio via Whisper
async function transcreverAudio(url) {
  try {
    const buffer = await baixarBuffer(url);
    const form = new FormData();
    form.append('file', buffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-1');
    const resp = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      { headers: {...form.getHeaders(), Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    return resp.data.text;
  } catch (err) {
    logErro('Transcrição de áudio falhou: ' + err.message);
    return null;
  }
}

// Leitura completa de PDF
async function extrairPdf(url) {
  try {
    const buffer = await baixarBuffer(url);
    const data = await pdfParse(buffer);
    return data.text;
  } catch (err) {
    logErro('Leitura de PDF falhou: ' + err.message);
    return null;
  }
}

// OCR via GPT-4V
async function ocrImagemGPT(url) {
  try {
    const completion = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: 'Você extrai todo o texto de uma imagem.' },
        { role: 'user', content: `Por favor, extraia todo o texto desta imagem: ${url}` }
      ]
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    logErro('OCR GPT-4V falhou: ' + err.message);
    return null;
  }
}

// Análise de texto genérico
async function analisarTexto(texto) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'Você avalia atendimento comercial.' },
        { role: 'user', content: texto }
      ]
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    logErro('Erro análise GPT-4: ' + err.message);
    return null;
  }
}

// Parse do payload
function parsePayload(req) {
  let p = req.body.payload;
  if (p && typeof p === 'string') p = JSON.parse(p);
  p = p || req.body;
  return {
    user: p.user || {},
    attendant: p.attendant || {},
    message: p.message || { text: p.text || '', attachments: p.attachments || [], file: p.file }
  };
}

// Calculo de horas úteis
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio), end = new Date(fim);
  let horas = 0, cur = new Date(start);
  while (cur < end) {
    const d = cur.getDay(), h = cur.getHours();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) horas++;
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

// Normaliza nome
function normalizeNome(nome = '') {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

// Envia WhatsApp
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    logErro('Número inválido:' + numero);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
  } catch (err) {
    logErro('Erro WPP:' + (err.response?.data || err.message));
  }
}

// Detecta intenção orçamento
async function isWaitingForQuote(cliente, mens, cont) {
  try {
    const comp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role:'system', content:'Detecte se cliente aguarda orçamento.' },
        { role:'user', content:`Cliente:${cliente}\nMsg:${mens}${cont?'\nCtx:'+cont:''}` }
      ]
    });
    const r = comp.choices[0].message.content.toLowerCase();
    return r.includes('sim') || r.includes('aguard');
  } catch (err) {
    logErro('Intenção falhou:' + err.message);
    return false;
  }
}

// Rota webhook
app.post('/conversa', async (req, res) => {
  try {
    const { user, attendant, message } = parsePayload(req);
    const cliente = user.Name || 'Cliente';
    const vendRaw = attendant.Name || 'Vendedor';
    const text = message.text || message.caption || '';
    const atts = message.attachments || [];
    const file = message.file || atts[0] || null;
    const fileUrl = file?.url || file?.payload?.url || null;

    log(`Msg de ${cliente}:"${text||'[attachment]'}"`);
    let ctx = '';
    if (fileUrl) {
      if (file.type==='audio'||file.mimeType?.startsWith('audio')) {
        const t=await transcreverAudio(fileUrl); if(t){log('[Tr]',t);ctx+='\n'+t;}
      } else if(file.mimeType==='application/pdf'){
        const t=await extrairPdf(fileUrl); if(t){log('[PDF]',t.slice(0,100));ctx+='\n'+t;}
      } else if(file.type==='image'||file.mimeType?.startsWith('image')){
        const t=await ocrImagemGPT(fileUrl); if(t){log('[OCR]',t.slice(0,100));ctx+='\n'+t;}
      }
    }
    const wait = await isWaitingForQuote(cliente,text,ctx);
    if(!wait){log('Sem ação');return res.json({status:'OK'});}
    const num=VENDEDORES[normalizeNome(vendRaw)];
    if(!num){logErro('Vend. não mapeado:'+vendRaw);return res.json({warning:'Vend. não mapeado'});}
    const hrs=horasUteisEntreDatas(new Date(message.CreatedAt||Date.now()),new Date());
    if(hrs>=18){await enviarMensagem(num,MENSAGENS.alertaFinal(cliente,vendRaw));setTimeout(()=>enviarMensagem(GRUPO_GESTORES_ID,MENSAGENS.alertaGestores(cliente,vendRaw)),600000);} 
    else if(hrs>=12){await enviarMensagem(num,MENSAGENS.alerta2(cliente,vendRaw));} 
    else if(hrs>=6){await enviarMensagem(num,MENSAGENS.alerta1(cliente,vendRaw));}
    res.json({status:'Processado'});
  } catch(e){logErro('ErrProc:'+e.message);return res.status(500).json({error:'Erro'});}  
});

// Health check
app.get('/',(r,s)=>s.send('Gerente Comercial IA ativo'));
// Inicia servidor
app.listen(PORT,()=>log(`Porta ${PORT}`));
