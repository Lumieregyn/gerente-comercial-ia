const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
dotenv.config();

const { transcreverAudio } = require("./servicos/transcreverAudio");
const { extrairTextoPDF } = require("./servicos/extrairTextoPDF");
const { analisarImagem } = require("./servicos/analisarImagem");
const { detectarIntencao } = require("./servicos/detectarIntencao");
const { processarAlertaDeOrcamento } = require("./servicos/alertasOrcamento");
const { checklistFechamento } = require("./servicos/checklistFechamento");

const VENDEDORES = require("./vendedores.json");
const app = express();
app.use(bodyParser.json());

function normalizeNome(nome = "") {
  return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

app.post("/conversa", async (req, res) => {
  try {
    const payload = req.body.payload;
    if (!payload || !payload.user || !(payload.message || payload.Message) || !payload.channel) {
      console.error("[ERRO] Payload incompleto:", req.body);
      return res.status(400).json({ error: "Payload incompleto" });
    }

    const message = payload.message || payload.Message;
    const user = payload.user;
    const attendant = payload.attendant || {};

    const nomeCliente = user.Name || "Cliente";
    const texto = message.text || message.caption || "[attachment]";
    console.log(`[LOG] Mensagem recebida de ${nomeCliente}: "${texto}"`);

    let contextoExtra = "";
    if (Array.isArray(message.attachments)) {
      for (const a of message.attachments) {
        if (a.type === "audio" && a.payload?.url) {
          const t = await transcreverAudio(a.payload.url);
          if (t) contextoExtra += "\n" + t;
        }

        if (a.type === "file" && a.payload?.url && a.FileName?.toLowerCase().endsWith(".pdf")) {
          const t = await extrairTextoPDF(a.payload.url);
          if (t) contextoExtra += "\n" + t;
        }

        if (a.type === "image" && a.payload?.url) {
          const t = await analisarImagem(a.payload.url);
          if (t) contextoExtra += "\n" + t;
        }
      }
    }

    const nomeVendedorRaw = attendant.Name || "";
    const keyVend = normalizeNome(nomeVendedorRaw);
    const numeroVendedor = VENDEDORES[keyVend];

    if (!numeroVendedor) {
      console.warn(`[ERRO] Vendedor não mapeado: ${nomeVendedorRaw}`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    const criadoEm = new Date(message.CreatedAt || payload.timestamp);

    // 🎯 Bloco 2 — IA detecta intenção de fechamento
    const sinalizouFechamento = await detectarIntencao(nomeCliente, texto, contextoExtra);
    if (sinalizouFechamento) {
      console.log("[IA] Intenção de fechamento detectada.");
      await checklistFechamento({
        nomeCliente,
        nomeVendedor: nomeVendedorRaw,
        numeroVendedor,
        contexto: contextoExtra,
        texto
      });
    } else {
      // 🔁 Bloco 1 — Alerta de orçamento (aguardando)
      await processarAlertaDeOrcamento({
        nomeCliente,
        nomeVendedor: nomeVendedorRaw,
        numeroVendedor,
        criadoEm,
        texto
      });
    }

    res.json({ status: "Processado com inteligência" });
  } catch (err) {
    console.error("[ERRO]", err.message);
    res.status(500).json({ error: "Erro interno." });
  }
});

app.post("/analisar-imagem", async (req, res) => {
  try {
    const { imagemBase64 } = req.body;
    if (!imagemBase64) {
      return res.status(400).json({ erro: "Imagem não enviada." });
    }

    const { OpenAI } = require("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    res.status(500).json({ erro: "Erro ao analisar imagem com GPT-4o." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
