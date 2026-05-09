import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 5173;

function parseAppUrl(value: string | undefined): URL | null {
  if (!value) return null;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  return new URL(withProtocol);
}

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT;
}

const appUrl = parseAppUrl(process.env.APP_URL);
const appHost = process.env.HOST ?? appUrl?.hostname ?? "127.0.0.1";
const appPort = parsePort(process.env.PORT ?? process.env.VITE_PORT ?? appUrl?.port);

function stripHarfbuzzNodeFsBranch(): Plugin {
  const fsRequirePattern = /\bvar fs=require\("fs"\);/g;

  return {
    name: "strip-harfbuzz-node-fs-branch",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.endsWith("/harfbuzzjs/hb.js")) return null;
      const matches = code.match(fsRequirePattern);
      if (matches?.length !== 1) {
        throw new Error(
          `Expected exactly one Node fs require in harfbuzzjs/hb.js, found ${matches?.length ?? 0}.`,
        );
      }
      return {
        code: code.replace(
          fsRequirePattern,
          'var fs={readFileSync(){throw new Error("fs is unavailable in browser")}};',
        ),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [stripHarfbuzzNodeFsBranch(), react(), tailwindcss()],
  server: {
    host: appHost,
    port: appPort,
    strictPort: true,
  },
  preview: {
    host: appHost,
    port: appPort,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 1400,
  },
});
