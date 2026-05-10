import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { FIXTURE, loadFixture, setupBrowser, tearDown, type Harness } from "../helpers/browser";

let h: Harness;

beforeAll(async () => {
  h = await setupBrowser({ viewport: { width: 1280, height: 900 } });
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("browser print layout", () => {
  test("prints only document pages with app chrome hidden and page-sized breaks", async () => {
    await loadFixture(h, FIXTURE.withImagesMultipage, { expectedPages: 2 });
    await h.page.emulateMedia({ media: "print" });

    const result = await h.page.evaluate(() => {
      const styleOf = (selector: string) => {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { display: cs.display, overflow: cs.overflow, width: cs.width, height: cs.height };
      };
      const pages = Array.from(document.querySelectorAll<HTMLElement>("[data-print-page]")).map(
        (page) => {
          const cs = getComputedStyle(page);
          const wrapper = page.closest<HTMLElement>("[data-print-page-wrapper]");
          const wrapperCs = wrapper ? getComputedStyle(wrapper) : null;
          const inner = page.querySelector<HTMLElement>("[data-print-page-inner]");
          const innerCs = inner ? getComputedStyle(inner) : null;
          return {
            width: cs.width,
            height: cs.height,
            boxShadow: cs.boxShadow,
            overflow: cs.overflow,
            breakAfter: wrapperCs?.breakAfter || wrapperCs?.getPropertyValue("page-break-after"),
            innerTransform: innerCs?.transform ?? "",
            canvasCount: page.querySelectorAll("canvas").length,
          };
        },
      );
      return {
        header: styleOf("header"),
        aside: styleOf("aside"),
        pageLabel: styleOf("[data-print-page-label]"),
        surface: styleOf("[data-print-document-surface]"),
        pages,
      };
    });

    expect(result.header?.display).toBe("none");
    expect(result.aside?.display).toBe("none");
    expect(result.pageLabel?.display).toBe("none");
    expect(result.surface?.overflow).toBe("visible");
    expect(result.pages.length).toBe(2);

    for (const page of result.pages) {
      expect(page.canvasCount).toBeGreaterThan(0);
      expect(page.boxShadow).toBe("none");
      expect(page.overflow).toBe("hidden");
      expect(parseFloat(page.width)).toBeGreaterThan(750);
      expect(parseFloat(page.height)).toBeGreaterThan(1000);
      expect(page.innerTransform).not.toBe("none");
    }
    expect(result.pages[0].breakAfter).toMatch(/page|always/);
  });
});
