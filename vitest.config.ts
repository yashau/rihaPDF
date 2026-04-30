import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // E2E tests drive the running dev server through Playwright. They
    // can't share a process (each test launches its own browser
    // context, and they all hit the same port), and they each take
    // ~5-30s, so we cap concurrency at 1 and lift the timeout.
    include: ["test/e2e/**/*.test.{mjs,ts}"],
    testTimeout: 240_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
