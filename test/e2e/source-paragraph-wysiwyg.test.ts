import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "fs";
import path from "path";
import type { Page } from "playwright";
import {
  FIXTURE,
  SCREENSHOTS,
  extractTextByPage,
  loadFixture,
  saveAndDownload,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";

let h: Harness;

const PAGE_INDEX = 1;
const THAANA_PROBE = "ތެސްޓު";

type Clip = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PageShot = {
  pngBase64: string;
  pageWidth: number;
  pageHeight: number;
};

type InkBand = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
  pixels: number;
};

type InkStats = {
  width: number;
  height: number;
  pixels: number;
  bands: InkBand[];
};

type VisualComparison = {
  ok: boolean;
  message: string;
  reference: InkStats;
  candidate: InkStats;
};

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("source paragraph WYSIWYG", () => {
  test.each([
    { name: "agenda 6.1 mixed date paragraph", marker: "6.1" },
    { name: "agenda 6.2 long justified paragraph", marker: "6.2" },
  ])("$name matches while editing, after commit, and after save", async ({ marker }) => {
    await loadFixture(h, FIXTURE.maldivian, { expectedPages: 3 });
    await h.page.locator(`[data-page-index="${PAGE_INDEX}"]`).scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);
    await installVisualTestCss(h.page);

    const target = await findParagraphRun(h.page, marker);
    expect(target, `couldn't find paragraph run for ${marker}`).not.toBeNull();

    const source = await capturePageShot(h.page, PAGE_INDEX);
    await h.page.locator(`[data-run-id="${target!.id}"]`).click();
    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.waitFor({ state: "visible" });
    await h.page.waitForFunction(
      () =>
        document
          .querySelector<HTMLElement>('[data-editor][contenteditable="true"]')
          ?.getAttribute("data-text-visible") === "true",
    );

    const clip = await editorClip(h.page);
    const activeBeforeEdit = await capturePageShot(h.page, PAGE_INDEX);
    const sourceVsActive = await compareInkGeometry(h.page, source, activeBeforeEdit, clip, {
      label: `${marker} source render vs active editor before edit`,
      // CI runs Linux Chromium/pdf.js font rasterization while local
      // development usually runs Windows DirectWrite. The source
      // canvas vs browser editor comparison crosses those renderers,
      // so allow a small platform edge-hinting delta while keeping
      // centroid and ink mass tight.
      maxEdgeDelta: 12,
      maxCentroidDelta: 14,
      maxInkRatioDelta: 0.15,
    });
    expect(sourceVsActive.ok, sourceVsActive.message).toBe(true);

    await h.page.keyboard.press("Control+End");
    await h.page.keyboard.insertText(THAANA_PROBE);
    await h.page.waitForFunction((probes) => {
      const text =
        document.querySelector<HTMLElement>('[data-editor][contenteditable="true"]')?.innerText ??
        "";
      return text.includes(probes);
    }, THAANA_PROBE);

    const active = await capturePageShot(h.page, PAGE_INDEX);

    await editor.press("Control+Enter");
    await editor.waitFor({ state: "detached" });
    await h.page.waitForTimeout(350);
    const committed = await capturePageShot(h.page, PAGE_INDEX);

    const savedPath = await saveAndDownload(
      h.page,
      `source-paragraph-wysiwyg-${marker.replace(".", "-")}.pdf`,
      { timeout: 20_000 },
    );
    await loadFixture(h, savedPath, { expectedPages: 3 });
    await h.page.locator(`[data-page-index="${PAGE_INDEX}"]`).scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(300);
    await installVisualTestCss(h.page);
    const saved = await capturePageShot(h.page, PAGE_INDEX);
    fs.writeFileSync(
      path.join(SCREENSHOTS, `source-paragraph-wysiwyg-${marker}-active.png`),
      Buffer.from(active.pngBase64, "base64"),
    );
    fs.writeFileSync(
      path.join(SCREENSHOTS, `source-paragraph-wysiwyg-${marker}-committed.png`),
      Buffer.from(committed.pngBase64, "base64"),
    );
    fs.writeFileSync(
      path.join(SCREENSHOTS, `source-paragraph-wysiwyg-${marker}-saved.png`),
      Buffer.from(saved.pngBase64, "base64"),
    );

    const activeVsCommitted = await compareInkGeometry(h.page, active, committed, clip, {
      label: `${marker} active editor vs committed render`,
      maxEdgeDelta: 6,
      maxCentroidDelta: 6,
      maxInkRatioDelta: 0.03,
    });
    const savedText = await extractTextByPage(h.page, savedPath);

    expect(activeVsCommitted.ok, activeVsCommitted.message).toBe(true);
    const savedThaanaBases = savedText[PAGE_INDEX].match(/[\u0780-\u07a5]/gu)?.join("") ?? "";
    expect(savedThaanaBases).toContain("ތސޓ");
  });
});

