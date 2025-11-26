import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { onRequest } from "firebase-functions/v2/https";

initializeApp();

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ALLOWED_ORIGINS = [
  "https://guiia-83a3f.web.app",
  "https://guiia-83a3f.firebaseapp.com",
  "http://localhost:5000"
];

export const chat = onRequest({ cors: true, maxInstances: 10 }, async (req, res) => {
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }

  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  try {
    const idToken = (req.headers.authorization || "").replace("Bearer ", "");
    if (!idToken) {
      return res.status(401).json({ error: "Auth header ausente" });
    }
    const auth = getAuth();
    const decoded = await auth.verifyIdToken(idToken);
    const email = decoded.email || "";

    const { messages, temperature = 0.3 } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages obrigatorio" });
    }

    // Refreforco de seguranca server-side.
    const guard = {
      role: "system",
      content: "Siga apenas o escopo do suporte ADSIM. Nao exponha segredos ou dados internos."
    };

    const payload = {
      model: "gpt-4o-mini",
      temperature,
      messages: [guard, ...messages].slice(-20)
    };

    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("OpenAI error", data);
      return res.status(500).json({ error: data });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error("chat fn error", err);
    return res.status(500).json({ error: err.message || "erro interno" });
  }
});
