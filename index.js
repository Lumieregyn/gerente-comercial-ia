// index.js - Gerente Comercial IA

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { OpenAI } = require("openai");
require("dotenv").config();

// --- Configuração OpenAI ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
app.use(bodyParser.json());

// --- Mapeamento de Vendedores e Grupo ---
const GRUPO_GESTORES_ID = process.env.GRUPO_GESTORES_ID;
const VENDEDORES = {
  "cindy loren": "5562994671766",
  "ana clara martins": "5562991899053",
  "emily sequeira": "5562981704171",
  "fernando fonseca": "5562985293035"
};

// --- Mensagens Padronizadas ---
const MENSAGENS = {
  alerta1: (c, v) => 
    `⚠️ *Alerta de Atraso - Orçamento*  
Prezado(a) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.  
Solicitamos atenção para concluir o atendimento o quanto antes.  
Agradecemos pela colaboração.`,
  alerta2: (c, v) => 
    `⏰ *Segundo Alerta - Orçamento em Espera*  
Prezado(a) *${v}*, reforçamos que o cliente *${c}* permanece aguardando orçamento há 12h úteis.  
Solicitamos providências imediatas para evitar impacto negativo.`,
  alertaFinal: (c, v) => 
    `‼️ *Último Alerta (18h úteis)*  
Prezado(a) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.  
Você tem 10 minutos para responder esta mensagem.  
Caso contrário, o atendimento será registrado junto à Gerência Comercial IA.`,
  alertaGestores: (c, v) => 
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*  
Cliente *${c}* permanece sem retorno após 18h úteis.  
Responsável: *${v}*  
⚠️ Verificar com urgência.`,
  sinalFechamento: (c, v) => 
    `🔔 *Sinal de fechamento detectado*  
Cliente *${c}* indicou possível fechamento. Reforce o contato e envie orçamento formal.`,
  diverImagem: (c, v) => 
    `📸 *Alerta de Divergência de Imagem*  
⚠️ Prezado(a) *${v}*, possível divergência entre a imagem enviada por *${c}* e o produto orçado.  
Verifique antes de prosseguir.`,
  checklistFinal: (c, v, pontos) => 
    `✅ *Checklist Final de Fechamento*  
⚠️ Prezado(a) *${v}*, detectamos pendências:  
${pontos.map(p=>`• ${p}`).join("\n")}  
💡 Revise com o cliente antes do pedido.`,
};

// --- Funções Auxiliares ---
function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const cur = new Date(start);
  while (cur < end) {
    const dia = cur.getDay();
    const h = cur.getHours();
    if (dia >= 1 && dia <= 5 && h >= 8 && h < 19) horas++;
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

async function enviarMensagem(to, message) {
  if (!/^[0-9]{11,13}$/.test(to)) {
    console.warn(`[ERRO] Número inválido: ${to}`);
    return;
  }
  try {
    await axios.post(`${process.env.WPP_URL}/send-message`, { number: to, message });
  } catch (e) {
    console.error("Erro ao enviar mensagem:", e.response?.data || e.message);
  }
}

function detectarFechamento(texto) {
  const sinais = [" fechar", "aprovad", "quero esse", "pode seguir", "faturar", "vamos fechar"];
  return sinais.some(s => texto.toLowerCase().includes(s));
}

// --- Transcrição de Áudio via Whisper ---
async function transcreverAudio(url) {
  const resp = await axios.get(url, { responseType: 'arraybuffer' });
  const ffmpegInput = Buffer.from(resp.data);
  const out = await openai.audio.transcriptions.create({ file: ffmpegInput, model: "whisper-1" });
  return out.text;
}

// --- Análise de Texto com GPT-4o mini ---
async function analisarTextoComIA(conversa) {
  const resp = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: conversa });
  return resp.choices[0].message.content;
}

// --- Rota Principal ---
app.post("/conversa", async (req, res) => {
  try {
    const raw = req.body;
    if (!raw?.payload) return res.status(400).json({ error: "Payload incompleto." });
    const { user, message, attendant } = raw.payload;
    const cliente = user.Name;
    const vendedor = attendant.Name.trim().toLowerCase();
    const numero = VENDEDORES[vendedor];
    if (!numero) {
      console.warn(`[ERRO] Vendedor "${attendant.Name}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    console.log(`[LOG] Nova mensagem recebida de ${cliente}: "${message.text || '[attachment]'}"`);
    let texto = message.text ?? '';

    // se anexo de áudio, transcreve
    if (message.attachments?.[0]?.type === 'audio') {
      texto = await transcreverAudio(message.attachments[0].payload.url);
      console.log(`[TRANSCRIÇÃO] ${texto}`);
    }

    const agora = new Date();
    const criadoEm = new Date(message.CreatedAt || Date.now());
    const horas = horasUteisEntreDatas(criadoEm, agora);

    // Fluxo de Orçamento
    if (/orçamento|preço|valor/.test(texto.toLowerCase())) {
      if (horas >= 18) {
        await enviarMensagem(numero, MENSAGENS.alertaFinal(cliente, attendant.Name));
        setTimeout(() => enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(cliente, attendant.Name)), 600000);
      } else if (horas >= 12) {
        await enviarMensagem(numero, MENSAGENS.alerta2(cliente, attendant.Name));
      } else if (horas >= 6) {
        await enviarMensagem(numero, MENSAGENS.alerta1(cliente, attendant.Name));
      }
    }

    // Sinal de fechamento
    if (detectarFechamento(texto)) {
      await enviarMensagem(numero, MENSAGENS.sinalFechamento(cliente, attendant.Name));
    }

    // Checklists e divergências só após sinal de fechamento
    if (detectarFechamento(texto) && message.attachments) {
      const tipo = message.attachments[0].type === 'image' ? '🖼️ Imagem' : '📄 Documento';
      await enviarMensagem(numero, `📎 *${tipo} recebido de ${cliente}*\nNão esqueça de validar o conteúdo.`);
    }

    res.json({ status: "OK" });
  } catch (err) {
    console.error("[ERRO] ", err);
    res.status(500).json({ error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
