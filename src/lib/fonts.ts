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
  /** Path under `public/`. */
  url: string;
};

export const FONTS: DhivehiFont[] = [
  { family: "Faruma",        label: "Faruma",            localAliases: ["Faruma"],                  url: "/fonts/dhivehi/faruma.ttf" },
  { family: "MV Boli",       label: "MV Boli",           localAliases: ["MV Boli", "Boli"],         url: "/fonts/dhivehi/boli.ttf" },
  { family: "MV Faseyha",    label: "MV Faseyha",        localAliases: ["MV Faseyha", "Faseyha"],   url: "/fonts/dhivehi/faseyha.ttf" },
  { family: "MV Iyyu",       label: "MV Iyyu",           localAliases: ["MV Iyyu", "Iyyu Normal"],  url: "/fonts/dhivehi/iyyu-normal.ttf" },
  { family: "MV Iyyu Formal",label: "MV Iyyu Formal",    localAliases: ["MV Iyyu Formal", "Iyyu Formal"], url: "/fonts/dhivehi/iyyu-formal.ttf" },
  { family: "MV Iyyu Nala",  label: "MV Iyyu Nala",      localAliases: ["MV Iyyu Nala", "Iyyu Nala"], url: "/fonts/dhivehi/iyyu-nala.ttf" },
  { family: "MV Waheed",     label: "MV Waheed",         localAliases: ["MV Waheed", "Waheed"],     url: "/fonts/dhivehi/waheed.ttf" },
  { family: "MV Waheed P",   label: "MV Waheed P",       localAliases: ["Waheed P"],                url: "/fonts/dhivehi/waheed-p.ttf" },
  { family: "MV Reethi",     label: "MV Reethi",         localAliases: ["Reethi"],                  url: "/fonts/dhivehi/reethi.ttf" },
  { family: "MV Bismi",      label: "MV Bismi",          localAliases: ["Bismi"],                   url: "/fonts/dhivehi/bismi.ttf" },
  { family: "MV Avas",       label: "MV Avas",           localAliases: ["Avas"],                    url: "/fonts/dhivehi/avas.ttf" },
  { family: "MV Akko",       label: "MV Akko",           localAliases: ["Akko"],                    url: "/fonts/dhivehi/akko.ttf" },
  { family: "MV Ilham",      label: "MV Ilham",          localAliases: ["Ilham"],                   url: "/fonts/dhivehi/ilham.ttf" },
  { family: "MV Radhun",     label: "MV Radhun",         localAliases: ["Radhun"],                  url: "/fonts/dhivehi/radhun.ttf" },
  { family: "MV Randhoo",    label: "MV Randhoo",        localAliases: ["Randhoo"],                 url: "/fonts/dhivehi/randhoo.ttf" },
  { family: "MV Randhoo P",  label: "MV Randhoo P",      localAliases: ["Randhoo P"],               url: "/fonts/dhivehi/randhoo-p.ttf" },
  { family: "MV Aa Randhoo", label: "MV Aa Randhoo",     localAliases: ["Aa Randhoo"],              url: "/fonts/dhivehi/aa-randhoo.ttf" },
  { family: "MV Utheem",     label: "MV Utheem",         localAliases: ["Utheem"],                  url: "/fonts/dhivehi/utheem.ttf" },
  { family: "MV Utheem P",   label: "MV Utheem P",       localAliases: ["Utheem P"],                url: "/fonts/dhivehi/utheem-p.ttf" },
  { family: "MV Eaman XP",   label: "MV Eaman XP",       localAliases: ["Eaman XP", "Eamaan XP"],   url: "/fonts/dhivehi/eaman-xp.ttf" },
  { family: "MV Elaaf",      label: "MV Elaaf",          localAliases: ["Elaaf Normal", "Elaaf"],   url: "/fonts/dhivehi/elaaf-normal.ttf" },
  { family: "MV Elaaf Lite", label: "MV Elaaf Lite",     localAliases: ["Elaaf Lite"],              url: "/fonts/dhivehi/elaaf-lite.ttf" },
  { family: "MV Aammu Rasmy",label: "MV Aammu Rasmy",    localAliases: ["Aammu F Rasmy"],           url: "/fonts/dhivehi/aammu-f-rasmy.ttf" },
  { family: "MV Aammu Thedhu F", label: "MV Aammu Thedhu F", localAliases: ["Aammu F Thedhu"],     url: "/fonts/dhivehi/aammu-f-thedhu.ttf" },
  { family: "MV Aammu Thedhu H", label: "MV Aammu Thedhu H", localAliases: ["Aammu H Thedhu"],     url: "/fonts/dhivehi/aammu-h-thedhu.ttf" },
  { family: "MV Lady Luck",  label: "MV Lady Luck",      localAliases: ["Lady Luck"],               url: "/fonts/dhivehi/lady-luck.ttf" },
  { family: "MV MAG Round",  label: "MV MAG Round",      localAliases: ["MAG Round"],               url: "/fonts/dhivehi/mag-round.ttf" },
  { family: "MV MAG Round XBold", label: "MV MAG Round XBold", localAliases: ["MAG Round XBold"], url: "/fonts/dhivehi/mag-round-xbold.ttf" },
  { family: "MV MAG Round Hollow", label: "MV MAG Round Hollow", localAliases: ["MAG Round Hollow"], url: "/fonts/dhivehi/mag-round-hollowttf.ttf" },
  { family: "MV Raadhavalhi",label: "MV Raadhavalhi",    localAliases: ["Raadhavalhi"],             url: "/fonts/dhivehi/raadhavalhi.ttf" },
  { family: "MV Raadhavalhi B", label: "MV Raadhavalhi B", localAliases: ["Raadhavalhi B"],        url: "/fonts/dhivehi/raadhavalhi-b.ttf" },
  { family: "MV Raadhavalhi P", label: "MV Raadhavalhi P", localAliases: ["Raadhavalhi P"],        url: "/fonts/dhivehi/raadhavalhi-p.ttf" },
  { family: "MV Raadhavalhi FP", label: "MV Raadhavalhi FP", localAliases: ["Raadhavalhi FP"],     url: "/fonts/dhivehi/raadhavalhi-fp.ttf" },
  { family: "MV Sehga FB",   label: "MV Sehga FB",       localAliases: ["Sehga FB"],                url: "/fonts/dhivehi/sehga-fb.ttf" },
  { family: "MV Thaana",     label: "MV Thaana",         localAliases: ["Thaana"],                  url: "/fonts/dhivehi/thaana.ttf" },
  { family: "MV Thaana Bold",label: "MV Thaana Bold",    localAliases: ["Thaana Bold"],             url: "/fonts/dhivehi/thaana-bold.ttf" },
  { family: "MV Thaana 1U",  label: "MV Thaana 1U",      localAliases: ["Thaana 1U"],               url: "/fonts/dhivehi/thaana-1u.ttf" },
  // Bundled fallback — guaranteed coverage even on machines with no
  // installed Dhivehi font.
  { family: "Noto Sans Thaana", label: "Noto Sans Thaana (fallback)",
    localAliases: ["Noto Sans Thaana"], url: "/fonts/dhivehi/noto-sans-thaana.ttf" },
];

