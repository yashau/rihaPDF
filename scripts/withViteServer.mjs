/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return, typescript/prefer-promise-reject-errors */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const DEFAULT_APP_URL = "http://127.0.0.1:5173/";
const STARTUP_TIMEOUT_MS = Number(process.env.VITE_STARTUP_TIMEOUT_MS ?? 60_000);
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();

function normalizeAppUrl(raw) {
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withProtocol);
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url;
}

function packageBinPath(name) {
  const packagePath = path.join(root, "node_modules", name, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[name];
  if (!bin) throw new Error(`No ${name} binary found in ${packagePath}`);
  return path.join(path.dirname(packagePath), bin);
}

function spawnBin(name, binArgs, options = {}) {
  return spawn(process.execPath, [packageBinPath(name), ...binArgs], {
    cwd: root,
    shell: false,
    windowsHide: true,
    ...options,
  });
}

function waitForUrl(url, child) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const check = () => {
      if (settled) return;
      if (Date.now() - started > STARTUP_TIMEOUT_MS) {
        fail(new Error(`Timed out waiting ${STARTUP_TIMEOUT_MS}ms for ${url.toString()}`));
        return;
      }

      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          setTimeout(() => {
            if (child.exitCode == null && !child.killed) {
              settled = true;
              resolve();
              return;
            }
            fail(
              new Error(`Vite exited while ${url.toString()} was reachable; is the port in use?`),
            );
          }, 250);
          return;
        }
        setTimeout(check, 500);
      });
      req.on("error", () => setTimeout(check, 500));
      req.setTimeout(2_000, () => {
        req.destroy();
        setTimeout(check, 500);
      });
    };
    child.once("exit", (code, signal) => {
      fail(
        new Error(
          `Vite exited before ${url.toString()} was reachable (code ${code}, signal ${signal})`,
        ),
      );
    });
    check();
  });
}

async function main() {
  const appUrl = normalizeAppUrl(process.env.APP_URL ?? DEFAULT_APP_URL);
  if (appUrl.protocol !== "http:") {
    throw new Error(`Managed E2E server requires an http APP_URL, received ${appUrl.toString()}`);
  }
  const env = {
    ...process.env,
    APP_URL: appUrl.toString(),
    HOST: appUrl.hostname,
    PORT: appUrl.port || (appUrl.protocol === "https:" ? "443" : "80"),
    VITEST_SUITE: "e2e",
  };
  const viteLogPath = path.join(root, process.env.VITE_LOG ?? "vite.log");
  const viteLog = fs.createWriteStream(viteLogPath, { flags: "w" });
  const vite = spawnBin("vite", ["--host", env.HOST, "--port", env.PORT, "--strictPort"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  vite.stdout.pipe(viteLog);
  vite.stderr.pipe(viteLog);
  vite.stdout.pipe(process.stdout);
  vite.stderr.pipe(process.stderr);

  const cleanup = () => {
    if (!vite.killed) vite.kill();
    viteLog.end();
  };
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  try {
    await waitForUrl(appUrl, vite);
    const vitest = spawnBin("vitest", ["run", ...args], {
      env,
      stdio: "inherit",
    });
    const exitCode = await new Promise((resolve) => {
      vitest.once("exit", (code, signal) => {
        if (signal) resolve(1);
        else resolve(code ?? 1);
      });
    });
    cleanup();
    process.exit(exitCode);
  } catch (error) {
    cleanup();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

await main();
