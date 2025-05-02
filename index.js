const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");           // <-- nova dependência para ler PDFs
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Inicializa cliente OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Variáveis de ambiente
const WPP_URL = process.env.WPP_URL;
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;

// Mapeamento de vendedores (nome em minúsculas)
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

// Calcula diferença em horas úteis
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const cur = new Date(start);
  while (cur < end) {
    const h = cur.getHours();
    const d = cur.getDay();
    if (d >= 1 && d <= 5 && h >= 8 && h < 19) horas++;
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

// Envia mensagem pelo WPPConnect
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

// Transcrição de áudio via Whisper
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

// Detecta se o cliente aguarda orçamento (via GPT-4o-mini)
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

// Rota de recepção de webhook
app.post('/conversa', async (req, res) => {
  try {
    const payload = req.body.payload;
    if (!payload || !payload.user || !payload.attendant) {
      console.error('[ERRO] Payload incompleto:', req.body);
      return res.status(400).json({ error: 'Payload incompleto.' });
    }

    const nomeCliente  = payload.user.Name;
    const nomeVendedor = payload.attendant.Name;
    const msg          = payload.message || {};
    let textoMensagem  = msg.text || msg.caption || '[attachment]';
    const tipo         = msg.type || (msg.attachments?.length ? 'attachment' : 'text');

    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${textoMensagem}"`);

    // Tratamento de attachments (áudio, PDF, etc.) para extrair contexto extra
    let contextoExtra = '';
    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        const url = att.payload?.url;
        if (!url) continue;

        if (att.type === 'audio') {
          const txt = await transcreverAudio(url);
          if (txt) {
            console.log('[TRANSCRICAO]', txt);
            contextoExtra += txt + '\n';
          }
        }

        if (att.type === 'file' && att.FileName?.toLowerCase().endsWith('.pdf')) {
          try {
            const resp = await axios.get(url, { responseType: 'arraybuffer' });
            const data = await pdfParse(resp.data);
            console.log('[PDF TEXTO]', data.text);
            contextoExtra += data.text + '\n';
          } catch (e) {
            console.error('[ERRO] Leitura de PDF falhou:', e.message);
          }
        }
      }
    }

    // Decisão: só disparar alerta se IA identificar que cliente aguarda orçamento
    const awaiting = await isWaitingForQuote(nomeCliente, textoMensagem, contextoExtra);
    if (!awaiting) {
      console.log('[INFO] Cliente não aguarda orçamento. Sem alertas.');
      return res.json({ status: 'Sem ação necessária.' });
    }

    // Cálculo de horas úteis desde o envio
    const criadoEm = new Date(payload.message.CreatedAt || payload.timestamp || Date.now());
    const horas    = horasUteisEntreDatas(criadoEm, new Date());
    const numeroVendedor = VENDEDORES[nomeVendedor.toLowerCase()];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedor}" não está mapeado.`);
      return res.json({ warning: 'Vendedor não mapeado.' });
    }

    // Disparo de alertas conforme horas úteis
    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, nomeVendedor));
      // após 10 minutos, alerta para gestores
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
