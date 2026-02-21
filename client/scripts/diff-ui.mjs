import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

function getArg(flag, fallback = undefined) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function parsePng(buffer) {
  return PNG.sync.read(buffer);
}

function toPngBuffer(png) {
  return PNG.sync.write(png);
}

async function readPng(filePath) {
  const input = await fs.readFile(filePath);
  return parsePng(input);
}

async function writeHtmlReport({ outputDir, before, after, comparisons }) {
  const rows = comparisons
    .map((item) => {
      return `\n      <tr>\n        <td>${item.file}</td>\n        <td><img src="../${before}/${item.file}" alt="before ${item.file}" /></td>\n        <td><img src="../${after}/${item.file}" alt="after ${item.file}" /></td>\n        <td><img src="./${item.file}" alt="diff ${item.file}" /></td>\n        <td>${item.diffPixels}</td>\n      </tr>`;
    })
    .join("\n");

  const html = `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>UI Diff Report</title>\n  <style>\n    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; background: #f7f7f8; color: #111; }\n    table { width: 100%; border-collapse: collapse; background: #fff; }\n    th, td { border: 1px solid #ddd; padding: 8px; vertical-align: top; }\n    th { background: #f0f2f4; text-align: left; }\n    img { width: 280px; border: 1px solid #ddd; border-radius: 6px; }\n    code { background: #f0f2f4; padding: 2px 5px; border-radius: 4px; }\n  </style>\n</head>\n<body>\n  <h1>UI Diff Report</h1>\n  <p>Before: <code>${before}</code> | After: <code>${after}</code></p>\n  <table>\n    <thead>\n      <tr>\n        <th>File</th>\n        <th>Before</th>\n        <th>After</th>\n        <th>Diff</th>\n        <th>Changed Pixels</th>\n      </tr>\n    </thead>\n    <tbody>\n      ${rows}\n    </tbody>\n  </table>\n</body>\n</html>`;

  await fs.writeFile(path.join(outputDir, "index.html"), html, "utf8");
}

async function main() {
  const root = path.resolve(process.cwd(), getArg("--root", "visual-regression"));
  const before = getArg("--before", "before");
  const after = getArg("--after", "after");
  const threshold = Number(getArg("--threshold", "0.1"));

  const beforeDir = path.join(root, before);
  const afterDir = path.join(root, after);
  const diffDir = path.join(root, `diff-${before}-vs-${after}`);

  await ensureDir(diffDir);

  const beforeEntries = (await fs.readdir(beforeDir)).filter((f) => f.endsWith(".png")).sort();
  const afterSet = new Set((await fs.readdir(afterDir)).filter((f) => f.endsWith(".png")));

  const common = beforeEntries.filter((f) => afterSet.has(f));
  if (!common.length) {
    throw new Error("No shared PNG files found between before/after directories.");
  }

  const comparisons = [];

  for (const file of common) {
    const beforeImage = await readPng(path.join(beforeDir, file));
    const afterImage = await readPng(path.join(afterDir, file));

    if (beforeImage.width !== afterImage.width || beforeImage.height !== afterImage.height) {
      throw new Error(`Image size mismatch for ${file}.`);
    }

    const diffImage = new PNG({ width: beforeImage.width, height: beforeImage.height });

    const diffPixels = pixelmatch(
      beforeImage.data,
      afterImage.data,
      diffImage.data,
      beforeImage.width,
      beforeImage.height,
      { threshold }
    );

    await fs.writeFile(path.join(diffDir, file), toPngBuffer(diffImage));

    comparisons.push({ file, diffPixels });
  }

  await writeHtmlReport({ outputDir: diffDir, before, after, comparisons });
  console.log(`UI diff complete: ${diffDir}`);
}

main().catch((err) => {
  console.error("UI diff failed:", err);
  process.exit(1);
});
