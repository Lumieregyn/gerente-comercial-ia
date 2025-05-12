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
const { verificarPedidoEspecial } = require("./servicos/verificarPedidoEspecial");
const { mensagemEhRuido } = require("./utils/controleDeRuido");
const { dentroDoHorarioUtil } = require("./utils/dentroDoHorarioUtil");
const { logIA } = require("./utils/logger");
const { perguntarViaIA } = require("./servicos/perguntarViaIA");
const VENDEDORES = require("./vendedores.json");

const app = express();
app.use(bodyParser.json());

function isGestor(numero) {
  const numerosGestores = [
    "+554731703288",
    "+120363416457397022"
  ];
  return numerosGestores.includes(numero);
}

// Middleware para interceptar perguntas de gestores
app.use("/conversa", async (req, res, next) => {
  console.log("[DEBUG] ENTROU NO MIDDLEWARE DE GESTOR");

  try {
    const payload = req.body.payload;
    const user = payload?.user;
    const message = payload?.message || payload?.Message;
    const texto = message?.text || message?.caption || "[attachment]";
    const raw = user?.Phone || "";
    const numero = "+" + raw;

    console.log("[DEBUG] Número recebido:", numero);
    console.log("[DEBUG] Texto recebido:", texto);
    console.log("[DEBUG] isGestor(numero)?", isGestor(numero));

    if (isGestor(numero) && texto.includes("?")) {
      console.log("[IA GESTOR] Pergunta detectada:", texto);
      await perguntarViaIA({ textoPergunta: texto, numeroGestor: numero });
      return res.json({ status: "Pergunta do gestor respondida via IA" });
    }

    next();
  } catch (err) {
    console.error("[ERRO /conversa middleware]", err.message);
    res.status(500).json({ error: "Erro no roteamento de conversa" });
  }
});

// Redireciona POST /conversa para o fluxo principal
app.post("/conversa", (req, res, next) => {
  req.url = "/conversa/proccess";
  next();
});

// Fluxo principal
app.post("/conversa/proccess", async (req, res) => {
  try {
    const payload = req.body.payload;

    if (!payload?.message?.text && payload?.type !== "message") {
      console.log("[IGNORADO] Evento não é mensagem de texto. Tipo:", payload?.type);
      return res.status(200).json({ status: "Evento ignorado." });
    }

    if (
      !payload ||
      !payload.user ||
      !(payload.message || payload.Message) ||
      !payload.channel
    ) {
      console.error("[ERRO] Payload incompleto:", req.body);
      return res.status(400).json({ error: "Payload incompleto" });
    }

    const message = payload.message || payload.Message;
    const user = payload.user;
    const attendant = payload.attendant || {};

    const nomeCliente = user.Name || "Cliente";
    const texto = message.text || message.caption || "[attachment]";
    const nomeVendedorRaw = attendant.Name || "";

    console.log(`[LOG] Mensagem recebida de ${nomeCliente}: "${texto}"`);

    logIA({
      cliente: nomeCliente,
      vendedor: nomeVendedorRaw,
      evento: "Mensagem recebida",
      tipo: "entrada",
      texto,
      decisaoIA: "Mensagem inicial recebida e encaminhada para análise"
    });

    if (!dentroDoHorarioUtil()) {
      console.log("[PAUSA] Fora do horário útil. Alerta não será enviado.");
      return res.json({ status: "Fora do horário útil" });
    }

    if (mensagemEhRuido(texto)) {
      console.log("[RUÍDO] Mensagem irrelevante detectada. Ignorando.");
      return res.json({ status: "Ignorado por ruído." });
    }

    let contextoExtra = "";
    let imagemBase64 = null;

    if (Array.isArray(message.attachments)) {
      for (const a of message.attachments) {
        if (a.type === "audio" && a.payload?.url) {
          const t = await transcreverAudio(a.payload.url);
          if (t && t.length > 0) {
            contextoExtra += "\n" + t;
            await logIA({
              cliente: nomeCliente,
              vendedor: nomeVendedorRaw,
              evento: "Áudio transcrito",
              tipo: "entrada",
              texto: t,
              decisaoIA: "Transcrição via Whisper concluída"
            });
          }
        }

        if (a.type === "file" && a.payload?.url && a.FileName?.toLowerCase().endsWith(".pdf")) {
          const t = await extrairTextoPDF(a.payload.url);
          if (t) {
            contextoExtra += "\n" + t;
            await logIA({
              cliente: nomeCliente,
              vendedor: nomeVendedorRaw,
              evento: "PDF processado",
              tipo: "entrada",
              texto: t,
              decisaoIA: "Texto extraído com sucesso do PDF"
            });
          }
        }

        if (a.type === "image" && a.payload?.url) {
          const t = await analisarImagem(a.payload.url);
          if (t) {
            contextoExtra += "\n" + t;
            await logIA({
              cliente: nomeCliente,
              vendedor: nomeVendedorRaw,
              evento: "Imagem analisada",
              tipo: "entrada",
              texto: t,
              decisaoIA: "OCR concluído na imagem recebida"
            });
          }
          try {
            const resp = await require("axios").get(a.payload.url, {
              responseType: "arraybuffer"
            });
            imagemBase64 = Buffer.from(resp.data).toString("base64");
          } catch (err) {
            console.error("[ERRO IMG BASE64]", err.message);
          }
        }
      }
    }

    const normalizeNome = nome =>
      nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

    const keyVend = normalizeNome(nomeVendedorRaw);
    const numeroVendedor = VENDEDORES[keyVend];

    if (!numeroVendedor && nomeVendedorRaw !== "Grupo Gestores" && nomeVendedorRaw !== "Bot") {
      console.warn(`[ERRO] Vendedor não mapeado: ${nomeVendedorRaw}`);
      return res.json({ warning: "Vendedor não mapeado." });
    }

    const criadoEm = new Date(message.CreatedAt || payload.timestamp);
    const sinalizouFechamento = await detectarIntencao(
      nomeCliente,
      texto,
      contextoExtra
    );
    console.log("[DEBUG] detectou intenção de fechamento?", sinalizouFechamento);

    if (sinalizouFechamento) {
      console.log("[IA] Intenção de fechamento detectada.");

      await checklistFechamento({
        nomeCliente,
        nomeVendedor: nomeVendedorRaw,
        numeroVendedor,
        contexto: contextoExtra,
        texto
      });

      if (imagemBase64) {
        const { compararImagemProduto } = require("./servicos/compararImagemProduto");
        await compararImagemProduto({
          nomeCliente,
          nomeVendedor: nomeVendedorRaw,
          numeroVendedor,
          imagemBase64,
          contexto: contextoExtra
        });
      }

      await verificarPedidoEspecial({
        nomeCliente,
        nomeVendedor: nomeVendedorRaw,
        numeroVendedor,
        contexto: contextoExtra
      });
    } else {
      await processarAlertaDeOrcamento({
        nomeCliente,
        nomeVendedor: nomeVendedorRaw,
        numeroVendedor,
        criadoEm,
        texto
      });
    }

    return res.json({ status: "Processado com inteligência" });
  } catch (err) {
    console.error("[ERRO]", err);
    return res.status(500).json({ error: "Erro interno." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
