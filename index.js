// index.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const FormData = require('form-data');
const pdf = require('pdf-parse');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// --- Inicializa OpenAI ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Configurações de ambiente ---
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// --- Mapeamento de vendedores ---
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// --- Mensagens aprovadas ---
const MENSAGENS = {
  alerta1: (cliente, vendedor) =>
    `🚨 *Primeiro alerta (6h)*\n\n⚠️ Prezado(a) *${vendedor}*, informamos que o cliente *${cliente}* encontra-se há 6 horas úteis aguardando o orçamento solicitado.\nSolicitamos atenção para concluir o atendimento o quanto antes.\nAgradecemos pela colaboração.`,
  alerta2: (cliente, vendedor) =>
    `🚨 *Segundo alerta (12h)*\n\n⚠️ Prezado(a) *${vendedor}*, reforçamos que o cliente *${cliente}* permanece aguardando o orçamento há 12 horas úteis.\nSolicitamos providências imediatas para evitar impacto negativo no atendimento.\nAguardamos seu retorno.`,
  alertaFinal: (cliente, vendedor) =>
    `🚨 *Último alerta (18h)*\n\n🚨 Prezado(a) *${vendedor}*, o cliente *${cliente}* está há 18 horas úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.\nCaso contrário, o atendimento será transferido e a situação será registrada junto à Gerência Comercial IA.`,
  alertaGestores: (cliente, vendedor) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nO cliente *${cliente}* permaneceu 18 horas sem receber o orçamento solicitado e o vendedor *${vendedor}* não respondeu no prazo. Providências serão tomadas quanto à redistribuição do atendimento.`
};

// --- Calcula horas úteis entre duas datas ---
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const cur = new Date(start);
  while (cur < end) {
    const dia = cur.getDay();
    const hora = cur.getHours();
    if (dia >= 1 && dia <= 5 && hora >= 8 && hora < 19) {
      horas++;
    }
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

// --- Envia mensagem via WPPConnect ---
async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, {
      number: numero,
      message: texto
    });
    console.log(`Mensagem enviada para ${numero}: ${texto}`);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

// --- Transcreve áudio via Whisper ---
async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const form = new FormData();
    form.append('file', Buffer.from(resp.data), {
      filename: 'audio.ogg',
      contentType: 'audio/ogg'
    });
    form.append('model', 'whisper-1');
    const result = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    return result.data.text;
  } catch (err) {
    console.error('[ERRO] Transcrição de áudio falhou:', err.response?.data || err.message);
    return '';
  }
}

// --- Extrai texto de PDF via pdf-parse ---
async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const data = await pdf(resp.data);
    return data.text;
  } catch (err) {
    console.error('[ERRO] Leitura de PDF falhou:', err.message);
    return '';
  }
}

// --- Detecta com IA se cliente aguarda orçamento ---
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

// --- Endpoint de webhook ---
app.post('/conversa', async (req, res) => {
  try {
    const body = req.body;
    const payload = body.payload;
    // validação mínima
    if (
      !payload ||
      !payload.user ||
      !payload.attendant ||
      !(payload.message || payload.Message)
    ) {
      console.error('[ERRO] Payload incompleto:', JSON.stringify(body));
      return res.status(400).json({ error: 'Payload incompleto.' });
    }

    // uniformiza campos
    const msgObj = payload.message || payload.Message;
    const nomeCliente = payload.user.Name;
    const nomeVendedor = payload.attendant.Name.trim();

    // mensagem textual
    const textoMensagem = msgObj.text || msgObj.caption || '[attachment]';
    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    // constrói contexto extra a partir de áudio e PDF
    let contextoExtra = '';

    if (Array.isArray(msgObj.attachments)) {
      for (const att of msgObj.attachments) {
        if (att.type === 'audio' && att.payload?.url) {
          const txt = await transcreverAudio(att.payload.url);
          if (txt) {
            console.log('[TRANSCRICAO]', txt);
            contextoExtra += txt + '\n';
          }
        }
        if (att.type === 'file' && att.payload?.url && att.FileName?.toLowerCase().endsWith('.pdf')) {
          const pdfText = await extrairTextoPDF(att.payload.url);
          if (pdfText) {
            console.log('[PDF-TEXTO]', pdfText.substring(0, 500));
            contextoExtra += pdfText + '\n';
          }
        }
      }
    }

    // verifica se devemos alertar
    const awaiting = await isWaitingForQuote(nomeCliente, textoMensagem, contextoExtra);
    if (!awaiting) {
      console.log('[INFO] Cliente não aguarda orçamento. Sem alertas.');
      return res.json({ status: 'Sem ação necessária.' });
    }

    // cálculos de tempo
    const timestamp = payload.message?.CreatedAt || payload.Message?.timestamp || payload.timestamp;
    const criadoEm = new Date(timestamp);
    const horas = horasUteisEntreDatas(criadoEm, new Date());

    // busca número do vendedor
    const numeroVendedor = VENDEDORES[nomeVendedor.toLowerCase()];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: 'Vendedor não mapeado.' });
    }

    // disparo de alertas conforme horas
    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, nomeVendedor));
      // após 10min, avisa gestores
      setTimeout(
        () => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, nomeVendedor)),
        10 * 60 * 1000
      );
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

// --- Inicia servidor ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor do Gerente Comercial IA rodando na porta ${PORT}`));
