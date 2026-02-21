#!/usr/bin/env node
import process from "node:process";

const API_BASE = process.env.API_BASE || "http://127.0.0.1:3000";
const email = process.env.TEST_EMAIL || `limit-test-${Date.now()}@example.com`;
const password = process.env.TEST_PASSWORD || "password123";

async function run() {
  const registerRes = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, role: "student" }),
  });
  const registerBody = await registerRes.json();

  if (!registerRes.ok || !registerBody?.token) {
    throw new Error(`Failed to register user: ${JSON.stringify(registerBody)}`);
  }

  const token = registerBody.token;
  console.log(`Registered test student: ${email}`);

  for (let i = 1; i <= 6; i += 1) {
    const res = await fetch(`${API_BASE}/api/tutor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message: `Request ${i}: Explain a simple Python loop.`,
        level: "KS3",
        topic: "Python",
        mode: "Explain",
      }),
    });

    const body = await res.json().catch(() => ({}));
    console.log(`Request ${i}: status ${res.status}`, body?.code ? `code=${body.code}` : "");

    if (i <= 5 && res.status !== 200) {
      throw new Error(`Expected 200 for request ${i}, got ${res.status}`);
    }
    if (i === 6 && !(res.status === 402 && body?.code === "LIMIT_REACHED")) {
      throw new Error(`Expected 6th request to return 402 LIMIT_REACHED, got ${res.status} ${JSON.stringify(body)}`);
    }
  }

  console.log("PASS: daily free-user usage limit enforced at 5 requests/day.");
}

run().catch((err) => {
  console.error("Manual usage-limit test failed:", err.message);
  process.exit(1);
});
