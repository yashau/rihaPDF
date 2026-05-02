// Download a swath of gazette.gov.mv PDFs and run probeMaldivian2Fonts.mjs
// against each. Only print PDFs that have at least one TODO-relevant font
// (no /ToUnicode AND (named-glyph Differences OR stripped cmap OR post v2.0)).
//
// Run:  node scripts/sweepGazette.mjs <start> <end> [step]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import https from "node:https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const cacheDir = "/tmp/gazette";
fs.mkdirSync(cacheDir, { recursive: true });

const start = Number(process.argv[2] ?? 1);
const end = Number(process.argv[3] ?? 100);
const step = Number(process.argv[4] ?? 1);

function fetchPdf(id) {
  return new Promise((resolve) => {
    const out = path.join(cacheDir, `g${id}.pdf`);
    if (fs.existsSync(out) && fs.statSync(out).size > 1024) return resolve(out);
    const url = `https://storage.googleapis.com/gazette.gov.mv/docs/gazette/${id}.pdf`;
    const fileStream = fs.createWriteStream(out);
    const req = https.get(url, { timeout: 30_000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        fileStream.close();
        try {
          fs.unlinkSync(out);
        } catch {}
        return resolve(null);
      }
      res.pipe(fileStream);
      fileStream.on("finish", () => fileStream.close(() => resolve(out)));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

const matches = [];
for (let id = start; id <= end; id += step) {
  const f = await fetchPdf(id);
  if (!f) {
    process.stdout.write(`g${id}:miss `);
    continue;
  }
  const r = spawnSync("node", [path.join(root, "scripts/probeMaldivian2Fonts.mjs"), f], {
    encoding: "utf8",
  });
  const out = r.stdout || "";
  const m = out.match(/TODO-relevant.*?: (\d+)/);
  const count = m ? Number(m[1]) : 0;
  if (count > 0) {
    matches.push({ id, count, out });
    process.stdout.write(`\nMATCH g${id}: ${count}\n`);
  } else {
    process.stdout.write(`g${id}:0 `);
  }
}

console.log("\n\n=== Summary ===");
console.log(`Scanned ${Math.floor((end - start) / step) + 1} ids; ${matches.length} match.`);
for (const m of matches) {
  console.log("\n" + m.out);
}
