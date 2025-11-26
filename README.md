# GUIA · ADSIM (Grupo RIC)

Front-end estatico + API Node/Express com Postgres (Cloud SQL). Nada de Firebase; chave GPT fica apenas no backend.

## Estrutura
- `public/` – UI estilo ChatGPT (login/registro com @gruporic.com.br, chat, admins com export/relatorio). Define `window.API_BASE_URL` para apontar para a API.
- `server/` – API Express com JWT, bcrypt, Postgres (chats/mensagens) e chamada ao GPT via `OPENAI_API_KEY`.
- `agente/` – materiais de referencia (nao expostos ao front).

## Passo a passo (sem precisar de CLI local)
### 1) Banco (Cloud SQL Postgres)
- Instancia: `guiia-83a3f:southamerica-east1:guiia87` (IP publico 35.199.112.99).
- Crie um usuario e senha exclusivos (nao commitar). Exemplo SQL (no console do Cloud SQL):
  ```sql
  CREATE DATABASE guiia;
  CREATE USER guiia_user WITH PASSWORD 'senha-forte';
  GRANT ALL PRIVILEGES ON DATABASE guiia TO guiia_user;
  ```
- Libere o IP de saida do Cloud Run (34.39.200.220) ou use VPC Connector/Private IP conforme sua politica.

### 2) API (Cloud Run a partir da pasta `server/`)
- No Cloud Run (deploy from source ou Cloud Build):
  - Build a partir do diretório `server` usando o `Dockerfile`.
  - Runtime Node 20.
  - Variaveis de ambiente:
    - `OPENAI_API_KEY=...` (nao exponha)
    - `JWT_SECRET=chave-secreta-forte`
    - `PGHOST=35.199.112.99`
    - `PGPORT=5432`
    - `PGUSER=guiia_user`
    - `PGPASSWORD=<senha do usuario>`
    - `PGDATABASE=guiia`
    - `DB_SSL=true` (se o Postgres exigir TLS; para IP publico geralmente habilite e use cert validados)
    - `ADMIN_EMAILS=marcos.irenos@gruporic.com.br,marcos.staichaka@gruporic.com.br`
    - `CORS_ORIGINS=https://sua-frontend.app` (se quiser restringir)
  - Porta: 8080 (padrao do Express).
  - CORS: esta habilitado para todos na API; restrinja no Load Balancer se desejar.
  - A API expõe:
    - `POST /api/auth/register` (email @gruporic.com.br, senha)
    - `POST /api/auth/login`
    - `GET /api/chats`
    - `POST /api/chats`
    - `GET /api/chats/:id/messages`
    - `POST /api/chats/:id/messages` (gera resposta GPT e salva)
    - `GET /api/admin/export` (CSV) — admin
    - `GET /api/admin/report` — admin

### 3) Hosting do front
- Hospede a pasta `public` em qualquer estatico (Cloud Storage website, Firebase Hosting ou Cloud Run estatico).
- Antes do deploy, ajuste a URL da API em `public/app.js`:
  ```js
  const API_BASE = window.API_BASE_URL || "https://<sua-api>.run.app/api";
  ```
- Opcional: em producao, defina `window.API_BASE_URL` via tag script inline para nao precisar rebuildar.

### 4) Fluxo de uso
- Registrar/login (somente @gruporic.com.br).
- Criar chat, enviar mensagem; backend guarda historico no Postgres e chama GPT com prompt de identidade.
- Admins (emails fixos) conseguem exportar CSV e ver relatorios.

### 5) O que fica protegido
- Chave GPT no backend (`OPENAI_API_KEY`).
- Credenciais do Postgres em variaveis de ambiente do Cloud Run.
- Senhas de usuarios com hash `bcrypt`.
