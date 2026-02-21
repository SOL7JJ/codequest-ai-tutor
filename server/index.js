import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
import pool from "./db/index.js";

dotenv.config({ quiet: true });

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 20);
const DEMO_RATE_LIMIT_MAX = Number(process.env.DEMO_RATE_LIMIT_MAX || 5);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 350);
const FREE_TIER_DAILY_TURNS = Number(process.env.FREE_TIER_DAILY_TURNS || 20);
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const APP_URL = process.env.APP_URL || "http://localhost:5173";
const STRIPE_PRICE_ID_MONTHLY = process.env.STRIPE_PRICE_ID_MONTHLY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const TEACHER_EMAILS = (process.env.TEACHER_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const app = express();
app.use(cors());

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(200).json({ ignored: true });
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return res.status(400).send("Missing stripe-signature header");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (!pool) {
      return res.status(200).json({ received: true, db: false });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        if (!subscriptionId || !customerId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        await pool.query(
          `UPDATE users
           SET subscription_id = $1,
               subscription_status = $2,
               subscription_current_period_end = to_timestamp($3),
               updated_at = NOW()
           WHERE stripe_customer_id = $4`,
          [
            String(subscription.id),
            String(subscription.status || "inactive"),
            Number(subscription.current_period_end || 0),
            String(customerId),
          ]
        );
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        if (!customerId) break;

        await pool.query(
          `UPDATE users
           SET subscription_id = $1,
               subscription_status = $2,
               subscription_current_period_end = to_timestamp($3),
               updated_at = NOW()
           WHERE stripe_customer_id = $4`,
          [
            String(subscription.id || ""),
            String(subscription.status || "inactive"),
            Number(subscription.current_period_end || 0),
            String(customerId),
          ]
        );
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Stripe webhook handling error:", err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function buildToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role || "student" }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
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

async function getUserById(userId) {
  const result = await pool.query(
    `SELECT id, email, role, stripe_customer_id, subscription_id, subscription_status, subscription_current_period_end
     FROM users
     WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

function resolveRole(email, requestedRole) {
  if (requestedRole !== "teacher") return "student";
  if (!TEACHER_EMAILS.length) return "teacher";
  return TEACHER_EMAILS.includes(email) ? "teacher" : "student";
}

async function requireTeacher(req, res, next) {
  if (!requireDatabase(res)) return;
  try {
    const user = await getUserById(req.user.sub);
    if (!user) return res.status(401).json({ error: "User not found" });
    if (user.role !== "teacher") return res.status(403).json({ error: "Teacher access required" });
    req.authUser = user;
    return next();
  } catch (err) {
    console.error("Teacher auth error:", err);
    return res.status(500).json({ error: "Failed to verify teacher access" });
  }
}

function isSubscriptionActive(status) {
  return status === "active" || status === "trialing";
}

function getBillingConfigError() {
  if (!stripe) return "STRIPE_SECRET_KEY is missing or invalid";
  if (!STRIPE_PRICE_ID_MONTHLY) return "STRIPE_PRICE_ID_MONTHLY is missing";
  if (!STRIPE_PRICE_ID_MONTHLY.startsWith("price_")) {
    return "STRIPE_PRICE_ID_MONTHLY must start with price_";
  }
  if (!APP_URL?.startsWith("http://") && !APP_URL?.startsWith("https://")) {
    return "APP_URL must include protocol, for example https://your-frontend-domain.com";
  }
  return "";
}

function toIsoDateOnly(dateLike) {
  return new Date(dateLike).toISOString().slice(0, 10);
}

function computeCurrentStreak(activeDateSet) {
  let streak = 0;
  const cursor = new Date();

  while (true) {
    const key = toIsoDateOnly(cursor);
    if (!activeDateSet.has(key)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}

async function persistChatTurn({ userId, userMessage, assistantMessage, level, topic, mode }) {
  if (!pool) return;
  if (!userMessage?.trim() || !assistantMessage?.trim()) return;

  try {
    await pool.query(
      `INSERT INTO chat_messages(user_id, role, content, level, topic, mode)
       VALUES ($1, 'user', $2, $3, $4, $5), ($1, 'assistant', $6, $3, $4, $5)`,
      [userId, userMessage, level, topic, mode, assistantMessage]
    );
  } catch (err) {
    console.error("Persist chat turn error:", err);
  }
}

async function getTodayTurnCount(userId) {
  if (!pool) return 0;
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const result = await pool.query(
    `SELECT COUNT(*)::INT AS count
     FROM chat_messages
     WHERE user_id = $1 AND role = 'assistant' AND created_at >= $2`,
    [userId, dayStart.toISOString()]
  );

  return Number(result.rows[0]?.count || 0);
}

async function getTutorAccessContext(userId, mode, isStreaming) {
  if (!pool) {
    return {
      allowed: true,
      plan: "free",
      usage: {
        dailyLimit: FREE_TIER_DAILY_TURNS,
        dailyUsed: 0,
        dailyRemaining: FREE_TIER_DAILY_TURNS,
      },
    };
  }

  const user = await getUserById(userId);
  if (!user) {
    return { allowed: false, status: 401, error: "User not found" };
  }

  const paid = isSubscriptionActive(user.subscription_status);
  const turnsToday = await getTodayTurnCount(userId);
  const remaining = Math.max(FREE_TIER_DAILY_TURNS - turnsToday, 0);

  if (paid) {
    return {
      allowed: true,
      plan: "pro",
      user,
      usage: {
        dailyLimit: null,
        dailyUsed: turnsToday,
        dailyRemaining: null,
      },
    };
  }

  if (isStreaming) {
    return {
      allowed: false,
      status: 402,
      error: "Streaming responses are available on CodeQuest Pro.",
      billing: {
        status: user.subscription_status || "inactive",
        currentPeriodEnd: user.subscription_current_period_end,
        plan: "free",
        usage: {
          dailyLimit: FREE_TIER_DAILY_TURNS,
          dailyUsed: turnsToday,
          dailyRemaining: remaining,
        },
      },
    };
  }

  if (mode === "Quiz" || mode === "Mark") {
    return {
      allowed: false,
      status: 402,
      error: `${mode} mode is available on CodeQuest Pro.`,
      billing: {
        status: user.subscription_status || "inactive",
        currentPeriodEnd: user.subscription_current_period_end,
        plan: "free",
        usage: {
          dailyLimit: FREE_TIER_DAILY_TURNS,
          dailyUsed: turnsToday,
          dailyRemaining: remaining,
        },
      },
    };
  }

  if (turnsToday >= FREE_TIER_DAILY_TURNS) {
    return {
      allowed: false,
      status: 429,
      error: `Free plan daily limit reached (${FREE_TIER_DAILY_TURNS} turns). Upgrade to continue now.`,
      billing: {
        status: user.subscription_status || "inactive",
        currentPeriodEnd: user.subscription_current_period_end,
        plan: "free",
        usage: {
          dailyLimit: FREE_TIER_DAILY_TURNS,
          dailyUsed: turnsToday,
          dailyRemaining: remaining,
        },
      },
    };
  }

  return {
    allowed: true,
    plan: "free",
    user,
    usage: {
      dailyLimit: FREE_TIER_DAILY_TURNS,
      dailyUsed: turnsToday,
      dailyRemaining: remaining,
    },
  };
}

function inferCodingTopics(code = "") {
  const text = code.toLowerCase();
  const topics = [];
  if (/for\s*\(|while\s*\(|for\s+\w+\s+in\s+/.test(text)) topics.push("Loops");
  if (/if\s*\(|elif\s|else\s*:|switch\s*\(/.test(text)) topics.push("Conditionals");
  if (/function\s+\w+|def\s+\w+|=>/.test(text)) topics.push("Functions");
  if (/class\s+\w+/.test(text)) topics.push("Object Oriented Programming");
  if (/\b(array|list|dict|map|set)\b|\[.*\]|\{.*\}/.test(text)) topics.push("Data Structures");
  if (/try\s*:|catch\s*\(|except\s+/.test(text)) topics.push("Error Handling");
  return topics.slice(0, 5);
}

function evaluateCodeHeuristics(code = "", language = "general") {
  const lines = code.split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const longLines = nonEmptyLines.filter((line) => line.length > 120).length;
  const hasComments = /(#|\/\/|\/\*)/.test(code);
  const hasConditionals = /\bif\b|\bswitch\b|\belif\b/.test(code);
  const hasLoops = /\bfor\b|\bwhile\b/.test(code);
  const hasFunctions = /\bfunction\b|\bdef\b|=>/.test(code);
  const hasErrorHandling = /\btry\b|\bcatch\b|\bexcept\b/.test(code);

  let score = 10;
  if (nonEmptyLines.length < 3) score -= 2;
  if (longLines > 0) score -= 1;
  if (!hasComments) score -= 1;
  if (!hasFunctions && nonEmptyLines.length > 12) score -= 1;
  if (!hasConditionals && !hasLoops && nonEmptyLines.length > 8) score -= 1;
  if (!hasErrorHandling && /input|fetch|read|parse|json|api/i.test(code)) score -= 1;
  score = Math.max(1, Math.min(10, score));

  const improvements = [];
  if (!hasComments) improvements.push("Add short comments for key logic blocks.");
  if (longLines > 0) improvements.push("Break long lines into smaller, readable statements.");
  if (!hasFunctions && nonEmptyLines.length > 12) improvements.push("Extract repeated logic into functions.");
  if (!hasErrorHandling && /input|fetch|read|parse|json|api/i.test(code)) {
    improvements.push("Add error handling for external input and parsing.");
  }
  if (!improvements.length) improvements.push("Code structure is solid. Focus on testing edge cases.");

  return {
    score,
    summary:
      score >= 8
        ? "Strong solution with good structure."
        : score >= 5
          ? "Good start. A few improvements will make it robust."
          : "Core idea is present, but structure and reliability need work.",
    improvements: improvements.slice(0, 4),
    tips: [
      "Test with normal, edge, and invalid inputs.",
      "Use meaningful variable names that reveal intent.",
      "Refactor duplicated code into helper functions.",
    ],
    topics: inferCodingTopics(code),
    language,
  };
}

function generateQuizTemplate({ topic = "Python", level = "KS3", numQuestions = 5 }) {
  const count = Math.min(Math.max(Number(numQuestions) || 5, 1), 10);
  return Array.from({ length: count }).map((_, index) => ({
    id: index + 1,
    question: `[${level}] ${topic} question ${index + 1}: Explain the output or behavior.`,
    answerGuide: `Expected points: key concept, example, and common mistake to avoid for ${topic}.`,
  }));
}

const tutorRateLimitState = new Map();
const demoRateLimitState = new Map();

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

function demoRateLimit(req, res, next) {
  const key = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  const record = demoRateLimitState.get(key);

  if (!record || now - record.windowStart >= RATE_LIMIT_WINDOW_MS) {
    demoRateLimitState.set(key, { windowStart: now, count: 1 });
    return next();
  }

  if (record.count >= DEMO_RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 1000);
    return res.status(429).json({
      error: "Demo rate limit exceeded. Please sign up to continue.",
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
  for (const [key, record] of demoRateLimitState.entries()) {
    if (now - record.windowStart >= RATE_LIMIT_WINDOW_MS) {
      demoRateLimitState.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

cleanupTimer.unref();

app.post("/api/auth/register", async (req, res) => {
  if (!requireDatabase(res)) return;

  const { email, password, role: requestedRole } = req.body || {};

  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const role = resolveRole(normalizedEmail, requestedRole);
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users(email, password_hash, role) VALUES($1, $2, $3) RETURNING id, email, role, subscription_status",
      [normalizedEmail, passwordHash, role]
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
    const result = await pool.query(
      "SELECT id, email, role, password_hash, subscription_status FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const row = result.rows[0];
    const isValid = await bcrypt.compare(password, row.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = {
      id: row.id,
      email: row.email,
      role: row.role || "student",
      subscription_status: row.subscription_status,
    };
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
    const user = await getUserById(req.user.sub);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role || "student",
        subscription_status: user.subscription_status,
      },
    });
  } catch (err) {
    console.error("Me error:", err);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

app.get("/api/billing/status", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;

  try {
    const user = await getUserById(req.user.sub);
    if (!user) return res.status(401).json({ error: "User not found" });

    const dailyUsed = await getTodayTurnCount(req.user.sub);
    const dailyRemaining = Math.max(FREE_TIER_DAILY_TURNS - dailyUsed, 0);
    const paid = isSubscriptionActive(user.subscription_status);

    return res.status(200).json({
      billing: {
        status: user.subscription_status || "inactive",
        customerId: user.stripe_customer_id || null,
        currentPeriodEnd: user.subscription_current_period_end || null,
        plan: paid ? "pro" : "free",
        usage: {
          dailyLimit: paid ? null : FREE_TIER_DAILY_TURNS,
          dailyUsed,
          dailyRemaining: paid ? null : dailyRemaining,
        },
      },
    });
  } catch (err) {
    console.error("Billing status error:", err);
    return res.status(500).json({ error: "Failed to fetch billing status" });
  }
});

app.get("/api/chat/history", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;

  const limitRaw = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 100;

  try {
    const result = await pool.query(
      `SELECT role, content, level, topic, mode, created_at
       FROM chat_messages
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user.sub, limit]
    );

    const messages = result.rows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
      level: row.level,
      topic: row.topic,
      mode: row.mode,
      created_at: row.created_at,
    }));

    return res.status(200).json({ messages });
  } catch (err) {
    console.error("Chat history error:", err);
    return res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

app.post("/api/demo/tutor", demoRateLimit, async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' string" });
    }

    const client = getClient();
    if (!client) {
      return res.status(200).json({
        reply:
          "Demo mode is available, but AI is not configured right now. Please sign up and try again shortly.",
      });
    }

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      max_output_tokens: 220,
      input: [
        {
          role: "system",
          content:
            "You are a concise computer science tutor in demo mode. Keep response under 6 short lines and include one practical next step.",
        },
        { role: "user", content: message },
      ],
    });

    return res.status(200).json({
      reply: response.output_text || "I could not generate a demo response this time.",
    });
  } catch (err) {
    console.error("Demo tutor error:", err);
    return res.status(500).json({ error: "Failed to run demo question" });
  }
});

