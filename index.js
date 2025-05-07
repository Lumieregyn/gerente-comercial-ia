// index.js
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");
const Tesseract = require("tesseract.js");
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
  "fernando fonseca": "5562985293035"
};

const MENSAGENS = {
  alerta1: (c, v) =>
    `⚠️ *Alerta de Atraso - Orçamento*\n\nPrezada(o) *${v}*, o cliente *${c}* aguarda orçamento há 6h úteis.\nSolicitamos atenção para concluir o atendimento o quanto antes.`,
  alerta2: (c, v) =>
    `⏰ *Segundo Alerta - Orçamento em Espera*\n\nPrezada(o) *${v}*, reforçamos que o cliente *${c}* permanece aguardando orçamento há 12h úteis.`,
  alertaFinal: (c, v) =>
    `‼️ *Último Alerta (18h úteis)*\n\nPrezada(o) *${v}*, o cliente *${c}* está há 18h úteis aguardando orçamento.\nVocê tem 10 minutos para responder esta mensagem.`,
  alertaGestores: (c, v) =>
    `🚨 *ALERTA CRÍTICO DE ATENDIMENTO*\n\nCliente *${c}* segue sem retorno após 18h úteis.\nResponsável: *${v}*`
};

function horasUteisEntreDatas(inicio, fim) {
  const start = new Date(inicio);
  const end = new Date(fim);
  let horas = 0;
  const cur = new Date(start);
  while (cur < end) {
    const dia = cur.getDay(), hora = cur.getHours();
    if (dia >= 1 && dia <= 5 && hora >= 8 && hora < 19) horas++;
    cur.setHours(cur.getHours() + 1);
  }
  return horas;
}

function normalizeNome(nome = "") {
  return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

async function enviarMensagem(numero, texto) {
  if (!numero || !/^[0-9]{11,13}$/.test(numero)) {
    console.warn(`[ERRO] Número inválido: ${numero}`);
    return;
  }
  try {
    await axios.post(`${WPP_URL}/send-message`, { number: numero, message: texto });
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

async function transcreverAudio(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const form = new FormData();
    form.append("file", Buffer.from(resp.data), { filename: "audio.ogg", contentType: "audio/ogg" });
    form.append("model", "whisper-1");
    const result = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    return result.data.text;
  } catch (err) {
    console.error("[ERRO] Transcrição de áudio falhou:", err.message);
    return null;
  }
}

async function extrairTextoPDF(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const data = await pdfParse(resp.data);
    return data.text;
  } catch (err) {
    console.error("[ERRO] PDF parse falhou:", err.message);
    return null;
  }
}

async function analisarImagem(url) {
  try {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(resp.data);
    console.log("[DEBUG] Tamanho do buffer da imagem:", buffer.length);

    const resultado = await Tesseract.recognize(buffer, "por", {
      logger: m => console.log(`[OCR] ${m.status} - ${m.progress ? Math.round(m.progress * 100) + "%" : ""}`)
    });

    let texto = resultado.data.text?.trim();
    if (texto && texto.length >= 3) {
      console.log("[IMAGEM-ANALISE]", texto);
      return texto;
    } else {
      console.log("[IMAGEM-ANALISE] Nenhum texto relevante detectado.");
      return null;
    }
  } catch (err) {
    console.error("[ERRO] Análise de imagem falhou:", err.message);
    return null;
  }
}

async function isWaitingForQuote(cliente, mensagem, contexto) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Você é Gerente Comercial IA: detecte se cliente está aguardando orçamento."
        },
        {
          role: "user",
          content: `Cliente: ${cliente}\nMensagem: ${mensagem}${contexto ? "\nContexto: " + contexto : ""}`
        }
      ]
    });
    const reply = completion.choices[0].message.content.toLowerCase();
    return reply.includes("sim") || reply.includes("aguard");
  } catch (err) {
    console.error("[ERRO] Análise de intenção falhou:", err.message);
    return false;
  }
}

