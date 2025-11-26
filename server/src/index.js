import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const {
  PORT = 8080,
  JWT_SECRET = "change-me",
  OPENAI_API_KEY,
  ADMIN_EMAILS = "marcos.irenos@gruporic.com.br,marcos.staichaka@gruporic.com.br",
  DATABASE_URL,
  PGHOST,
  PGUSER,
  PGPASSWORD,
  PGDATABASE,
  PGPORT,
  DB_SSL = "false",
  CORS_ORIGINS = "*"
} = process.env;

const adminList = new Set(
  ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
);

const pool = new Pool({
  connectionString: DATABASE_URL,
  host: PGHOST,
  user: PGUSER,
  password: PGPASSWORD,
  database: PGDATABASE,
  port: PGPORT ? Number(PGPORT) : undefined,
  ssl: DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  max: 10
});

const app = express();
const allowedOrigins = CORS_ORIGINS === "*" ? true : CORS_ORIGINS.split(",").map((o) => o.trim());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "1mb" }));

const SYSTEM_PROMPT = `
Voce e GUIA - Assistente ADSIM, suporte oficial do CRM ADSIM do Grupo RIC. Siga exatamente o manual "ADSIM_CRM_PI DIGITAL _ v. abr_2025", o guia de classificacao de clientes e os historicos reais (adsim_support_messages.csv, base hangouts). Responda sempre em portugues-BR, tom amigavel e consultivo. Estrutura obrigatoria:
1) Saudacao amigavel
2) Resumo rapido
3) Passo a passo numerado
4) Observacoes importantes (OPEC/Financeiro)
5) Dica pratica
6) Pergunta final: "Conseguiu seguir?"

Regras absolutas: nunca use "Funit" (prefira "Praca"), abas fixas: Dados Gerais, Entregas, Faturamento, Observacoes/Anexos. Alteracao de praca: Proposta > Entregas > campo Praca. Encaminhe questoes tecnicas para marcos.irenos@gruporic.com.br. Usuarios nao devem excluir Cards (fale com Marcos Irenos). Use nomes reais de menus/botoes. Use documento de classificacao para novo/recorrente/reativado. Dicas praticas sempre que possivel. Se nao tiver certeza, encaminhe.

Fluxos dominados: pipeline (Oportunidade > Proposta > Apresentacao > Em Negociacao > Em Fechamento > Fechado), propostas (produtos, distribuicao diaria/semanal/mensal/proporcional/dias especificos/total, tipos de faturamento liquido/bruto/com reserva/sem faturamento), aprovacao (log, PDF, assinatura digital, geracao automatica de PI), correcoes (remover aprovacao, desconectar/excluir PIs, fluxos por etapa, processo C/S), assinatura digital (CPF, email e data de nascimento obrigatorios), disponibilidade/inventario em Vendas > Consulta Disponibilidade/Inventario.

Se a informacao nao estiver na base: "Nao encontrei essa informacao na base disponivel. Acione o time de inteligencia pelo e-mail inteligencia@gruporic.com.br (Marcos Staichaka)." Sugira "Participe do Grupo ADSIM Parana: https://chat.google.com/room/AAAAlBs_h2U?cls=7".
`;

const ensureTables = async () => {
  await pool.query(`
    create table if not exists users (
      id serial primary key,
      email text unique not null,
      password_hash text not null,
      first_name text,
      last_name text,
      role text default 'user',
      created_at timestamptz default now()
    );
    create table if not exists chats (
      id bigserial primary key,
      title text,
      owner_id integer references users(id) on delete cascade,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    create table if not exists messages (
      id bigserial primary key,
      chat_id bigint references chats(id) on delete cascade,
      user_id integer references users(id) on delete set null,
      role text not null, -- user|assistant
      content text not null,
      created_at timestamptz default now()
    );
    create index if not exists idx_chats_owner on chats(owner_id, updated_at desc);
    create index if not exists idx_messages_chat on messages(chat_id, created_at asc);
  `);
};

const authMiddleware = async (req, res, next) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "token ausente" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "token invalido" });
  }
};

const isAdmin = (email) => adminList.has((email || "").toLowerCase());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth/register", async (req, res) => {
  const { email, password, firstName = "", lastName = "" } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email e senha obrigatorios" });
  if (!email.toLowerCase().endsWith("@gruporic.com.br")) {
    return res.status(400).json({ error: "use email @gruporic.com.br" });
  }
  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash(password, 10);
    const role = isAdmin(email) ? "admin" : "user";
    const insert = await client.query(
      "insert into users(email, password_hash, first_name, last_name, role) values ($1,$2,$3,$4,$5) returning id,email,role,first_name,last_name",
      [email.toLowerCase(), hash, firstName, lastName, role]
    );
    const user = insert.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "usuario ja existe" });
    }
    console.error(err);
    res.status(500).json({ error: "erro ao registrar" });
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "credenciais obrigatorias" });
  const client = await pool.connect();
  try {
    const lookup = await client.query("select * from users where email=$1", [email.toLowerCase()]);
    if (!lookup.rows.length) return res.status(401).json({ error: "usuario nao encontrado" });
    const user = lookup.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "senha incorreta" });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "erro ao autenticar" });
  } finally {
    client.release();
  }
});

