import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FONT_FAMILY,
  FONTS,
  canonicalFontFamily,
  defaultFontForScript,
  injectFontFaces,
  loadFontBytes,
  resolveFamilyFromHint,
} from "@/pdf/text/fonts";
import { decodeLegacyThaanaText, shouldDecodeLegacyThaanaText } from "@/pdf/text/legacyThaana";

const dhivehiFontsDir = join(process.cwd(), "public", "fonts", "dhivehi");

describe("Dhivehi font registry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("points every registered bundled Thaana font at a shipped file", () => {
    const bundledThaanaFonts = FONTS.filter((font) => font.script === "thaana" && font.url);
    const fontFiles = readdirSync(dhivehiFontsDir).filter((name) => name !== "README.md");

    expect(bundledThaanaFonts).toHaveLength(231);
    expect(fontFiles).toHaveLength(232);

    for (const font of bundledThaanaFonts) {
      const relativePath = font.url!.replace(/^\//, "").replace(/^fonts\/dhivehi\//, "");
      expect(
        existsSync(join(dhivehiFontsDir, relativePath)),
        `${font.family} points at ${font.url}`,
      ).toBe(true);
    }
  });

  it("uses ModFaruma as the Faruma-compatible default without a duplicate picker entry", () => {
    expect(DEFAULT_FONT_FAMILY).toBe("Faruma");
    expect(defaultFontForScript("ދިވެހި")).toBe("Faruma");

    const faruma = FONTS.filter((font) => font.family === "Faruma");
    expect(faruma).toHaveLength(1);
    expect(faruma[0]).toMatchObject({
      label: "Faruma (ModFaruma)",
      localAliases: ["ModFaruma"],
      compatAliases: ["ModFaruma"],
      url: "/fonts/dhivehi/modfaruma.ttf",
      script: "thaana",
    });
    expect(faruma[0].localAliases).not.toContain("Faruma");
    expect(FONTS.some((font) => font.family === "ModFaruma")).toBe(false);
  });

  it("resolves Faruma and ModFaruma source hints to the Faruma-compatible entry", () => {
    expect(resolveFamilyFromHint("ABCDEE+Faruma", "ދިވެހި")).toBe("Faruma");
    expect(resolveFamilyFromHint("ABCDEE+AFaruma", "ދިވެހި")).toBe("Faruma");
    expect(resolveFamilyFromHint("ModFaruma", "ދިވެހި")).toBe("Faruma");
    expect(canonicalFontFamily("ModFaruma")).toBe("Faruma");
  });

  it("does not treat suspicious legacy Thaana-looking source fonts as Arial", () => {
    expect(resolveFamilyFromHint("EEZQGN+VoguePSMT", "DhiAeEe")).toBe("Faruma");
    expect(resolveFamilyFromHint("KFIISE+VoguePSMT", null)).toBe("Faruma");
    expect(resolveFamilyFromHint("PQUZOT+A_Randhoo-Aa", "DhiAeEe")).toBe("MV Aa Randhoo");
    expect(canonicalFontFamily("A_Randhoo-Aa")).toBe("MV Aa Randhoo");
  });

  it("decodes Vogue/Randhoo legacy ASCII text to logical Unicode Thaana", () => {
    expect(shouldDecodeLegacyThaanaText("EEZQGN+VoguePSMT", "unWHitcmia")).toBe(true);
    expect(decodeLegacyThaanaText("unWHitcmia cTekifcTes clUkcs IrwDcnwkes")).toBe(
      "ސެކަންޑަރީ ސްކޫލް ސެޓްފިކެޓް އިމްތިހާނު",
    );
  });

  it("injects Faruma and ModFaruma CSS families from bundled modfaruma.ttf only", () => {
    const appended: { textContent: string | null }[] = [];
    const fakeDocument = {
      createElement: () => ({ dataset: {}, textContent: null }),
      head: {
        appendChild: (style: { textContent: string | null }) => appended.push(style),
      },
    };
    vi.stubGlobal("document", fakeDocument);

    injectFontFaces();

    const css = appended[0].textContent ?? "";
    expect(css).toContain('font-family: "Faruma"');
    expect(css).toContain('font-family: "ModFaruma"');
    expect(css).toContain('url("/fonts/dhivehi/modfaruma.ttf") format("truetype")');
    expect(css).not.toContain('local("Faruma")');
    expect(css).not.toContain('url("/fonts/dhivehi/faruma.ttf")');
  });

  it("loads legacy ModFaruma requests from the bundled Faruma-compatible URL", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await loadFontBytes("ModFaruma");

    expect(fetchMock).toHaveBeenCalledWith("/fonts/dhivehi/modfaruma.ttf");
  });

  it("keeps Faruma Arabic and ModFaruma attribution and public counts visible", () => {
    expect(FONTS).toContainEqual(
      expect.objectContaining({
        family: "Faruma Arabic",
        localAliases: ["Faruma Arabic", "FarumaArabic"],
        url: "/fonts/dhivehi/faruma-arabic.ttf",
        script: "thaana",
      }),
    );
    expect(FONTS).toContainEqual(
      expect.objectContaining({
        family: "Faruma",
        label: "Faruma (ModFaruma)",
        localAliases: ["ModFaruma"],
        compatAliases: ["ModFaruma"],
        url: "/fonts/dhivehi/modfaruma.ttf",
        script: "thaana",
      }),
    );

    const rootReadme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const fontReadme = readFileSync(join(dhivehiFontsDir, "README.md"), "utf8");
    const notice = readFileSync(join(process.cwd(), "NOTICE"), "utf8");

    expect(rootReadme).toContain("232 bundled Thaana fonts");
    expect(fontReadme).toContain("This directory bundles 232 Thaana fonts");
    expect(fontReadme).toContain("faruma-arabic.ttf");
    expect(fontReadme).toContain("Modified & Compiled by Mohamed Jailam");
    expect(fontReadme).toContain(
      "combines Faruma Font, Traditional Arabic, and AGA Arabesque Regular",
    );
    expect(fontReadme).toContain("modfaruma.ttf");
    expect(fontReadme).toContain("modified for rufiyaa symbol by Kudanai, 2023");
    expect(fontReadme).toContain("U+0024 DOLLAR SIGN (`$`)");
    expect(notice).toContain("Faruma Arabic");
    expect(notice).toContain("Modified & Compiled by Mohamed Jailam");
    expect(notice).toContain("ModFaruma");
    expect(notice).toContain("No separate license metadata is present");
  });
});
