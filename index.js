const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Inicializa cliente OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Variáveis de ambiente
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Mapeamento de vendedores (lowercase)
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Mensagens de alerta aprovadas
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

// Calcula horas úteis entre datas
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  while (start < end) {
    const dia = start.getDay();
    const hora = start.getHours();
    if (dia >= 1 && dia <= 5 && hora >= 8 && hora < 19) horas++;
    start.setHours(start.getHours() + 1);
  }
  return horas;
}

// Envia mensagem via WppConnect
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
    console.log(`Mensagem enviada para ${numero}`);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

// Transcreve áudio com Whisper
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
    console.error('[ERRO] Transcrição falhou:', err.response?.data || err.message);
    return null;
  }
}

// Extrai texto de PDF
async function extrairPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const data = await pdfParse(resp.data);
    return data.text;
  } catch (err) {
    console.error('[ERRO] Extração de PDF falhou:', err.message);
    return null;
  }
}

// Detecta se cliente aguarda orçamento via IA
async function isWaitingForQuote(cliente, msg, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Você é Gerente Comercial IA. Responda apenas sim ou não se o cliente aguarda orçamento.' },
        { role: 'user', content: `Cliente: ${cliente}\nMensagem: ${msg}${contexto ? `\nContexto: ${contexto}` : ''}` }
      ]
    });
    const resposta = completion.choices[0].message.content.toLowerCase();
    return /\bsim\b|\baguard\b|\bprecisa\b/.test(resposta);
  } catch (err) {
    console.error('[ERRO] IA falhou:', err.message);
    return false;
  }
}

app.post('/conversa', async (req, res) => {
  try {
    const { payload, timestamp } = req.body;
    if (!payload || !payload.user || !payload.attendant || !(payload.message || payload.Message)) {
      console.error('[ERRO] Payload incompleto:', req.body);
      return res.status(400).json({ error: 'Payload incompleto.' });
    }
    // Unifica objeto de mensagem
    const msgObj = payload.message || payload.Message;
    const nomeCliente = payload.user.Name;
    const nomeVendedor = payload.attendant.Name;
    const attachments = Array.isArray(msgObj.attachments) ? msgObj.attachments : [];

    // Texto principal ou identificação de attachment
    let textoMensagem = msgObj.text || msgObj.caption || (attachments.length ? '[attachment]' : '');
    console.log(`[LOG] Nova mensagem de ${nomeCliente}: "${textoMensagem}"`);

    // Contexto extra (transcrição audio ou PDF)
    let contextoExtra = '';
    // Áudio
    const audioAtt = attachments.find(a => a.type === 'audio');
    if (audioAtt?.payload?.url) {
      const txt = await transcreverAudio(audioAtt.payload.url);
      if (txt) { console.log('[TRANSCRICAO]', txt); contextoExtra += txt; }
    }
    // PDF/documento
    const fileAtt = attachments.find(a => a.type === 'file' || a.type === 'document');
    if (fileAtt?.payload?.url && fileAtt.payload.url.endsWith('.pdf')) {
      const pdfTxt = await extrairPDF(fileAtt.payload.url);
      if (pdfTxt) { console.log('[PDF_TEXTO]', pdfTxt.substring(0,200)); contextoExtra += pdfTxt; }
    }

    // Verifica intenção com IA
    const awaiting = await isWaitingForQuote(nomeCliente, textoMensagem, contextoExtra);
    if (!awaiting) {
      console.log('[INFO] Cliente não aguarda orçamento.');
      return res.json({ status: 'Sem ação.' });
    }

    // Cálculo de atraso
    const createdAt = msgObj.CreatedAt || payload.message?.timestamp || timestamp;
    const horas = horasUteisEntreDatas(createdAt, new Date());
    const numeroVendedor = VENDEDORES[nomeVendedor.toLowerCase()];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não mapeado.`);
      return res.json({ warning: 'Vendedor não mapeado.' });
    }

    // Dispara alertas
    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, nomeVendedor));
      setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, nomeVendedor)), 10 * 60 * 1000);
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeCliente, nomeVendedor));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeCliente, nomeVendedor));
    }

    return res.json({ status: 'Processado' });
  } catch (err) {
    console.error('[ERRO] Processamento falhou:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
```
