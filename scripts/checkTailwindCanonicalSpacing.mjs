import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const fix = process.argv.includes("--fix");

const scanRoots = ["src", "test", "index.html"];
const ignoredDirs = new Set([".git", ".tmp", ".wrangler", "dist", "node_modules", "test-logs"]);
const extensions = new Set([".css", ".html", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

const utilityPattern =
  "(?:h|w|size|min-h|min-w|max-h|max-w|m|mx|my|mt|mr|mb|ml|p|px|py|pt|pr|pb|pl|gap|gap-x|gap-y|inset|inset-x|inset-y|top|right|bottom|left|space-x|space-y|translate-x|translate-y|scroll-m|scroll-mx|scroll-my|scroll-mt|scroll-mr|scroll-mb|scroll-ml|scroll-p|scroll-px|scroll-py|scroll-pt|scroll-pr|scroll-pb|scroll-pl)";

const classTokenPattern = new RegExp(
  `(^|\\s)((?:[\\w-]+:)*-?${utilityPattern})-\\[(-?\\d+)px\\](?=$|\\s)`,
  "g",
);

function collectFiles(path) {
  const fullPath = join(root, path);
  const stat = statSync(fullPath);
  if (stat.isFile()) return shouldScan(path) ? [fullPath] : [];
  if (!stat.isDirectory()) return [];
  return readdirSync(fullPath).flatMap((name) => {
    if (ignoredDirs.has(name)) return [];
    return collectFiles(join(path, name));
  });
}

function shouldScan(path) {
  for (const extension of extensions) {
    if (path.endsWith(extension)) return true;
  }
  return false;
}

function lineColumnAt(source, index) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function canonicalSpacing(valuePx) {
  if (valuePx % 4 !== 0) return null;
  return String(valuePx / 4);
}

const files = scanRoots.flatMap(collectFiles);
const findings = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const next = source.replace(classTokenPattern, (match, leading, utility, value, offset) => {
    const replacementValue = canonicalSpacing(Number(value));
    if (replacementValue === null) return match;

    const replacement = `${utility}-${replacementValue}`;
    const location = lineColumnAt(source, offset + leading.length);
    findings.push({
      file,
      line: location.line,
      column: location.column,
      current: `${utility}-[${value}px]`,
      replacement,
    });
    return `${leading}${replacement}`;
  });

  if (fix && next !== source) writeFileSync(file, next);
}

if (findings.length === 0) {
  console.log("Tailwind canonical spacing check passed.");
  process.exit(0);
}

for (const finding of findings) {
  const path = relative(root, finding.file).replaceAll("\\", "/");
  console.error(
    `${path}:${finding.line}:${finding.column} ${finding.current} can be written as ${finding.replacement}`,
  );
}

if (fix) {
  console.error(
    `Fixed ${findings.length} Tailwind spacing class${findings.length === 1 ? "" : "es"}.`,
  );
  process.exit(0);
}

console.error(
  `Found ${findings.length} Tailwind spacing class${findings.length === 1 ? "" : "es"} that should use scale utilities. Run pnpm tailwind:canonical:fix to rewrite them.`,
);
process.exit(1);
