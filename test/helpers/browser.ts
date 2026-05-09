// Shared Playwright lifecycle for the E2E suite.
//
// Each test file calls `setupBrowser()` in a beforeAll and `tearDown`
// in afterAll. The helper deliberately does NOT spawn a Vite server;
// `pnpm test:e2e` owns the managed dev-server lifecycle. When tests are
// run directly through Vitest, the caller must provide a reachable
// APP_URL or start `pnpm dev` first.

import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";

export const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
export const FIXTURES = path.join(ROOT, "test", "fixtures");
export const SCREENSHOTS = path.join(ROOT, "test", "e2e", "screenshots");

function normalizeAppUrl(raw: string): string {
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withProtocol);
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  return url.toString();
}

export const FIXTURE = {
  /** Real Maldivian government doc with broken-aabaafili ToUnicode -
   *  the canonical Thaana-extraction + edit/move test bed. */
  maldivian: path.join(FIXTURES, "maldivian.pdf"),
  /** Second real Maldivian government doc - NOT office-generated.
   *  14 pages, mixed Thaana/English content, 3 source images on
   *  pages 0/11/12. Its Faruma `/ToUnicode` maps the sukun CID
   *  (last entry of the fili block) to U+0020 - boundary-shape of
   *  the fili-gap bug that `glyphMap.patchBrokenFiliMappings`
   *  recovers. Tests against this fixture skip assertions that
   *  depend on source-detected bold metadata, since the producer
   *  doesn't reliably emit it. */
  maldivian2: path.join(FIXTURES, "maldivian2.pdf"),
  /** Synthetic A4 page with two known-position PNG images, generated
   *  by test/fixtures/build.mjs. Used for image-move + preview-strip. */
  withImages: path.join(FIXTURES, "with-images.pdf"),
  /** Two-page synthetic fixture: page 1 has a red image + a label,
   *  page 2 has a blue image + its own label. Used for cross-page
   *  move tests so each page has distinct, identifiable content. */
  withImagesMultipage: path.join(FIXTURES, "with-images-multipage.pdf"),
  /** Two-page external-import fixture used by the "first-class
   *  external pages" suite: distinct labels, an editable run on page
   *  1, and a green image on page 2 so save/reload through copyPages
   *  out of an external source can be verified end-to-end. */
  externalSource: path.join(FIXTURES, "external-source.pdf"),
  /** Single-page synthetic PDF with two known vector shapes: a
   *  horizontal rule near y=600pt and a filled rectangle at y=300pt.
   *  Used by the shape-delete test. */
  withShapes: path.join(FIXTURES, "with-shapes.pdf"),
  /** Real Maldivian National University job-application form, fully
   *  fillable AcroForm with 145 top-level fields (mostly text, with
   *  hierarchical subform names like Text1.0.0). The canonical end-
   *  to-end fixture for AcroForm fill round-trips: tests can fill
   *  Latin / Thaana / both, save, reload, and assert /V. */
  mnuJobApplication: path.join(FIXTURES, "mnu-job-application.pdf"),
};

export const APP_URL = normalizeAppUrl(process.env.APP_URL ?? "http://127.0.0.1:5173/");
export const RENDER_SCALE = 1.5;

export type Harness = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Rolling buffer of `[pageerror]` and `console.{error,warn}` lines
   *  captured from the page since `setupBrowser`. `loadFixture`
   *  appends recent entries to its timeout error so flake postmortems
   *  surface app-side errors that would otherwise be invisible. */
  pageLog: string[];
};

export async function setupBrowser(opts?: {
  viewport?: { width: number; height: number };
  /** Enable touch input on the context - required for `page.touchscreen.tap()`
   *  and for the app to detect a touch-capable browser at first paint.
   *  Mobile-layout tests pass `true`; desktop tests omit it (default false). */
  hasTouch?: boolean;
}): Promise<Harness> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: opts?.viewport ?? { width: 1500, height: 1900 },
    hasTouch: opts?.hasTouch,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const pageLog: string[] = [];
  // Cap the buffer so a chatty test doesn't balloon memory across the
  // suite. The most useful entries for flake postmortems are the LAST
  // few before the timeout, so drop from the front.
  const PAGE_LOG_CAP = 200;
  const push = (line: string) => {
    pageLog.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
    if (pageLog.length > PAGE_LOG_CAP) pageLog.shift();
  };
  page.on("pageerror", (e) => {
    const line = `[pageerror] ${e.message}`;
    push(line);
    console.log(line);
  });
  page.on("console", (msg) => {
    const t = msg.type();
    if (t !== "error" && t !== "warning") return;
    push(`[console.${t}] ${msg.text()}`);
  });
  try {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
  } catch (err) {
    await browser.close();
    throw new Error(
      `Couldn't reach the dev server at ${APP_URL} - run \`pnpm test:e2e\` to start a managed server, or start one with \`pnpm dev\` before running Vitest directly. (${(err as Error).message})`,
      { cause: err },
    );
  }
  return { browser, context, page, pageLog };
}