app.get("/api/progress/overview", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;

  try {
    const turnsResult = await pool.query(
      `SELECT topic, mode, created_at
       FROM chat_messages
       WHERE user_id = $1 AND role = 'assistant'
       ORDER BY created_at ASC`,
      [req.user.sub]
    );

    const turns = turnsResult.rows;
    const topicCounts = new Map();
    const modeCounts = new Map();
    const dayCounts = new Map();

    for (const turn of turns) {
      const topic = turn.topic || "General";
      const mode = turn.mode || "Explain";
      const dayKey = toIsoDateOnly(turn.created_at);

      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
      modeCounts.set(mode, (modeCounts.get(mode) || 0) + 1);
      dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
    }

    const topicBreakdown = [...topicCounts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count);

    const modeBreakdown = [...modeCounts.entries()]
      .map(([mode, count]) => ({ mode, count }))
      .sort((a, b) => b.count - a.count);

    const activeDates = new Set(dayCounts.keys());
    const currentStreakDays = computeCurrentStreak(activeDates);

    const last7Days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() - i);
      const date = toIsoDateOnly(day);
      last7Days.push({
        date,
        turns: dayCounts.get(date) || 0,
      });
    }

    const quizResult = await pool.query(
      `SELECT topic, score, max_score, created_at
       FROM quiz_attempts
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.sub]
    );

    const lessonResult = await pool.query(
      `SELECT topic, completed
       FROM lessons
       WHERE user_id = $1`,
      [req.user.sub]
    );

    const codeEvalResult = await pool.query(
      `SELECT topic, score, created_at
       FROM code_evaluations
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.sub]
    );

    const quizzesTaken = quizResult.rows.length;
    const marksRequested = modeCounts.get("Mark") || 0;
    const averageQuizScore = quizResult.rows.length
      ? Number(
          (
            quizResult.rows.reduce((acc, row) => acc + (Number(row.score || 0) / Math.max(Number(row.max_score || 1), 1)) * 100, 0) /
            quizResult.rows.length
          ).toFixed(1)
        )
      : 0;
    const averageCodeScore = codeEvalResult.rows.length
      ? Number(
          (
            codeEvalResult.rows.reduce((acc, row) => acc + Number(row.score || 0), 0) /
            codeEvalResult.rows.length
          ).toFixed(1)
        )
      : 0;

    const lessonsCompleted = lessonResult.rows.filter((row) => row.completed).length;
    const lessonsTotal = lessonResult.rows.length;

    const completedTopicsSet = new Set(topicCounts.keys());
    for (const row of lessonResult.rows) {
      if (row.topic) completedTopicsSet.add(row.topic);
    }
    for (const row of quizResult.rows) {
      if (row.topic) completedTopicsSet.add(row.topic);
    }
    for (const row of codeEvalResult.rows) {
      if (row.topic) completedTopicsSet.add(row.topic);
    }

    const lastActiveAt = turns.length ? turns[turns.length - 1].created_at : null;

    return res.status(200).json({
      summary: {
        totalTurns: turns.length,
        topicsCovered: completedTopicsSet.size,
        quizzesTaken,
        marksRequested,
        averageQuizScore,
        averageCodeScore,
        lessonsCompleted,
        lessonsTotal,
        currentStreakDays,
        lastActiveAt,
      },
      topicBreakdown,
      modeBreakdown,
      dailyActivity: last7Days,
      completedTopics: [...completedTopicsSet].sort(),
      recentQuizScores: quizResult.rows.slice(0, 10).map((row) => ({
        topic: row.topic || "General",
        score: Number(row.score || 0),
        maxScore: Number(row.max_score || 0),
        created_at: row.created_at,
      })),
    });
  } catch (err) {
    console.error("Progress overview error:", err);
    return res.status(500).json({ error: "Failed to fetch progress overview" });
  }
});

