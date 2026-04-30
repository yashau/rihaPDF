// Single source of truth for the Dhivehi (Thaana) fonts bundled with the
// app. Used by:
//   - the editor (CSS font-family lookups and the picker dropdown)
//   - the save pipeline (which font binary to embed for a given replacement)
//
// To add a new font: drop the .ttf into public/fonts/dhivehi/, slugify the
// filename, then add a row to FONTS below. The @font-face rules are
// generated at module load — no need to edit index.css.

export type DhivehiFont = {
  /** CSS family name used by the editor and saved PDFs. Keep it stable;
   *  the saved-PDF font registry references it. */
  family: string;
  /** Display name shown in the picker UI. */
  label: string;
  /** OS-installed names to try via `local(...)` first. The browser will
   *  prefer those over the bundled file when present. */
  localAliases: string[];
  /** Path under `public/`. Optional — when omitted, the browser only has
   *  the OS copy via `local()` to fall back on (used for Latin/system
   *  fonts we don't bundle). */
  url?: string;
  /** Which script the font targets. Drives the per-script default
   *  (Thaana → Faruma, Latin → Arial). */
  script: "thaana" | "latin";
  /** When set, save.ts uses pdf-lib's matching StandardFont instead of
   *  trying to embed a .ttf. Used for the standard-14 Latin families
   *  that have no bundled file. */
  standardFont?: "Helvetica" | "TimesRoman" | "Courier";
};

