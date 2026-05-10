import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FONTS } from "@/pdf/text/fonts";

const dhivehiFontsDir = join(process.cwd(), "public", "fonts", "dhivehi");

describe("Dhivehi font registry", () => {
  it("registers every bundled Thaana font file", () => {
    const bundledThaanaFonts = FONTS.filter((font) => font.script === "thaana" && font.url);
    const fontFiles = readdirSync(dhivehiFontsDir).filter((name) => name !== "README.md");

    expect(bundledThaanaFonts).toHaveLength(231);
    expect(fontFiles).toHaveLength(231);

    for (const font of bundledThaanaFonts) {
      const relativePath = font.url!.replace(/^\//, "").replace(/^fonts\/dhivehi\//, "");
      expect(
        existsSync(join(dhivehiFontsDir, relativePath)),
        `${font.family} points at ${font.url}`,
      ).toBe(true);
    }
  });

  it("keeps ModFaruma attribution and public counts visible", () => {
    expect(FONTS).toContainEqual(
      expect.objectContaining({
        family: "ModFaruma",
        localAliases: ["ModFaruma"],
        url: "/fonts/dhivehi/modfaruma.ttf",
        script: "thaana",
      }),
    );

    const rootReadme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const fontReadme = readFileSync(join(dhivehiFontsDir, "README.md"), "utf8");
    const notice = readFileSync(join(process.cwd(), "NOTICE"), "utf8");

    expect(rootReadme).toContain("231 bundled Thaana fonts");
    expect(fontReadme).toContain("This directory bundles 231 Thaana fonts");
    expect(fontReadme).toContain("modfaruma.ttf");
    expect(fontReadme).toContain("modified for rufiyaa symbol by Kudanai, 2023");
    expect(fontReadme).toContain("U+0024 DOLLAR SIGN (`$`)");
    expect(notice).toContain("ModFaruma");
    expect(notice).toContain("No separate license metadata is present");
  });
});