app.get("/api/chats", authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const admin = isAdmin(req.user.email);
    const result = admin
      ? await client.query(`
          select c.*, u.email as owner_email
          from chats c
          join users u on u.id = c.owner_id
          order by c.updated_at desc
          limit 100
        `)
      : await client.query(`
          select c.*, u.email as owner_email
          from chats c
          join users u on u.id = c.owner_id
          where c.owner_id=$1
          order by c.updated_at desc
          limit 100
        `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "erro ao listar chats" });
  } finally {
    client.release();
  }
});

app.post("/api/chats", authMiddleware, async (req, res) => {
  const { title } = req.body || {};
  const client = await pool.connect();
  try {
    const insert = await client.query(
      "insert into chats(title, owner_id) values ($1,$2) returning *",
      [title || "Chat " + new Date().toLocaleString("pt-BR"), req.user.id]
    );
    res.json(insert.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "erro ao criar chat" });
  } finally {
    client.release();
  }
});

app.get("/api/chats/:id/messages", authMiddleware, async (req, res) => {
  const chatId = Number(req.params.id);
  if (!chatId) return res.status(400).json({ error: "chatId invalido" });
  const client = await pool.connect();
  try {
    const chat = await client.query("select * from chats where id=$1", [chatId]);
    if (!chat.rows.length) return res.status(404).json({ error: "chat nao encontrado" });
    const isOwner = chat.rows[0].owner_id === req.user.id;
    if (!isOwner && !isAdmin(req.user.email)) {
      return res.status(403).json({ error: "sem permissao" });
    }
    const msgs = await client.query(
      "select * from messages where chat_id=$1 order by created_at asc",
      [chatId]
    );
    res.json(msgs.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "erro ao listar mensagens" });
  } finally {
    client.release();
  }
});

app.post("/api/chats/:id/messages", authMiddleware, async (req, res) => {
  const chatId = Number(req.params.id);
  const { content } = req.body || {};
  if (!chatId || !content) return res.status(400).json({ error: "conteudo obrigatorio" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const chat = await client.query("select * from chats where id=$1 for update", [chatId]);
    if (!chat.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "chat nao encontrado" });
    }
    const isOwner = chat.rows[0].owner_id === req.user.id;
    if (!isOwner && !isAdmin(req.user.email)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "sem permissao" });
    }
    await client.query(
      "insert into messages(chat_id, user_id, role, content) values ($1,$2,$3,$4)",
      [chatId, req.user.id, "user", content]
    );
    await client.query("update chats set updated_at=now() where id=$1", [chatId]);

    if (!OPENAI_API_KEY) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "OPENAI_API_KEY ausente no backend" });
    }

    const history = await client.query(
      "select role, content from messages where chat_id=$1 order by created_at desc limit 10",
      [chatId]
    );
    const messages = history.rows.reverse().map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content
    }));
    messages.unshift({ role: "system", content: SYSTEM_PROMPT.trim() });
    messages.push({ role: "user", content });

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: messages.slice(-20)
      })
    });
    const data = await completion.json();
    if (!completion.ok) {
      console.error("openai error", data);
      await client.query("ROLLBACK");
      return res.status(500).json({ error: data });
    }
    const reply = data?.choices?.[0]?.message?.content || "Sem resposta";
    await client.query(
      "insert into messages(chat_id, user_id, role, content) values ($1,$2,$3,$4)",
      [chatId, null, "assistant", reply]
    );
    await client.query("COMMIT");
    res.json({ reply });
  } catch (err) {
    console.error(err);
    await client.query("ROLLBACK");
    res.status(500).json({ error: "erro ao enviar mensagem" });
  } finally {
    client.release();
  }
});

app.get("/api/admin/export", authMiddleware, async (req, res) => {
  if (!isAdmin(req.user.email)) return res.status(403).json({ error: "somente admin" });
  const client = await pool.connect();
  try {
    const chats = await client.query(`
      select c.*, u.email as owner_email
      from chats c
      join users u on u.id = c.owner_id
      order by c.id asc
    `);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=adsim_chats.csv");
    res.write(`chat_id,owner_id,owner_email,role,content,created_at\n`);
    for (const chat of chats.rows) {
      const msgs = await client.query("select * from messages where chat_id=$1 order by created_at asc", [chat.id]);
      msgs.rows.forEach((m) => {
        const line = [
          chat.id,
          chat.owner_id,
          chat.owner_email || "",
          m.role,
          `"${(m.content || "").replace(/"/g, '""')}"`,
          m.created_at.toISOString()
        ].join(",");
        res.write(line + "\n");
      });
    }
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "erro ao exportar" });
  } finally {
    client.release();
  }
});

app.get("/api/admin/report", authMiddleware, async (req, res) => {
  if (!isAdmin(req.user.email)) return res.status(403).json({ error: "somente admin" });
  const client = await pool.connect();
  try {
    const usage = await client.query(`
      select u.email, count(*) as total
      from chats c
      join users u on u.id = c.owner_id
      group by u.email
      order by total desc
      limit 20
    `);
    const topics = await client.query(`
      select lower(split_part(content,' ',1)) as term, count(*) as total
      from messages
      where role='user' and content is not null
      group by term
      order by total desc
      limit 20
    `);
    res.json({
      usage: usage.rows,
      topics: topics.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "erro ao gerar relatorio" });
  } finally {
    client.release();
  }
});

ensureTables()
  .then(() => {
    app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
  })
  .catch((err) => {
    console.error("Erro iniciando tabelas", err);
    process.exit(1);
  });