export const FONTS: DhivehiFont[] = [
  // Latin / English fonts. These are NOT bundled — the browser falls
  // back to OS-installed copies via `local()` for editor preview, and
  // save.ts uses pdf-lib's StandardFonts when writing them out (no .ttf
  // embedded, just the WinAnsi-encoded standard 14).
  { family: "Arial",            label: "Arial",             localAliases: ["Arial", "Helvetica", "Liberation Sans"], script: "latin", standardFont: "Helvetica" },
  { family: "Times New Roman",  label: "Times New Roman",   localAliases: ["Times New Roman", "Times", "Liberation Serif"], script: "latin", standardFont: "TimesRoman" },
  { family: "Courier New",      label: "Courier New",       localAliases: ["Courier New", "Courier", "Liberation Mono"], script: "latin", standardFont: "Courier" },
  { family: "Faruma",        label: "Faruma",            localAliases: ["Faruma"],                  url: "/fonts/dhivehi/faruma.ttf", script: "thaana" },
  { family: "MV Boli",       label: "MV Boli",           localAliases: ["MV Boli", "Boli"],         url: "/fonts/dhivehi/boli.ttf", script: "thaana" },
  { family: "MV Faseyha",    label: "MV Faseyha",        localAliases: ["MV Faseyha", "Faseyha"],   url: "/fonts/dhivehi/faseyha.ttf", script: "thaana" },
  { family: "MV Iyyu",       label: "MV Iyyu",           localAliases: ["MV Iyyu", "Iyyu Normal"],  url: "/fonts/dhivehi/iyyu-normal.ttf", script: "thaana" },
  { family: "MV Iyyu Formal",label: "MV Iyyu Formal",    localAliases: ["MV Iyyu Formal", "Iyyu Formal"], url: "/fonts/dhivehi/iyyu-formal.ttf", script: "thaana" },
  { family: "MV Iyyu Nala",  label: "MV Iyyu Nala",      localAliases: ["MV Iyyu Nala", "Iyyu Nala"], url: "/fonts/dhivehi/iyyu-nala.ttf", script: "thaana" },
  { family: "MV Waheed",     label: "MV Waheed",         localAliases: ["MV Waheed", "Waheed"],     url: "/fonts/dhivehi/waheed.ttf", script: "thaana" },
  { family: "MV Waheed P",   label: "MV Waheed P",       localAliases: ["Waheed P"],                url: "/fonts/dhivehi/waheed-p.ttf", script: "thaana" },
  { family: "MV Reethi",     label: "MV Reethi",         localAliases: ["Reethi"],                  url: "/fonts/dhivehi/reethi.ttf", script: "thaana" },
  { family: "MV Bismi",      label: "MV Bismi",          localAliases: ["Bismi"],                   url: "/fonts/dhivehi/bismi.ttf", script: "thaana" },
  { family: "MV Avas",       label: "MV Avas",           localAliases: ["Avas"],                    url: "/fonts/dhivehi/avas.ttf", script: "thaana" },
  { family: "MV Akko",       label: "MV Akko",           localAliases: ["Akko"],                    url: "/fonts/dhivehi/akko.ttf", script: "thaana" },
  { family: "MV Ilham",      label: "MV Ilham",          localAliases: ["Ilham"],                   url: "/fonts/dhivehi/ilham.ttf", script: "thaana" },
  { family: "MV Radhun",     label: "MV Radhun",         localAliases: ["Radhun"],                  url: "/fonts/dhivehi/radhun.ttf", script: "thaana" },
  { family: "MV Randhoo",    label: "MV Randhoo",        localAliases: ["Randhoo"],                 url: "/fonts/dhivehi/randhoo.ttf", script: "thaana" },
  { family: "MV Randhoo P",  label: "MV Randhoo P",      localAliases: ["Randhoo P"],               url: "/fonts/dhivehi/randhoo-p.ttf", script: "thaana" },
  { family: "MV Aa Randhoo", label: "MV Aa Randhoo",     localAliases: ["Aa Randhoo"],              url: "/fonts/dhivehi/aa-randhoo.ttf", script: "thaana" },
  { family: "MV Utheem",     label: "MV Utheem",         localAliases: ["Utheem"],                  url: "/fonts/dhivehi/utheem.ttf", script: "thaana" },
  { family: "MV Utheem P",   label: "MV Utheem P",       localAliases: ["Utheem P"],                url: "/fonts/dhivehi/utheem-p.ttf", script: "thaana" },
  { family: "MV Eaman XP",   label: "MV Eaman XP",       localAliases: ["Eaman XP", "Eamaan XP"],   url: "/fonts/dhivehi/eaman-xp.ttf", script: "thaana" },
  { family: "MV Elaaf",      label: "MV Elaaf",          localAliases: ["Elaaf Normal", "Elaaf"],   url: "/fonts/dhivehi/elaaf-normal.ttf", script: "thaana" },
  { family: "MV Elaaf Lite", label: "MV Elaaf Lite",     localAliases: ["Elaaf Lite"],              url: "/fonts/dhivehi/elaaf-lite.ttf", script: "thaana" },
  { family: "MV Aammu Rasmy",label: "MV Aammu Rasmy",    localAliases: ["Aammu F Rasmy"],           url: "/fonts/dhivehi/aammu-f-rasmy.ttf", script: "thaana" },
  { family: "MV Aammu Thedhu F", label: "MV Aammu Thedhu F", localAliases: ["Aammu F Thedhu"],     url: "/fonts/dhivehi/aammu-f-thedhu.ttf", script: "thaana" },
  { family: "MV Aammu Thedhu H", label: "MV Aammu Thedhu H", localAliases: ["Aammu H Thedhu"],     url: "/fonts/dhivehi/aammu-h-thedhu.ttf", script: "thaana" },
  { family: "MV Lady Luck",  label: "MV Lady Luck",      localAliases: ["Lady Luck"],               url: "/fonts/dhivehi/lady-luck.ttf", script: "thaana" },
  { family: "MV MAG Round",  label: "MV MAG Round",      localAliases: ["MAG Round"],               url: "/fonts/dhivehi/mag-round.ttf", script: "thaana" },
  { family: "MV MAG Round XBold", label: "MV MAG Round XBold", localAliases: ["MAG Round XBold"], url: "/fonts/dhivehi/mag-round-xbold.ttf", script: "thaana" },
  { family: "MV MAG Round Hollow", label: "MV MAG Round Hollow", localAliases: ["MAG Round Hollow"], url: "/fonts/dhivehi/mag-round-hollowttf.ttf", script: "thaana" },
  { family: "MV Raadhavalhi",label: "MV Raadhavalhi",    localAliases: ["Raadhavalhi"],             url: "/fonts/dhivehi/raadhavalhi.ttf", script: "thaana" },
  { family: "MV Raadhavalhi B", label: "MV Raadhavalhi B", localAliases: ["Raadhavalhi B"],        url: "/fonts/dhivehi/raadhavalhi-b.ttf", script: "thaana" },
  { family: "MV Raadhavalhi P", label: "MV Raadhavalhi P", localAliases: ["Raadhavalhi P"],        url: "/fonts/dhivehi/raadhavalhi-p.ttf", script: "thaana" },
  { family: "MV Raadhavalhi FP", label: "MV Raadhavalhi FP", localAliases: ["Raadhavalhi FP"],     url: "/fonts/dhivehi/raadhavalhi-fp.ttf", script: "thaana" },
  { family: "MV Sehga FB",   label: "MV Sehga FB",       localAliases: ["Sehga FB"],                url: "/fonts/dhivehi/sehga-fb.ttf", script: "thaana" },
  { family: "MV Thaana",     label: "MV Thaana",         localAliases: ["Thaana"],                  url: "/fonts/dhivehi/thaana.ttf", script: "thaana" },
  { family: "MV Thaana Bold",label: "MV Thaana Bold",    localAliases: ["Thaana Bold"],             url: "/fonts/dhivehi/thaana-bold.ttf", script: "thaana" },
  { family: "MV Thaana 1U",  label: "MV Thaana 1U",      localAliases: ["Thaana 1U"],               url: "/fonts/dhivehi/thaana-1u.ttf", script: "thaana" },
  // Bundled fallback — guaranteed coverage even on machines with no
  // installed Dhivehi font.
  { family: "Noto Sans Thaana", label: "Noto Sans Thaana (fallback)",
    localAliases: ["Noto Sans Thaana"], url: "/fonts/dhivehi/noto-sans-thaana.ttf", script: "thaana" },
];