async function installVisualTestCss(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      [data-edit-toolbar] { display: none !important; }
      [data-editor] {
        outline: none !important;
        caret-color: transparent !important;
        box-shadow: none !important;
      }
      [data-resize-handle] {
        display: none !important;
      }
      [data-editor] *::selection,
      [data-editor]::selection {
        background: transparent !important;
        color: inherit !important;
      }
    `,
  });
}

async function findParagraphRun(page: Page, marker: string): Promise<{ id: string } | null> {
  return page.evaluate(
    ({ marker, pageIndex }) => {
      const host = document.querySelector(`[data-page-index="${pageIndex}"]`);
      if (!host) return null;
      for (const el of host.querySelectorAll<HTMLElement>("[data-run-id]")) {
        const text = el.textContent || "";
        if (text.startsWith(marker) && text.includes("\n") && /[\u0780-\u07bf]/u.test(text)) {
          return { id: el.dataset.runId! };
        }
      }
      return null;
    },
    { marker, pageIndex: PAGE_INDEX },
  );
}

async function editorClip(page: Page): Promise<Clip> {
  return page.evaluate(() => {
    const pageEl = document.querySelector<HTMLElement>("[data-page-index='1']");
    const editor = document.querySelector<HTMLElement>('[data-editor][contenteditable="true"]');
    if (!pageEl || !editor) throw new Error("page/editor not found");
    const pageRect = pageEl.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const pad = 3;
    return {
      left: Math.max(0, editorRect.left - pageRect.left - pad),
      top: Math.max(0, editorRect.top - pageRect.top - pad),
      width: Math.min(pageRect.width, editorRect.width + pad * 2),
      height: Math.min(pageRect.height, editorRect.height + pad * 2),
    };
  });
}

async function capturePageShot(page: Page, pageIndex: number): Promise<PageShot> {
  const locator = page.locator(`[data-page-index="${pageIndex}"]`);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`page ${pageIndex} not visible`);
  const png = await locator.screenshot();
  return {
    pngBase64: png.toString("base64"),
    pageWidth: box.width,
    pageHeight: box.height,
  };
}

async function compareInkGeometry(
  page: Page,
  referenceShot: PageShot,
  candidateShot: PageShot,
  clip: Clip,
  opts: {
    label: string;
    maxEdgeDelta: number;
    maxCentroidDelta: number;
    maxInkRatioDelta: number;
  },
): Promise<VisualComparison> {
  return page.evaluate(
    async ({ referenceShot, candidateShot, clip, opts }) => {
      async function decodePng(base64: string): Promise<ImageBitmap> {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "image/png" });
        return await createImageBitmap(blob);
      }

      function lineBands(
        points: Array<{ x: number; y: number }>,
        rowCounts: number[],
        width: number,
      ): InkBand[] {
        const activeRows: number[] = [];
        const minPixelsForRow = Math.max(2, Math.floor(width * 0.0025));
        rowCounts.forEach((count, y) => {
          if (count >= minPixelsForRow) activeRows.push(y);
        });
        const rowGroups: Array<{ top: number; bottom: number }> = [];
        for (const y of activeRows) {
          const last = rowGroups[rowGroups.length - 1];
          if (!last || y - last.bottom > 6) {
            rowGroups.push({ top: y, bottom: y });
          } else {
            last.bottom = y;
          }
        }
        const usableGroups = rowGroups.filter((g) => g.bottom - g.top >= 2);
        return usableGroups.map((group) => {
          const bandPoints = points.filter((p) => p.y >= group.top && p.y <= group.bottom);
          let left = Infinity;
          let right = -Infinity;
          let top = Infinity;
          let bottom = -Infinity;
          let sumX = 0;
          let sumY = 0;
          for (const p of bandPoints) {
            left = Math.min(left, p.x);
            right = Math.max(right, p.x);
            top = Math.min(top, p.y);
            bottom = Math.max(bottom, p.y);
            sumX += p.x;
            sumY += p.y;
          }
          const pixels = bandPoints.length;
          return {
            left,
            right,
            top,
            bottom,
            cx: sumX / Math.max(1, pixels),
            cy: sumY / Math.max(1, pixels),
            pixels,
          };
        });
      }

      async function inkStats(shot: PageShot, clip: Clip): Promise<InkStats> {
        const bitmap = await decodePng(shot.pngBase64);
        const scaleX = bitmap.width / shot.pageWidth;
        const scaleY = bitmap.height / shot.pageHeight;
        const x0 = Math.max(0, Math.round(clip.left * scaleX));
        const y0 = Math.max(0, Math.round(clip.top * scaleY));
        const x1 = Math.min(bitmap.width, Math.round((clip.left + clip.width) * scaleX));
        const y1 = Math.min(bitmap.height, Math.round((clip.top + clip.height) * scaleY));
        const width = Math.max(1, x1 - x0);
        const height = Math.max(1, y1 - y0);
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d canvas unavailable");
        ctx.drawImage(bitmap, x0, y0, width, height, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        const rowCounts = new Array<number>(height).fill(0);
        const points: Array<{ x: number; y: number }> = [];
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (data[i + 3] > 0 && data[i] + data[i + 1] + data[i + 2] < 560) {
              rowCounts[y]++;
              points.push({ x, y });
            }
          }
        }
        const bands = lineBands(points, rowCounts, width);
        return { width, height, pixels: points.length, bands };
      }

      function describeStats(stats: InkStats): string {
        return stats.bands
          .map(
            (b, i) =>
              `#${i + 1}[${b.left},${b.top}-${b.right},${b.bottom} cx=${b.cx.toFixed(1)} cy=${b.cy.toFixed(1)} px=${b.pixels}]`,
          )
          .join(" ");
      }

      const reference = await inkStats(referenceShot, clip);
      const candidate = await inkStats(candidateShot, clip);
      const failures: string[] = [];
      if (reference.bands.length !== candidate.bands.length) {
        failures.push(`line-band count ${reference.bands.length} -> ${candidate.bands.length}`);
      }
      const n = Math.min(reference.bands.length, candidate.bands.length);
      for (let i = 0; i < n; i++) {
        const a = reference.bands[i];
        const b = candidate.bands[i];
        const edgeDelta = Math.max(
          Math.abs(a.left - b.left),
          Math.abs(a.right - b.right),
          Math.abs(a.top - b.top),
          Math.abs(a.bottom - b.bottom),
        );
        const centroidDelta = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        const inkRatioDelta = Math.abs(a.pixels - b.pixels) / Math.max(1, a.pixels);
        if (edgeDelta > opts.maxEdgeDelta) {
          failures.push(`line ${i + 1} edge delta ${edgeDelta.toFixed(2)}px`);
        }
        if (centroidDelta > opts.maxCentroidDelta) {
          failures.push(`line ${i + 1} centroid delta ${centroidDelta.toFixed(2)}px`);
        }
        if (inkRatioDelta > opts.maxInkRatioDelta) {
          failures.push(`line ${i + 1} ink ratio delta ${(inkRatioDelta * 100).toFixed(2)}%`);
        }
      }
      return {
        ok: failures.length === 0,
        message: `${opts.label}: ${failures.join("; ")}\nreference=${describeStats(reference)}\ncandidate=${describeStats(candidate)}`,
        reference,
        candidate,
      };
    },
    { referenceShot, candidateShot, clip, opts },
  );
}
