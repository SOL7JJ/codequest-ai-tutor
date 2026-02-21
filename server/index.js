import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "./db/index.js";

dotenv.config({ quiet: true });

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 20);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 350);
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function buildToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireDatabase(res) {
  if (!pool) {
    res.status(500).json({ error: "DATABASE_URL is not configured on the server" });
    return false;
  }
  return true;
}

const tutorRateLimitState = new Map();

function tutorRateLimit(req, res, next) {
  const key = req.user?.sub || req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  const record = tutorRateLimitState.get(key);

  if (!record || now - record.windowStart >= RATE_LIMIT_WINDOW_MS) {
    tutorRateLimitState.set(key, { windowStart: now, count: 1 });
    return next();
  }

  if (record.count >= RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 1000);
    return res.status(429).json({
      error: "Rate limit exceeded. Try again shortly.",
      retryAfterSeconds,
    });
  }

  record.count += 1;
  return next();
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of tutorRateLimitState.entries()) {
    if (now - record.windowStart >= RATE_LIMIT_WINDOW_MS) {
      tutorRateLimitState.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

cleanupTimer.unref();

app.post("/api/auth/register", async (req, res) => {
  if (!requireDatabase(res)) return;

  const { email, password } = req.body || {};

  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users(email, password_hash) VALUES($1, $2) RETURNING id, email",
      [normalizedEmail, passwordHash]
    );

    const user = result.rows[0];
    const token = buildToken(user);

    return res.status(201).json({ token, user });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Email already in use" });
    }
    console.error("Register error:", err);
    return res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  if (!requireDatabase(res)) return;

  const { email, password } = req.body || {};

  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const result = await pool.query("SELECT id, email, password_hash FROM users WHERE email = $1", [
      normalizedEmail,
    ]);

    if (!result.rows.length) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const row = result.rows[0];
    const isValid = await bcrypt.compare(password, row.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = { id: row.id, email: row.email };
    const token = buildToken(user);

    return res.status(200).json({ token, user });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;

  try {
    const result = await pool.query("SELECT id, email FROM users WHERE id = $1", [req.user.sub]);

    if (!result.rows.length) {
      return res.status(401).json({ error: "User not found" });
    }

    return res.status(200).json({ user: result.rows[0] });
  } catch (err) {
    console.error("Me error:", err);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

app.post("/api/tutor", requireAuth, tutorRateLimit, async (req, res) => {
  try {
    const { message, level = "KS3", topic = "Python", mode = "Explain" } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' string" });
    }

    const client = getClient();
    if (!client) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
    }

    const system = `You are a ${level} Computer Science tutor.\nTopic: ${topic}\nMode: ${mode}\nTeach clearly and step-by-step.`;

    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Tutor request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
    });

    let response;
    try {
      response = await Promise.race([
        client.responses.create({
          model: "gpt-4o-mini",
          max_output_tokens: MAX_OUTPUT_TOKENS,
          input: [
            { role: "system", content: system },
            { role: "user", content: message },
          ],
        }),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timeoutHandle);
    }

    const reply = response.output_text || "(No output_text returned)";
    return res.json({ reply });
  } catch (e) {
    if (String(e?.message || "").includes("timed out")) {
      return res.status(504).json({ error: e.message });
    }

    console.error("Tutor error:", e);
    return res.status(500).json({ error: "LLM failed", details: String(e) });
  }
});

app.post("/api/tutor/stream", requireAuth, tutorRateLimit, async (req, res) => {
  try {
    const { message, level = "KS3", topic = "Python", mode = "Explain" } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' string" });
    }

    const client = getClient();
    if (!client) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
    }

    const system = `You are a ${level} Computer Science tutor.\nTopic: ${topic}\nMode: ${mode}\nTeach clearly and step-by-step.\nPrefer concise answers unless the user asks for more detail.`;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const stream = await client.responses.create({
      model: "gpt-4o-mini",
      max_output_tokens: MAX_OUTPUT_TOKENS,
      stream: true,
      input: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
    });

    for await (const event of stream) {
      if (event?.type === "response.output_text.delta" && typeof event.delta === "string") {
        res.write(`data: ${JSON.stringify({ delta: event.delta })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    return res.end();
  } catch (e) {
    console.error("Tutor stream error:", e);
    if (!res.headersSent) {
      return res.status(500).json({ error: "LLM streaming failed", details: String(e) });
    }
    res.write(`data: ${JSON.stringify({ error: "LLM streaming failed" })}\n\n`);
    return res.end();
  }
});

async function ensureSchema() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function start() {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY is not set. /api/tutor will fail until it is configured.");
  }

  if (!process.env.JWT_SECRET) {
    console.warn("JWT_SECRET is not set. Using fallback secret; set a secure JWT_SECRET in production.");
  }

  if (pool) {
    try {
      await pool.query("SELECT NOW()");
      await ensureSchema();
      console.log("Database connection and schema check passed.");
    } catch (err) {
      console.warn("Database connection or schema check failed:", err.message);
    }
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();