app.get("/api/student/lessons", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(
      `SELECT id, title, topic, completed, created_at, completed_at
       FROM lessons
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.sub]
    );
    return res.status(200).json({ lessons: result.rows });
  } catch (err) {
    console.error("List lessons error:", err);
    return res.status(500).json({ error: "Failed to list lessons" });
  }
});

app.post("/api/student/lessons", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  const { title, topic } = req.body || {};
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "Lesson title is required" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO lessons(user_id, title, topic)
       VALUES($1, $2, $3)
       RETURNING id, title, topic, completed, created_at, completed_at`,
      [req.user.sub, title.trim(), (topic || "").trim() || null]
    );
    return res.status(201).json({ lesson: result.rows[0] });
  } catch (err) {
    console.error("Create lesson error:", err);
    return res.status(500).json({ error: "Failed to create lesson" });
  }
});

app.patch("/api/student/lessons/:lessonId", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  const lessonId = Number(req.params.lessonId);
  const { completed } = req.body || {};
  if (!Number.isInteger(lessonId) || typeof completed !== "boolean") {
    return res.status(400).json({ error: "Valid lesson id and completed flag are required" });
  }
  try {
    const result = await pool.query(
      `UPDATE lessons
       SET completed = $1,
           completed_at = CASE WHEN $1 THEN NOW() ELSE NULL END
       WHERE id = $2 AND user_id = $3
       RETURNING id, title, topic, completed, created_at, completed_at`,
      [completed, lessonId, req.user.sub]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Lesson not found" });
    return res.status(200).json({ lesson: result.rows[0] });
  } catch (err) {
    console.error("Update lesson error:", err);
    return res.status(500).json({ error: "Failed to update lesson" });
  }
});

