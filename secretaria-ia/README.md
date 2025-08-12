# Secretaria IA

Agente virtual que envia mensagens automáticas pelo WhatsApp solicitando saldo de estoque aos representantes comerciais.

## Estrutura

- `app/` Frontend React com Vite e Tailwind
- `backend/` API Node.js com Express e PostgreSQL
- `.github/workflows` CI com GitHub Actions

## Executar localmente

1. Copie `.env.example` para `.env` e ajuste as variáveis.
2. Instale dependências do backend:
   ```bash
   cd backend
   npm install
   npm run build
   npm start
   ```
3. Em outro terminal, suba o frontend:
   ```bash
   cd app
   npm install
   npm run dev
   ```

## Banco de Dados Railway

Crie um projeto no Railway e obtenha a URL do PostgreSQL. Use essa URL na variável `DATABASE_URL`.

Execute o script `backend/src/db/schema.sql` para criar as tabelas:

```bash
psql "$DATABASE_URL" -f backend/src/db/schema.sql
```

## Deploy

- Frontend: deploy em qualquer serviço de estático (Vercel, Netlify).
- Backend: deploy no Railway com variáveis de ambiente configuradas.