export async function tearDown(h: Harness): Promise<void> {
  await h.browser.close();
}

/** Load a fixture PDF into the file picker and wait for ALL pages to
 *  render. Multi-page docs render iteratively, so a fixed 2.5s sleep
 *  isn't enough - the post-load extraction loop in App.tsx can take
 *  longer for the Maldivian PDF, and tests that scroll to page 2 then
 *  flake out. We poll page count to stability instead.
 *
 *  Pass `expectedPages` when the test is known to need ≥ N pages -
 *  the poll will keep waiting (up to the deadline) until that many
 *  `[data-page-index]` elements are present, even if the count
 *  appears to stabilise at a lower number first. Prevents the
 *  "stable at 1 page while page 2 was still rendering" flake. */
export async function loadFixture(
  pageOrHarness: Page | Harness,
  fixturePath: string,
  options: { expectedPages?: number } = {},
): Promise<void> {
  // Backwards compat: callers can pass either the raw Page (older
  // tests) or the Harness (so timeout messages can include the
  // pageerror / console buffer).
  const page: Page =
    "page" in pageOrHarness && "browser" in pageOrHarness ? pageOrHarness.page : pageOrHarness;
  const pageLog: string[] | null =
    "page" in pageOrHarness && "browser" in pageOrHarness ? pageOrHarness.pageLog : null;
  const { expectedPages } = options;
  // `loadSource` renders each page serially through pdf.js (~1-2s
  // per page on the dev box). A flat 25s budget was enough for 2-page
  // fixtures but flaked on the 14-page maldivian2 under accumulated
  // dev-server pressure (the post-save load lands while the previous
  // doc's worker is still draining). Scale the deadline with the
  // expected page count so multi-page fixtures get proportional time;
  // single/unknown-page fixtures keep the original 25s budget.
  const LOAD_DEADLINE_MS = Math.max(25_000, (expectedPages ?? 1) * 3_000);
  const beforeLoadedKey = await page
    .locator("[data-loaded-file-key]")
    .first()
    .getAttribute("data-loaded-file-key")
    .then((v) => Number(v ?? 0))
    .catch(() => 0);
  const expectedFilename = path.basename(fixturePath);
  await page.locator('input[data-testid="open-pdf-input"]').setInputFiles(fixturePath);
  try {
    await page.waitForFunction(
      ({ beforeLoadedKey, expectedFilename }) => {
        const root = document.querySelector("[data-loaded-file-key]");
        const loadedKey = Number(root?.getAttribute("data-loaded-file-key") ?? 0);
        const loadedFilename = root?.getAttribute("data-loaded-filename") ?? "";
        return loadedKey > beforeLoadedKey && loadedFilename === expectedFilename;
      },
      { beforeLoadedKey, expectedFilename },
      { timeout: LOAD_DEADLINE_MS },
    );
  } catch (err) {
    throw new Error(
      `loadFixture(${fixturePath}): file load did not commit after ${LOAD_DEADLINE_MS}ms.${formatPageLog(pageLog)}`,
      { cause: err },
    );
  }
  try {
    await page.waitForSelector("[data-page-index]", { timeout: LOAD_DEADLINE_MS });
  } catch (err) {
    throw new Error(
      `loadFixture(${fixturePath}): no [data-page-index] appeared after ${LOAD_DEADLINE_MS}ms.${formatPageLog(pageLog)}`,
      { cause: err },
    );
  }
  // Poll the page count: it should grow as renderPage finishes for
  // each page, then plateau. Treat 1.5s of unchanged count as "done"
  // - but never declare done while count < expectedPages.
  const STABLE_MS = 1_500;
  const POLL_MS = 200;
  const DEADLINE = Date.now() + LOAD_DEADLINE_MS;
  let lastCount = -1;
  let stableSince = Date.now();
  while (Date.now() < DEADLINE) {
    // Count the page divs AND the canvases inside them. We only treat
    // a page as "rendered" once its canvas child is committed - the
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
      `loadFixture(${fixturePath}): expected ≥${expectedPages} pages, got ${lastCount} after ${LOAD_DEADLINE_MS}ms.${formatPageLog(pageLog)}`,
    );
  }
  // One more beat for the in-flight font / glyph-map work that runs
  // after the last canvas paints.
  await page.waitForTimeout(500);
}

/** Click the named toolbar button by its visible label. */
export async function clickToolbarButton(page: Page, label: RegExp): Promise<void> {
  await page.locator("button").filter({ hasText: label }).click();
}

export async function pageBox(page: Page, pageIndex: number) {
  const box = await page.locator(`[data-page-index="${pageIndex}"]`).boundingBox();
  if (!box) throw new Error(`page ${pageIndex} not in DOM`);
  return box;
}