app.post("/api/student/quiz-attempts", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  const { topic = "General", score, maxScore = 10 } = req.body || {};
  if (!Number.isFinite(Number(score)) || !Number.isFinite(Number(maxScore))) {
    return res.status(400).json({ error: "score and maxScore are required numbers" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO quiz_attempts(user_id, topic, score, max_score)
       VALUES($1, $2, $3, $4)
       RETURNING id, topic, score, max_score, created_at`,
      [req.user.sub, String(topic), Number(score), Number(maxScore)]
    );
    return res.status(201).json({ attempt: result.rows[0] });
  } catch (err) {
    console.error("Quiz attempt error:", err);
    return res.status(500).json({ error: "Failed to store quiz attempt" });
  }
});

app.get("/api/student/tasks", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(
      `SELECT id, title, topic, description, due_date, status, created_at
       FROM tasks
       WHERE student_id = $1
       ORDER BY created_at DESC`,
      [req.user.sub]
    );
    return res.status(200).json({ tasks: result.rows });
  } catch (err) {
    console.error("Student tasks error:", err);
    return res.status(500).json({ error: "Failed to list tasks" });
  }
});

app.patch("/api/student/tasks/:taskId", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  const taskId = Number(req.params.taskId);
  const { status } = req.body || {};
  if (!Number.isInteger(taskId) || !["pending", "in_progress", "completed"].includes(status)) {
    return res.status(400).json({ error: "Valid task id and status are required" });
  }
  try {
    const result = await pool.query(
      `UPDATE tasks
       SET status = $1,
           completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END
       WHERE id = $2 AND student_id = $3
       RETURNING id, title, topic, description, due_date, status, created_at`,
      [status, taskId, req.user.sub]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Task not found" });
    return res.status(200).json({ task: result.rows[0] });
  } catch (err) {
    console.error("Update task error:", err);
    return res.status(500).json({ error: "Failed to update task" });
  }
});

app.post("/api/code/evaluate", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  const { code, language = "general", topic = "General" } = req.body || {};
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Code is required for evaluation" });
  }

  try {
    const evaluation = evaluateCodeHeuristics(code, language);
    await pool.query(
      `INSERT INTO code_evaluations(user_id, topic, language, score, summary, improvements, tips)
       VALUES($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        req.user.sub,
        String(topic || "General"),
        String(language || "general"),
        Number(evaluation.score),
        evaluation.summary,
        JSON.stringify(evaluation.improvements),
        JSON.stringify(evaluation.tips),
      ]
    );
    return res.status(200).json({ evaluation });
  } catch (err) {
    console.error("Code evaluation error:", err);
    return res.status(500).json({ error: "Failed to evaluate code" });
  }
});

