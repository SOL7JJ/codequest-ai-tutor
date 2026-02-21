import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 3300 + Math.floor(Math.random() * 200);
const baseUrl = `http://127.0.0.1:${port}`;
let child;

function waitForServerReady(proc) {
  return new Promise((resolve, reject) => {
    let stderr = "";

    const timeout = setTimeout(() => {
      reject(new Error(`Server did not start in time. Stderr: ${stderr}`));
    }, 8000);

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.includes("Server running on")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}. Stderr: ${stderr}`));
    });
  });
}

test.before(async () => {
  child = spawn("node", ["index.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      OPENAI_API_KEY: "",
      DATABASE_URL: "",
      REQUEST_TIMEOUT_MS: "1000",
      RATE_LIMIT_MAX: "100",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForServerReady(child);
});

test.after(() => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }
});

test("GET /health returns ok", async () => {
  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
});

test("POST /api/tutor rejects missing message", async () => {
  const response = await fetch(`${baseUrl}/api/tutor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: "KS3", topic: "Python", mode: "Explain" }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /Missing 'message' string/);
});

test("POST /api/tutor returns clear error when OPENAI_API_KEY is missing", async () => {
  const response = await fetch(`${baseUrl}/api/tutor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Explain loops", level: "KS3", topic: "Python", mode: "Explain" }),
  });
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.match(body.error, /OPENAI_API_KEY is not configured/);
});