/** Save via the toolbar and return the downloaded file path under
 *  test/e2e/screenshots. */
export async function saveAndDownload(
  page: Page,
  name: string,
  options: { timeout?: number } = {},
): Promise<string> {
  const dlPromise = page.waitForEvent("download", { timeout: options.timeout ?? 12_000 });
  await page.locator("button").filter({ hasText: /^Save/ }).click();
  const dl = await dlPromise;
  const out = path.join(SCREENSHOTS, name);
  await dl.saveAs(out);
  return out;
}

/** Per-page text content via the app's pdf.js wrapper. */
export async function extractTextByPage(page: Page, pdfPath: string): Promise<string[]> {
  const b64 = fs.readFileSync(pdfPath).toString("base64");
  return page.evaluate(async (b64) => {
    // oxlint-disable-next-line typescript/no-implied-eval
    const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
    const pdfMod = (await importer(
      "/src/pdf/render/pdf.ts",
    )) as typeof import("../../src/pdf/render/pdf");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await pdfMod.loadPdf(bytes.buffer);
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const content = await p.getTextContent();
      out.push(
        content.items
          .filter((it) => "str" in it)
          .map((it) => (it as { str: string }).str)
          .join(" "),
      );
    }
    return out;
  }, b64);
}

export async function extractImageCountsByPage(page: Page, pdfPath: string): Promise<number[]> {
  const b64 = fs.readFileSync(pdfPath).toString("base64");
  return page.evaluate(async (b64) => {
    // oxlint-disable-next-line typescript/no-implied-eval
    const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
    const mod = (await importer(
      "/src/pdf/source/sourceImages.ts",
    )) as typeof import("../../src/pdf/source/sourceImages");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const all = await mod.extractPageImages(bytes.buffer);
    return all.map((p) => p.length);
  }, b64);
}

export async function captureImages(page: Page, pdfPath: string) {
  const b64 = fs.readFileSync(pdfPath).toString("base64");
  return page.evaluate(async (b64) => {
    // oxlint-disable-next-line typescript/no-implied-eval
    const importer = new Function("p", "return import(p)") as (
      p: string,
    ) => Promise<typeof import("../../src/pdf/source/sourceImages")>;
    const mod = await importer("/src/pdf/source/sourceImages.ts");
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const all = await mod.extractPageImages(buf);
    return all.map((perPage) =>
      perPage.map((i) => ({
        id: i.id,
        resourceName: i.resourceName,
        pdfX: i.pdfX,
        pdfY: i.pdfY,
        w: i.pdfWidth,
        h: i.pdfHeight,
      })),
    );
  }, b64);
}

export async function captureImageCount(page: Page, pdfPath: string): Promise<number> {
  const counts = await extractImageCountsByPage(page, pdfPath);
  return counts.reduce((sum, n) => sum + n, 0);
}

/** Format the captured pageerror / console buffer for inclusion in a
 *  timeout error. Returns "" when the buffer is null (caller passed
 *  a raw `Page` instead of a `Harness`) or empty. */
function formatPageLog(pageLog: string[] | null): string {
  if (!pageLog || pageLog.length === 0) return "";
  // Tail the buffer - earlier entries are usually setup noise.
  const tail = pageLog.slice(-20);
  return `\n  --- recent page log (${pageLog.length} total, last ${tail.length}) ---\n  ${tail.join("\n  ")}`;
}

/** Dynamically import a Vite-served module from inside `page.evaluate`,
 *  bypassing vitest's SSR `__vite_ssr_dynamic_import__` rewrite. The
 *  rewrite breaks raw `await import("/src/...")` calls because the
 *  helper isn't defined in the browser's runtime - wrapping with
 *  `new Function(...)` defers parsing to the browser.
 *
 *  Usage:
 *    await page.evaluate(async (path) => {
 *      const mod = await __dynImport(path);
 *      return mod.something;
 *    }, "/src/pdf/source/sourceImages.ts");
 *
 *  Inject this exact call inside page.evaluate by also injecting the
 *  helper as a string. Easier: callers use `dynImport(page, modulePath)`
 *  to hop through one extra round-trip when they only need a single
 *  exported value, OR inline the `new Function` themselves.
 */
export async function dynImport<T = unknown>(page: Page, modulePath: string): Promise<T> {
  return page.evaluate(async (p) => {
    // The Function() bypass is intentional: vitest's SSR transform
    // rewrites raw `import(p)` to a helper that doesn't exist in the
    // page browser's runtime, so wrap to defer parsing.
    // oxlint-disable-next-line typescript/no-implied-eval
    const importer = new Function("path", "return import(path)") as (p: string) => Promise<unknown>;
    return await importer(p);
  }, modulePath) as Promise<T>;
}