app.post("/api/teacher/quizzes/generate", requireAuth, requireTeacher, async (req, res) => {
  if (!requireDatabase(res)) return;
  const { topic = "Python", level = "KS3", numQuestions = 5, title } = req.body || {};
  try {
    const questions = generateQuizTemplate({ topic, level, numQuestions });
    const result = await pool.query(
      `INSERT INTO teacher_quizzes(teacher_id, title, topic, level, questions)
       VALUES($1, $2, $3, $4, $5::jsonb)
       RETURNING id, title, topic, level, questions, created_at`,
      [req.authUser.id, title?.trim() || `${topic} Practice Quiz`, topic, level, JSON.stringify(questions)]
    );
    return res.status(201).json({ quiz: result.rows[0] });
  } catch (err) {
    console.error("Generate teacher quiz error:", err);
    return res.status(500).json({ error: "Failed to generate teacher quiz" });
  }
});

app.post("/api/teacher/tasks/assign", requireAuth, requireTeacher, async (req, res) => {
  if (!requireDatabase(res)) return;
  const { studentEmail, title, description = "", topic = "General", dueDate = null } = req.body || {};
  if (!studentEmail || !title) {
    return res.status(400).json({ error: "studentEmail and title are required" });
  }
  try {
    const studentResult = await pool.query(
      `SELECT id, email FROM users WHERE email = $1`,
      [String(studentEmail).trim().toLowerCase()]
    );
    if (!studentResult.rows.length) {
      return res.status(404).json({ error: "Student not found for that email" });
    }

    const taskResult = await pool.query(
      `INSERT INTO tasks(teacher_id, student_id, title, topic, description, due_date)
       VALUES($1, $2, $3, $4, $5, $6)
       RETURNING id, title, topic, description, due_date, status, created_at`,
      [
        req.authUser.id,
        studentResult.rows[0].id,
        String(title).trim(),
        String(topic),
        String(description),
        dueDate || null,
      ]
    );

    return res.status(201).json({
      task: taskResult.rows[0],
      student: { id: studentResult.rows[0].id, email: studentResult.rows[0].email },
    });
  } catch (err) {
    console.error("Assign task error:", err);
    return res.status(500).json({ error: "Failed to assign task" });
  }
});