/** Default font for the editor and for replacements when nothing else
 *  is specified. Faruma is the de-facto Maldivian standard for RTL
 *  Thaana text; Arial is the fallback for Latin / English text. */
export const DEFAULT_FONT_FAMILY = "Faruma";
export const DEFAULT_LATIN_FONT_FAMILY = "Arial";

/** CSS font-family chain we use for Thaana (only Thaana entries — never
 *  fall through to Latin fonts that lack Thaana glyphs). */
export const THAANA_FONT_STACK = [
  ...FONTS.filter((f) => f.script === "thaana").map((f) => `"${f.family}"`),
  "sans-serif",
].join(", ");

/** Coarse RTL detection: any Hebrew / Arabic / Syriac / Thaana / older
 *  RTL script codepoint marks the text as RTL for our purposes. Used
 *  to pick the right per-script default when the run's BaseFont hint
 *  isn't usable. */
export function isRtlScript(text: string | null | undefined): boolean {
  if (!text) return false;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (
      (cp >= 0x0590 && cp <= 0x08ff) || // Hebrew, Arabic, Syriac, Thaana
      (cp >= 0xfb1d && cp <= 0xfdff) || // Arabic Presentation Forms-A
      (cp >= 0xfe70 && cp <= 0xfeff) || // Arabic Presentation Forms-B
      (cp >= 0x10800 && cp <= 0x10fff)
    ) {
      return true;
    }
  }
  return false;
}

/** Per-script default. */
export function defaultFontForScript(text: string | null | undefined): string {
  return isRtlScript(text) ? DEFAULT_FONT_FAMILY : DEFAULT_LATIN_FONT_FAMILY;
}

