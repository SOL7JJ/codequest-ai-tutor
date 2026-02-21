import fs from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "playwright";

function getArg(flag, fallback = undefined) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function captureScenario(browser, {
  name,
  outputDir,
  url,
  viewport,
  device,
  samplePrompt,
  waitMs,
}) {
  const context = await browser.newContext(
    device
      ? { ...device }
      : {
          viewport,
        }
  );

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(waitMs);

    const homePath = path.join(outputDir, `${name}-home.png`);
    await page.screenshot({ path: homePath, fullPage: false });

    const input = page.locator('input[placeholder="Ask a CS question…"]');
    if (await input.count()) {
      await input.first().fill(samplePrompt);
      await page.waitForTimeout(150);
      const composerPath = path.join(outputDir, `${name}-composer.png`);
      await page.screenshot({ path: composerPath, fullPage: false });
    }
  } finally {
    await context.close();
  }
}

async function writeIndex({ outputDir, label, url }) {
  const entries = await fs.readdir(outputDir);
  const pngs = entries.filter((f) => f.endsWith(".png")).sort();

  const cards = pngs
    .map((file) => {
      return `\n      <article class="card">\n        <h3>${file}</h3>\n        <img src="./${file}" alt="${file}" />\n      </article>`;
    })
    .join("\n");

  const html = `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>UI Capture - ${label}</title>\n  <style>\n    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; background: #f7f7f8; color: #111; }\n    h1 { margin-bottom: 8px; }\n    .meta { margin-bottom: 20px; color: #444; }\n    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }\n    .card { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 10px; }\n    .card h3 { margin: 0 0 8px; font-size: 14px; }\n    .card img { width: 100%; border: 1px solid #ddd; border-radius: 8px; }\n  </style>\n</head>\n<body>\n  <h1>UI Capture: ${label}</h1>\n  <p class="meta">URL: ${url}</p>\n  <div class="grid">${cards}</div>\n</body>\n</html>`;

  await fs.writeFile(path.join(outputDir, "index.html"), html, "utf8");
}

async function main() {
  const label = getArg("--label", getTimestamp());
  const url = getArg("--url", "http://127.0.0.1:5173");
  const waitMs = Number(getArg("--wait-ms", "600"));
  const samplePrompt = getArg("--prompt", "Explain a Python loop with a simple example.");
  const outputRoot = getArg("--out", "visual-regression");

  const outputDir = path.resolve(process.cwd(), outputRoot, label);
  await fs.rm(outputDir, { recursive: true, force: true });
  await ensureDir(outputDir);

  const browser = await chromium.launch({ headless: true });

  try {
    await captureScenario(browser, {
      name: "desktop",
      outputDir,
      url,
      viewport: { width: 1440, height: 900 },
      samplePrompt,
      waitMs,
    });

    await captureScenario(browser, {
      name: "mobile",
      outputDir,
      url,
      device: devices["iPhone 13"],
      samplePrompt,
      waitMs,
    });

    await writeIndex({ outputDir, label, url });
    console.log(`UI capture complete: ${outputDir}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("UI capture failed:", err);
  process.exit(1);
});
