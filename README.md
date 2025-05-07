# Gerente Comercial IA

Sistema inteligente de atendimento comercial via WhatsApp, com análise automática de mensagens e alertas baseados em tempo útil. Utiliza IA (GPT-4o), OCR, transcrição de áudio, leitura de PDFs e fallback visual para interpretar intenções de clientes e gerar ações inteligentes.

---

## 🎯 Objetivo

Identificar se um cliente está **aguardando orçamento** a partir de mensagens recebidas (texto, imagem, áudio ou PDF) e disparar alertas automáticos para o vendedor responsável e para os gestores, com base em horas úteis.

---

## ⚙️ Tecnologias Utilizadas

| Componente     | Tecnologia                     | Finalidade                            |
|----------------|--------------------------------|----------------------------------------|
| IA             | OpenAI GPT-4o                  | Análise de intenção + fallback visual |
| OCR            | Tesseract.js                   | Extração de texto em imagens          |
| Áudio          | OpenAI Whisper API             | Transcrição de `.ogg`                 |
| PDF            | `pdf-parse`                    | Extração de texto de PDFs             |
| Backend        | Node.js + Express              | API principal                         |
| Mensagens      | WppConnect (via WPP_URL)       | Envio de mensagens no WhatsApp        |
| Infraestrutura | Railway                        | Hospedagem e variáveis de ambiente    |

---

## 🗂️ Estrutura do Projeto

/gerente-comercial-ia
├── index.js # API principal
├── vendedores.json # Mapeamento dos vendedores
├── package.json
│
├── /servicos # Serviços inteligentes (IA, OCR, etc)
│ ├── analisarImagem.js
│ ├── detectarIntencao.js
│ ├── enviarMensagem.js
│ ├── extrairTextoPDF.js
│ └── transcreverAudio.js
│
└── /utils # Funções auxiliares e mensagens
├── horario-util.js
└── mensagens.js


---

## 🔁 Fluxo do Sistema

1. Cliente envia mensagem (texto, imagem, áudio ou PDF).
2. O sistema coleta o conteúdo e realiza OCR / transcrição / leitura.
3. Envia todo o contexto para a IA verificar se há intenção de **aguardar orçamento**.
4. Se positivo, verifica o tempo útil desde o primeiro contato e dispara:
   - 6h úteis → alerta 1
   - 12h úteis → alerta 2
   - 18h úteis → alerta final + aviso para GRUPO_GESTORES_ID

---

## 🛠️ Variáveis de Ambiente

Essas variáveis devem ser configuradas diretamente no Railway:

```env
OPENAI_API_KEY=       # chave da OpenAI
WPP_URL=              # URL do WppConnect server
GRUPO_GESTORES_ID=    # ID do grupo no WhatsApp
PORT=3000             # porta da API
API_URL=              # (opcional) fallback GPT-4o Vision externo




---

Se quiser, posso adaptar esse `README.md` em inglês também ou gerar como arquivo pronto `.md` para commit direto. Deseja o arquivo também?
