// Shared Playwright lifecycle for the E2E suite.
//
// Each test file calls `setupBrowser()` in a beforeAll and `tearDown`
// in afterAll. The helper deliberately does NOT spawn a Vite server —
// the suite assumes `pnpm dev` is already running on localhost:5173
// (same as the old verify*.mjs scripts). We document that in
// test/e2e/README.md and fail loudly with a clear message when the
// dev server isn't reachable.

import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

export const ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
);
export const FIXTURES = path.join(ROOT, "test", "fixtures");
export const SCREENSHOTS = path.join(ROOT, "test", "e2e", "screenshots");

export const FIXTURE = {
  /** Real Maldivian government doc with broken-aabaafili ToUnicode —
   *  the canonical Thaana-extraction + edit/move test bed. */
  maldivian: path.join(FIXTURES, "maldivian.pdf"),
  /** Synthetic A4 page with two known-position PNG images, generated
   *  by test/fixtures/build.mjs. Used for image-move + preview-strip. */
  withImages: path.join(FIXTURES, "with-images.pdf"),
};

export const APP_URL = "http://localhost:5173/";
export const RENDER_SCALE = 1.5;

export type Harness = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

export async function setupBrowser(opts?: {
  viewport?: { width: number; height: number };
}): Promise<Harness> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: opts?.viewport ?? { width: 1500, height: 1900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  try {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
  } catch (err) {
    await browser.close();
    throw new Error(
      `Couldn't reach the dev server at ${APP_URL} — start it with \`pnpm dev\` before running the E2E suite. (${(err as Error).message})`,
    );
  }
  return { browser, context, page };
}

export async function tearDown(h: Harness): Promise<void> {
  await h.browser.close();
}

/** Load a fixture PDF into the file picker and wait for ALL pages to
 *  render. Multi-page docs render iteratively, so a fixed 2.5s sleep
 *  isn't enough — the post-load extraction loop in App.tsx can take
 *  longer for the Maldivian PDF, and tests that scroll to page 2 then
 *  flake out. We poll page count to stability instead.
 *
 *  Pass `expectedPages` when the test is known to need ≥ N pages —
 *  the poll will keep waiting (up to the deadline) until that many
 *  `[data-page-index]` elements are present, even if the count
 *  appears to stabilise at a lower number first. Prevents the
 *  "stable at 1 page while page 2 was still rendering" flake. */
export async function loadFixture(
  page: Page,
  fixturePath: string,
  options: { expectedPages?: number } = {},
): Promise<void> {
  const { expectedPages } = options;
  await page
    .locator('input[type="file"][accept="application/pdf"]')
    .setInputFiles(fixturePath);
  await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
  // Poll the page count: it should grow as renderPage finishes for
  // each page, then plateau. Treat 1.5s of unchanged count as "done"
  // — but never declare done while count < expectedPages.
  const STABLE_MS = 1_500;
  const POLL_MS = 200;
  const DEADLINE = Date.now() + 25_000;
  let lastCount = -1;
  let stableSince = Date.now();
  while (Date.now() < DEADLINE) {
    // Count the page divs AND the canvases inside them. We only treat
    // a page as "rendered" once its canvas child is committed — the
    // [data-page-index] div appears in the React tree as soon as
    // `setPages` commits, but the canvas is mounted by an effect a
    // microtask later. Without the canvas check, image / run overlays
    // might not be in the DOM yet either.
    const counts = await page.evaluate(() => {
      const pages = document.querySelectorAll("[data-page-index]");
      let withCanvas = 0;
      for (const p of pages) {
        if (p.querySelector("canvas")) withCanvas++;
      }
      return { total: pages.length, ready: withCanvas };
    });
    const count = counts.ready;
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    } else if (
      count > 0 &&
      count === counts.total &&
      (expectedPages == null || count >= expectedPages) &&
      Date.now() - stableSince >= STABLE_MS
    ) {
      break;
    }
    await page.waitForTimeout(POLL_MS);
  }
  if (expectedPages != null && lastCount < expectedPages) {
    throw new Error(
      `loadFixture(${fixturePath}): expected ≥${expectedPages} pages, got ${lastCount} after 25s`,
    );
  }
  // One more beat for the in-flight font / glyph-map work that runs
  // after the last canvas paints.
  await page.waitForTimeout(500);
}

/** Click the named toolbar button by its visible label. */
export async function clickToolbarButton(
  page: Page,
  label: RegExp,
): Promise<void> {
  await page.locator("button").filter({ hasText: label }).click();
}

/** Dynamically import a Vite-served module from inside `page.evaluate`,
 *  bypassing vitest's SSR `__vite_ssr_dynamic_import__` rewrite. The
 *  rewrite breaks raw `await import("/src/...")` calls because the
 *  helper isn't defined in the browser's runtime — wrapping with
 *  `new Function(...)` defers parsing to the browser.
 *
 *  Usage:
 *    await page.evaluate(async (path) => {
 *      const mod = await __dynImport(path);
 *      return mod.something;
 *    }, "/src/lib/sourceImages.ts");
 *
 *  Inject this exact call inside page.evaluate by also injecting the
 *  helper as a string. Easier: callers use `dynImport(page, modulePath)`
 *  to hop through one extra round-trip when they only need a single
 *  exported value, OR inline the `new Function` themselves.
 */
export async function dynImport<T = unknown>(
  page: Page,
  modulePath: string,
): Promise<T> {
  return page.evaluate(async (p) => {
    const importer = new Function("path", "return import(path)");
    return await importer(p);
  }, modulePath) as Promise<T>;
}