app.get("/api/teacher/results", requireAuth, requireTeacher, async (req, res) => {
  if (!requireDatabase(res)) return;
  try {
    const result = await pool.query(
      `SELECT
         u.id AS student_id,
         u.email AS student_email,
         COUNT(DISTINCT t.id)::INT AS assigned_tasks,
         COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END)::INT AS completed_tasks,
         COALESCE(ROUND(AVG(qa.score / NULLIF(qa.max_score, 0) * 100)::numeric, 1), 0) AS avg_quiz_percent,
         COALESCE(ROUND(AVG(ce.score)::numeric, 1), 0) AS avg_code_score
       FROM users u
       LEFT JOIN tasks t ON t.student_id = u.id AND t.teacher_id = $1
       LEFT JOIN quiz_attempts qa ON qa.user_id = u.id
       LEFT JOIN code_evaluations ce ON ce.user_id = u.id
       WHERE u.role = 'student'
       GROUP BY u.id, u.email
       ORDER BY u.email ASC`,
      [req.authUser.id]
    );
    return res.status(200).json({ students: result.rows });
  } catch (err) {
    console.error("Teacher results error:", err);
    return res.status(500).json({ error: "Failed to fetch teacher results" });
  }
});

app.post("/api/billing/create-checkout-session", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  const configError = getBillingConfigError();
  if (configError) {
    return res.status(500).json({ error: configError });
  }

  try {
    const user = await getUserById(req.user.sub);
    if (!user) return res.status(401).json({ error: "User not found" });

    if (isSubscriptionActive(user.subscription_status)) {
      return res.status(400).json({ error: "Subscription already active" });
    }

    let customerId = user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          app_user_id: String(user.id),
        },
      });
      customerId = customer.id;

      await pool.query("UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2", [
        customerId,
        user.id,
      ]);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: STRIPE_PRICE_ID_MONTHLY, quantity: 1 }],
      success_url: `${APP_URL}/?checkout=success`,
      cancel_url: `${APP_URL}/?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: {
        app_user_id: String(user.id),
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Checkout session error:", err);
    const details = typeof err?.message === "string" ? err.message : "";
    return res.status(500).json({
      error: details || "Failed to create checkout session",
    });
  }
});

app.post("/api/billing/create-portal-session", requireAuth, async (req, res) => {
  if (!requireDatabase(res)) return;
  if (!stripe) {
    return res.status(500).json({ error: "Stripe is not configured on the server" });
  }

  try {
    const user = await getUserById(req.user.sub);
    if (!user) return res.status(401).json({ error: "User not found" });

    if (!user.stripe_customer_id) {
      return res.status(400).json({ error: "No Stripe customer found for this user" });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${APP_URL}/`,
    });

    return res.status(200).json({ url: portal.url });
  } catch (err) {
    console.error("Portal session error:", err);
    return res.status(500).json({ error: "Failed to create portal session" });
  }
});