app.post("/conversa", async (req, res) => {
  const tipoEvento = req.body.type;
  switch (tipoEvento) {
    case "new-message":
    case "message":
      break; // segue fluxo normal abaixo
    case "new-contact":
    case "finish-attendance":
    case "transfer-attendance":
    case "new-session":
      console.log(`[IGNORADO] Evento mapeado mas não processável: ${tipoEvento}`);
      return res.status(200).json({ status: "Ignorado" });
    default:
      console.warn(`[ERRO] Tipo de evento desconhecido: ${tipoEvento}`);
      return res.status(400).json({ error: "Tipo de evento não reconhecido" });
  }
  try {
    const payload = req.body.payload;
    if (!payload || !payload.user || !(payload.message || payload.Message) || !payload.channel) {
      console.error("[ERRO] Payload incompleto ou evento não suportado:", req.body);
      return res.status(400).json({ error: "Payload incompleto ou evento não suportado" });
    }

    const message = payload.message || payload.Message;
    const user = payload.user;
    const attendant = payload.attendant || {};

    const nomeCliente = user.Name || "Cliente";
    const texto = message.text || message.caption || "[attachment]";
    console.log(`[LOG] Nova mensagem recebida de ${nomeCliente}: "${texto}"`);

    let contextoExtra = "";

    if (Array.isArray(message.attachments)) {
      for (const a of message.attachments) {
        if (a.type === "audio" && a.payload?.url) {
          const t = await transcreverAudio(a.payload.url);
          if (t) {
            console.log("[TRANSCRICAO]", t);
            contextoExtra += "
" + t;
          }
        }

        if (a.type === "file" && a.payload?.url && a.FileName?.toLowerCase().endsWith(".pdf")) {
          const t = await extrairTextoPDF(a.payload.url);
          if (t) {
            console.log("[PDF-TEXTO]", t);
            const resumo = await analisarPdfComGPT(t);
            contextoExtra += "
" + (resumo || t);
          }
        }

        if (a.type === "image" && a.payload?.url) {
          const t = await analisarImagem(a.payload.url);
          if (t) {
            contextoExtra += "
" + t;
          } else {
            try {
              const resp = await axios.get(a.payload.url, { responseType: "arraybuffer" });
              const base64 = Buffer.from(resp.data).toString("base64");

              const respostaGPT = await axios.post(`${process.env.API_URL || "http://localhost:3000"}/analisar-imagem`, {
                imagemBase64: base64
              });

              const descricaoVisual = respostaGPT.data.descricao;
              if (descricaoVisual) {
                console.log("[GPT-4V]", descricaoVisual);
                contextoExtra += "
" + descricaoVisual;
              }
            } catch (erroGPT) {
              console.error("[ERRO GPT-4V]", erroGPT.message);
            }
          }
        }
      }
    }
        if (a.type === "file" && a.payload?.url && a.FileName?.toLowerCase().endsWith(".pdf")) {
          const t = await extrairTextoPDF(a.payload.url);
          if (t) {
            console.log("[PDF-TEXTO]", t);
            const resumo = await analisarPdfComGPT(t);
            contextoExtra += "
" + (resumo || t);
          }
        }

        if (a.type === "image" && a.payload?.url) {
          const t = await analisarImagem(a.payload.url);
          if (t) {
            contextoExtra += "
" + t;
          } else {
            try {
              const resp = await axios.get(a.payload.url, { responseType: "arraybuffer" });
              const base64 = Buffer.from(resp.data).toString("base64");

              const respostaGPT = await axios.post(`${process.env.API_URL || "http://localhost:3000"}/analisar-imagem`, {
                imagemBase64: base64
              });

              const descricaoVisual = respostaGPT.data.descricao;
              if (descricaoVisual) {
                console.log("[GPT-4V]", descricaoVisual);
                contextoExtra += "
" + descricaoVisual;
              }
            } catch (erroGPT) {
              console.error("[ERRO GPT-4V]", erroGPT.message);
            }
          }
        }
      }
    }
    if (a.type === "file" && a.payload?.url && a.FileName?.toLowerCase().endsWith(".pdf")) {
      const t = await extrairTextoPDF(a.payload.url);
      if (t) {
        console.log("[PDF-TEXTO]", t);
        const resumo = await analisarPdfComGPT(t);
        contextoExtra += "
" + (resumo || t);
      }
    }

    if (a.type === "image" && a.payload?.url) {
      const t = await analisarImagem(a.payload.url);
      if (t) {
        contextoExtra += "
" + t;
      } else {
        try {
          const resp = await axios.get(a.payload.url, { responseType: "arraybuffer" });
          const base64 = Buffer.from(resp.data).toString("base64");

          const respostaGPT = await axios.post(`${process.env.API_URL || "http://localhost:3000"}/analisar-imagem`, {
            imagemBase64: base64
          });

          const descricaoVisual = respostaGPT.data.descricao;
          if (descricaoVisual) {
            console.log("[GPT-4V]", descricaoVisual);
            contextoExtra += "
" + descricaoVisual;
          }
        } catch (erroGPT) {
          console.error("[ERRO GPT-4V]", erroGPT.message);
        }
      }
    }
  }
}
  }
}
  }
}
  }
}
      }
    }
    }
  }
}
}

      }
}
    if (a.type === "file" && a.payload?.url && a.FileName?.toLowerCase().endsWith(".pdf")) {
      const t = await extrairTextoPDF(a.payload.url);
      if (t) {
        console.log("[PDF-TEXTO]", t);
        const resumo = await analisarPdfComGPT(t);
        contextoExtra += "
" + (resumo || t);
      }
    }

    if (a.type === "image" && a.payload?.url) {
      const t = await analisarImagem(a.payload.url);
      if (t) {
        contextoExtra += "
" + t;
      } else {
        try {
          const resp = await axios.get(a.payload.url, { responseType: "arraybuffer" });
          const base64 = Buffer.from(resp.data).toString("base64");

          const respostaGPT = await axios.post(`${process.env.API_URL || "http://localhost:3000"}/analisar-imagem`, {
            imagemBase64: base64
          });

          const descricaoVisual = respostaGPT.data.descricao;
          if (descricaoVisual) {
            console.log("[GPT-4V]", descricaoVisual);
            contextoExtra += "
" + descricaoVisual;
          }
        } catch (erroGPT) {
          console.error("[ERRO GPT-4V]", erroGPT.message);
        }
      }
    }
  }
}        }
      }
    }

    const aguardando = await isWaitingForQuote(nomeCliente, texto, contextoExtra);
    if (!aguardando) {
      console.log("[INFO] Cliente não aguarda orçamento. Sem alertas.");
      return res.json({ status: "Sem ação necessária." });
    }

    const nomeVendedorRaw = attendant.Name || "";
    const keyVend = normalizeNome(nomeVendedorRaw);
    const numeroVendedor = VENDEDORES[keyVend];
    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor "${nomeVendedorRaw}" não está mapeado.`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    const criadoEm = new Date(message.CreatedAt || payload.timestamp);
    const horas = horasUteisEntreDatas(criadoEm, new Date());

    if (horas >= 18) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alertaFinal(nomeCliente, nomeVendedorRaw));
      setTimeout(() =>
        enviarMensagem(GRUPO_GESTORES_ID, MENSAGENS.alertaGestores(nomeCliente, nomeVendedorRaw)),
        10 * 60 * 1000
      );
    } else if (horas >= 12) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta2(nomeCliente, nomeVendedorRaw));
    } else if (horas >= 6) {
      await enviarMensagem(numeroVendedor, MENSAGENS.alerta1(nomeCliente, nomeVendedorRaw));
    }

    res.json({ status: "Processado" });
  } catch (err) {
    console.error("[ERRO] Falha ao processar:", err.message);
    res.status(500).json({ error: "Erro interno." });
  }
});

app.post("/analisar-imagem", async (req, res) => {
  try {
    const { imagemBase64 } = req.body;

    if (!imagemBase64) {
      return res.status(400).json({ erro: "Imagem não enviada." });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Você é um especialista técnico em iluminação. Descreva o tipo de luminária, cor, modelo e aplicação do produto na imagem."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analise e descreva tecnicamente essa luminária:" },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imagemBase64}`
              }
            }
          ]
        }
      ],
      max_tokens: 500
    });

    const resposta = completion.choices[0].message.content;
    res.json({ descricao: resposta });
  } catch (err) {
    console.error("[ERRO GPT-4V]", err.message);
    res.status(500).json({ erro: "Erro ao analisar imagem com GPT-4 Vision." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
