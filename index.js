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

// Configurações de ambiente
const WPP_URL = process.env.WPP_URL;             // URL do WppConnect
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Mapeamento de vendedores
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// Mensagens aprovadas
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

// Calcula horas úteis entre duas datas (segunda a sexta, 8h-19h)
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

// Envia mensagem via WppConnect
async function enviarMensagem(numero, mensagem) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: mensagem });
    console.log(`Mensagem enviada para ${numero}: ${mensagem}`);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

// Transcreve áudio via Whisper (OpenAI)
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

// Detecta intenção de aguardando orçamento via GPT-4o-mini
async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Você é Gerente Comercial IA, detecte se o cliente aguarda orçamento.' },
        { role: 'user', content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto ? `\nContexto extra: ${contexto}` : ``}` }
      ]
    });
    const reply = completion.choices[0].message.content.toLowerCase();
    return reply.includes('sim') || reply.includes('aguard') || reply.includes('precisa');
  } catch (err) {
    console.error('[ERRO] Análise de intenção falhou:', err);
    return false;
  }
}

// Endpoint principal de recebimento de webhooks de conversa
app.post('/conversa', async (req, res) => {
  try {
    const payload = req.body.payload;
    if (!payload || !payload.user || !payload.attendant || !payload.message) {
      console.error('[ERRO] Payload incompleto:', req.body);
      return res.status(400).json({ error: 'Payload incompleto.' });
    }
    const nomeCliente = payload.user.Name;
    const nomeVendedor = payload.attendant.Name.trim();
    const attachments = payload.message.attachments || [];
    const tipo = payload.message.type || (attachments.length ? attachments[0].type : 'text');
    const textoMensagem = payload.message.text || payload.message.caption || '[attachment]';
    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    let contextoExtra = '';
    // áudio
    if (tipo === 'audio' && attachments[0]?.payload?.url) {
      const txt = await transcreverAudio(attachments[0].payload.url);
      if (txt) {
        console.log('[TRANSCRICAO]', txt);
        contextoExtra += txt;
      }
    }
    // PDF
    if (tipo === 'file' && attachments[0]?.payload?.url) {
      try {
        const resp = await axios.get(attachments[0].payload.url, { responseType: 'arraybuffer' });
        const data = await pdfParse(resp.data);
        console.log('[PDF-TEXTO]', data.text);
        contextoExtra += data.text;
      } catch (err) {
        console.error('[ERRO] Extração de PDF falhou:', err.message);
      }
    }

    // decide se cliente aguarda orçamento
    const awaiting = await isWaitingForQuote(nomeCliente, textoMensagem, contextoExtra);
    if (!awaiting) {
      console.log('[INFO] Cliente não aguarda orçamento. Sem alertas.');
      return res.json({ status: 'Sem ação necessária.' });
    }

    // cálculo de tempo
    const criadoEm = new Date(payload.message.CreatedAt || payload.timestamp || Date.now());
    const horas = horasUteisEntreDatas(criadoEm, new Date());
    const numeroVendedor = VENDEDORES[nomeVendedor.toLowerCase()];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: 'Vendedor não mapeado.' });
    }

    // disparo de alertas conforme horas
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