/** Default font for the editor and for replacements when nothing else
 *  is specified. Faruma is the de-facto Maldivian standard. */
export const DEFAULT_FONT_FAMILY = "Faruma";

/** CSS font-family chain we use everywhere we render Thaana. */
export const THAANA_FONT_STACK = [
  ...FONTS.map((f) => `"${f.family}"`),
  "sans-serif",
].join(", ");

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
      `url("${f.url}") format("truetype")`,
    ].join(", ");
    css += `@font-face { font-family: "${f.family}"; src: ${sources}; font-display: swap; }\n`;
  }
  // Also drive the .thaana-stack utility class so component code can stay
  // declarative (`<span className="thaana-stack">`) without re-importing
  // the stack constant.
  css += `.thaana-stack { font-family: ${THAANA_FONT_STACK}; }\n`;
  style.textContent = css;
  document.head.appendChild(style);
}

/** Cached fetch of font bytes — used by HarfBuzz / pdf-lib at save time. */
const bytesCache = new Map<string, Promise<Uint8Array>>();
export function loadFontBytes(family: string): Promise<Uint8Array> {
  const cached = bytesCache.get(family);
  if (cached) return cached;
  const def = FONTS.find((f) => f.family === family);
  if (!def) throw new Error(`Unknown Dhivehi font: ${family}`);
  const p = fetch(def.url).then(async (res) => {
    if (!res.ok) throw new Error(`Failed to load ${def.url}`);
    return new Uint8Array(await res.arrayBuffer());
  });
  bytesCache.set(family, p);
  return p;
}

/** Best-effort: given a font name reported by pdf.js / a PDF's BaseFont,
 *  return the closest matching registered family. Falls back to the
 *  default if nothing matches. Used so a saved replacement on a Faruma
 *  run keeps using Faruma rather than dropping to Noto. */
export function resolveFamilyFromHint(hint: string | null | undefined): string {
  if (!hint) return DEFAULT_FONT_FAMILY;
  const normalized = hint
    .toLowerCase()
    .replace(/^[a-z]{6}\+/i, "") // strip subset prefix like "ABCDEF+"
    .replace(/-(regular|bold|italic|oblique)$/i, "")
    .replace(/[-_,+\s]/g, "");
  for (const f of FONTS) {
    const aliases = [f.family, ...f.localAliases];
    for (const a of aliases) {
      const aNorm = a.toLowerCase().replace(/[-_,+\s]/g, "");
      if (aNorm === normalized || normalized.includes(aNorm)) return f.family;
    }
  }
  return DEFAULT_FONT_FAMILY;
}