/** Inject @font-face rules for every registered font. Must be called once
 *  at app startup before any Thaana-rendering happens. Idempotent. */
let injected = false;
export function injectFontFaces(): void {
  if (injected) return;
  injected = true;
  if (typeof document === "undefined") return;
  const style = document.createElement("style");
  style.dataset.dhivehiFonts = "true";
  let css = "";
  for (const f of FONTS) {
    const sources = [
      ...f.localAliases.map((a) => `local("${a}")`),
      ...(f.url ? [`url("${f.url}") format("truetype")`] : []),
    ].join(", ");
    if (!sources) continue;
    css += `@font-face { font-family: "${f.family}"; src: ${sources}; font-display: swap; }\n`;
  }
  // Also drive the .thaana-stack utility class so component code can stay
  // declarative (`<span className="thaana-stack">`) without re-importing
  // the stack constant.
  css += `.thaana-stack { font-family: ${THAANA_FONT_STACK}; }\n`;
  style.textContent = css;
  document.head.appendChild(style);
}

/** Cached fetch of font bytes — used by HarfBuzz / pdf-lib at save time.
 *  Latin families that point at a pdf-lib StandardFont have no bundled
 *  binary; callers must check `f.standardFont` first and skip
 *  `loadFontBytes` for those. */
const bytesCache = new Map<string, Promise<Uint8Array>>();
export function loadFontBytes(family: string): Promise<Uint8Array> {
  const cached = bytesCache.get(family);
  if (cached) return cached;
  const def = FONTS.find((f) => f.family === family);
  if (!def) throw new Error(`Unknown font: ${family}`);
  if (!def.url) {
    throw new Error(
      `Font "${family}" has no bundled .ttf — use StandardFont path`,
    );
  }
  const url = def.url;
  const p = fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`Failed to load ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  });
  bytesCache.set(family, p);
  return p;
}

/** Common BaseFont substrings that indicate a Latin font even when the
 *  exact family isn't in our registry. Used by resolveFamilyFromHint to
 *  route Word's "VoguePSMT" / "TimesNewRomanPSMT" etc. to the closest
 *  Latin family we know how to render. */
const LATIN_BASE_FONT_KEYWORDS: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /timesnewroman|times-?roman/i,           family: "Times New Roman" },
  { pattern: /courier/i,                              family: "Courier New" },
  { pattern: /helvetica|arial|liberation\s*sans|nimbus\s*sans|vogue|calibri/i, family: "Arial" },
];

/** Best-effort: given a font name reported by pdf.js / a PDF's BaseFont,
 *  return the closest matching registered family. Optional `text` lets
 *  callers feed the run's actual content so we can pick a script-
 *  appropriate default (Thaana → Faruma, Latin → Arial) when the hint
 *  doesn't match anything we know. */
export function resolveFamilyFromHint(
  hint: string | null | undefined,
  text?: string | null,
): string {
  if (!hint) return defaultFontForScript(text);
  const stripped = hint
    .replace(/^[a-z]{6}\+/i, "") // strip subset prefix like "ABCDEF+"
    .replace(/-(regular|bold|italic|oblique)$/i, "");
  const normalized = stripped.toLowerCase().replace(/[-_,+\s]/g, "");

  // Exact / substring match against a registered family or alias.
  for (const f of FONTS) {
    const aliases = [f.family, ...f.localAliases];
    for (const a of aliases) {
      const aNorm = a.toLowerCase().replace(/[-_,+\s]/g, "");
      if (aNorm === normalized || normalized.includes(aNorm)) return f.family;
    }
  }
  // Latin keyword fallback for fonts we don't bundle by name (e.g.
  // "BCDEEE+TimesNewRomanPSMT" → "Times New Roman").
  for (const { pattern, family } of LATIN_BASE_FONT_KEYWORDS) {
    if (pattern.test(stripped)) return family;
  }
  // Last resort: pick the script-appropriate default.
  return defaultFontForScript(text);
}