app.post("/api/tutor", requireAuth, tutorRateLimit, async (req, res) => {
  try {
    const { message, level = "KS3", topic = "Python", mode = "Explain" } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' string" });
    }

    const access = await getTutorAccessContext(req.user.sub, mode, false);
    if (!access.allowed) {
      return res.status(access.status || 403).json({
        error: access.error || "Tutor access denied",
        billing: access.billing,
      });
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
    await persistChatTurn({
      userId: req.user.sub,
      userMessage: message,
      assistantMessage: reply,
      level,
      topic,
      mode,
    });
    return res.json({ reply });
  } catch (e) {
    if (String(e?.message || "").includes("timed out")) {
      return res.status(504).json({ error: e.message });
    }

    console.error("Tutor error:", e);
    return res.status(500).json({ error: "LLM failed", details: String(e) });
  }
});

app.post(
  "/api/tutor/stream",
  requireAuth,
  tutorRateLimit,
  async (req, res) => {
    try {
      const { message, level = "KS3", topic = "Python", mode = "Explain" } = req.body || {};

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Missing 'message' string" });
      }

      const access = await getTutorAccessContext(req.user.sub, mode, true);
      if (!access.allowed) {
        return res.status(access.status || 403).json({
          error: access.error || "Tutor access denied",
          billing: access.billing,
        });
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

      let streamedContent = "";
      for await (const event of stream) {
        if (event?.type === "response.output_text.delta" && typeof event.delta === "string") {
          streamedContent += event.delta;
          res.write(`data: ${JSON.stringify({ delta: event.delta })}\n\n`);
        }
      }

      await persistChatTurn({
        userId: req.user.sub,
        userMessage: message,
        assistantMessage: streamedContent || "(No output_text returned)",
        level,
        topic,
        mode,
      });

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
  }
);

async function ensureSchema() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      stripe_customer_id TEXT UNIQUE,
      subscription_id TEXT,
      subscription_status TEXT NOT NULL DEFAULT 'inactive',
      subscription_current_period_end TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_id TEXT");
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive'"
  );
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ"
  );
  await pool.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
  );
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student'");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      level TEXT,
      topic TEXT,
      mode TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created_at ON chat_messages(user_id, created_at DESC)"
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lessons (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      topic TEXT,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic TEXT,
      score NUMERIC NOT NULL,
      max_score NUMERIC NOT NULL DEFAULT 10,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS code_evaluations (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic TEXT,
      language TEXT,
      score NUMERIC NOT NULL,
      summary TEXT,
      improvements JSONB NOT NULL DEFAULT '[]'::jsonb,
      tips JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS teacher_quizzes (
      id BIGSERIAL PRIMARY KEY,
      teacher_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      topic TEXT,
      level TEXT,
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      teacher_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      topic TEXT,
      description TEXT,
      due_date DATE,
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_lessons_user ON lessons(user_id, created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id, created_at DESC)");
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_code_evaluations_user ON code_evaluations(user_id, created_at DESC)"
  );
  await pool.query("CREATE INDEX IF NOT EXISTS idx_tasks_student ON tasks(student_id, created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_tasks_teacher ON tasks(teacher_id, created_at DESC)");
}

async function start() {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY is not set. /api/tutor will fail until it is configured.");
  }

  if (!process.env.JWT_SECRET) {
    console.warn("JWT_SECRET is not set. Using fallback secret; set a secure JWT_SECRET in production.");
  }

  if (!stripe) {
    console.warn("STRIPE_SECRET_KEY is not set. Billing endpoints will be unavailable.");
  }

  if (!STRIPE_PRICE_ID_MONTHLY) {
    console.warn("STRIPE_PRICE_ID_MONTHLY is not set. Checkout session creation will fail.");
  }

  if (!STRIPE_WEBHOOK_SECRET) {
    console.warn("STRIPE_WEBHOOK_SECRET is not set. Webhook signature verification will fail.");
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
