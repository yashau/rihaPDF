// Theme toggle: default = system, override = light/dark wins over OS.
//
// We drive `prefers-color-scheme` via Playwright's `emulateMedia` rather
// than poking the matchMedia API in-page, so the OS-tracking path is
// exercised exactly how a real browser would deliver it. The `.dark`
// class on <html> is the contract every dark-styled element keys off
// (Tailwind v4 custom variant + HeroUI's `.dark, [data-theme=dark]`),
// so asserting on that class is sufficient.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { APP_URL } from "../helpers/browser";

let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1500, height: 900 },
    // Start in light mode so the "default = system" assertion below
    // has a deterministic baseline regardless of the host OS theme.
    colorScheme: "light",
  });
  page = await context.newPage();
  page.setDefaultTimeout(8_000);
});

afterAll(async () => {
  await browser?.close();
});

async function goto() {
  // Clear any persisted override from a previous test so each case
  // starts with the actual default ("system"), not whatever the
  // previous case left in localStorage.
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("rihaPDF.theme"));
  await page.reload({ waitUntil: "networkidle" });
}

async function htmlHasDarkClass(): Promise<boolean> {
  return page.evaluate(() => document.documentElement.classList.contains("dark"));
}

describe("theme toggle", () => {
  test("default is system mode and tracks prefers-color-scheme: light", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await goto();
    expect(await htmlHasDarkClass(), "light system pref → no .dark on <html>").toBe(false);
    // The system button should be the active (aria-pressed=true) one.
    const sysPressed = await page
      .locator('[data-testid="theme-system"]')
      .getAttribute("aria-pressed");
    expect(sysPressed).toBe("true");
  });

  test("system mode follows prefers-color-scheme: dark", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await goto();
    // Defaults back to system after the localStorage clear in goto().
    expect(await htmlHasDarkClass(), "dark system pref → .dark on <html>").toBe(true);
  });

  test("dark override wins over system=light", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await goto();
    expect(await htmlHasDarkClass()).toBe(false);
    await page.locator('[data-testid="theme-dark"]').click();
    // Allow React's effect to flush and apply the class.
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
    expect(await htmlHasDarkClass(), "dark override should add .dark even with light OS").toBe(
      true,
    );
    // aria-pressed reflects the active selection.
    const darkPressed = await page
      .locator('[data-testid="theme-dark"]')
      .getAttribute("aria-pressed");
    expect(darkPressed).toBe("true");
  });

  test("light override wins over system=dark", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await goto();
    expect(await htmlHasDarkClass(), "system=dark default → .dark present").toBe(true);
    await page.locator('[data-testid="theme-light"]').click();
    await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
    expect(await htmlHasDarkClass(), "light override should remove .dark even with dark OS").toBe(
      false,
    );
  });

  test("override persists across reload, then switching back to system re-tracks OS", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await goto();
    await page.locator('[data-testid="theme-dark"]').click();
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));

    // Reload — persistence should keep us in dark even though OS=light.
    await page.reload({ waitUntil: "networkidle" });
    expect(
      await htmlHasDarkClass(),
      "dark override should survive reload regardless of OS pref",
    ).toBe(true);
    const darkPressed = await page
      .locator('[data-testid="theme-dark"]')
      .getAttribute("aria-pressed");
    expect(darkPressed).toBe("true");

    // Switch back to system → should now resolve to OS (light).
    await page.locator('[data-testid="theme-system"]').click();
    await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
    expect(await htmlHasDarkClass()).toBe(false);

    // And flipping the OS to dark while in system mode propagates live.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
    expect(await htmlHasDarkClass(), "system mode should follow live OS flip").toBe(true);
  });
});
