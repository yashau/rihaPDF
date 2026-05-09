import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const testSuite = process.env.VITEST_SUITE;
const include =
  testSuite === "e2e"
    ? ["test/e2e/**/*.test.{mjs,ts}"]
    : testSuite === "unit"
      ? ["test/unit/**/*.test.ts"]
      : ["test/e2e/**/*.test.{mjs,ts}", "test/unit/**/*.test.ts"];

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
    include,
    testTimeout: 240_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
