import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // E2E tests drive the running dev server through Playwright. They
    // can't share a process (each test launches its own browser
    // context, and they all hit the same port), and they each take
    // ~5-30s, so we cap concurrency at 1 and lift the timeout. Unit
    // tests are included here too so focused PDF/domain regressions
    // run with the same command.
    include: ["test/e2e/**/*.test.{mjs,ts}", "test/unit/**/*.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
