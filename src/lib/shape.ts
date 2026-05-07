// HarfBuzz-based text shaping. Returns per-glyph IDs + positions for a
// given font (the original embedded font from the source PDF, ideally),
// so the saved PDF can contain REAL text — selectable, searchable, and
// with correct Thaana shaping (combining marks at zero advance, mark-to-
// base GPOS positioning).

// harfbuzzjs's default export is a Promise constructed at module load,
// which means we can't pass it a `locateFile` option to find the WASM.
// Bypass that and call the emscripten factory + hbjs wrapper directly.
// @ts-expect-error harfbuzzjs has no TS types
import hbModuleFactory from "harfbuzzjs/hb.js";
// @ts-expect-error harfbuzzjs has no TS types
import hbjsWrap from "harfbuzzjs/hbjs.js";
// Vite resolves the .wasm to a hashed asset URL at build time so the
// emscripten loader can fetch it instead of guessing a relative path.
import hbWasmUrl from "harfbuzzjs/hb.wasm?url";

export type ShapedGlyph = {
  /** Glyph ID in the font's glyf table. Same as what pdf-lib will write
   *  into the content stream when we embed the font with subset=false. */
  glyphId: number;
  /** Advances and offsets in font units (1/upem). */
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
  /** Source UTF-16 cluster — which char of the input this glyph maps to. */
  cluster: number;
};

export type ShapeResult = {
  glyphs: ShapedGlyph[];
  totalAdvance: number;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  /** Resolved direction HarfBuzz shaped with. Glyphs come back in
   *  *visual* order regardless: for "rtl" the leftmost-rendered glyph is
   *  glyphs[0] (= the LAST logical character). Emitters that want
   *  pdf.js-compatible text extraction must walk the array in reverse
   *  for "rtl" so the saved Tj sequence is in logical order. */
  direction: "ltr" | "rtl";
};

type Hb = {
  createBlob(buf: ArrayBuffer): { destroy(): void };
  createFace(
    blob: { destroy(): void },
    index: number,
  ): {
    destroy(): void;
    upem?: number;
    get_upem?(): number;
  };
  createFont(face: unknown): {
    destroy(): void;
    setScale?(x: number, y: number): void;
  };
  createBuffer(): {
    addText(t: string): void;
    guessSegmentProperties(): void;
    setDirection(d: "ltr" | "rtl" | "ttb" | "btt"): void;
    setScript(tag: string): void;
    setLanguage(tag: string): void;
    json(): Array<{
      g: number;
      ax: number;
      ay: number;
      dx: number;
      dy: number;
      cl?: number;
    }>;
    destroy(): void;
  };
  shape(font: unknown, buffer: unknown): void;
};

let hbPromise: Promise<Hb> | null = null;
async function getHb(): Promise<Hb> {
  if (hbPromise) return hbPromise;
  hbPromise = (async () => {
    const factory = hbModuleFactory as (opts: {
      locateFile?: (f: string) => string;
    }) => Promise<unknown>;
    const wrap = hbjsWrap as (instance: unknown) => Hb;
    const instance = await factory({
      locateFile: (file: string) => (file.endsWith(".wasm") ? hbWasmUrl : file),
    });
    return wrap(instance);
  })();
  return hbPromise;
}

async function shapeWithFont(
  text: string,
  fontBytes: Uint8Array,
  direction: ShapeResult["direction"],
  configureBuffer: (buffer: ReturnType<Hb["createBuffer"]>) => void,
): Promise<ShapeResult> {
  const hb = await getHb();
  const f = await getFont(fontBytes);
  const buf = hb.createBuffer();
  try {
    buf.addText(text);
    configureBuffer(buf);
    hb.shape(f.font, buf);
    const glyphs: ShapedGlyph[] = buf.json().map((g) => ({
      glyphId: g.g,
      xAdvance: g.ax,
      yAdvance: g.ay,
      xOffset: g.dx,
      yOffset: g.dy,
      cluster: g.cl ?? 0,
    }));
    let totalAdvance = 0;
    for (const g of glyphs) totalAdvance += g.xAdvance;
    return {
      glyphs,
      totalAdvance,
      unitsPerEm: f.unitsPerEm,
      ascender: f.ascender,
      descender: f.descender,
      direction,
    };
  } finally {
    buf.destroy();
  }
}

type HbFont = {
  font: { destroy(): void };
  face: { destroy(): void; upem?: number; get_upem?: () => number };
  blob: { destroy(): void };
  unitsPerEm: number;
  ascender: number;
  descender: number;
};

const fontCache = new Map<Uint8Array, HbFont>();

async function getFont(fontBytes: Uint8Array): Promise<HbFont> {
  const cached = fontCache.get(fontBytes);
  if (cached) return cached;
  const hb = await getHb();
  // harfbuzzjs createBlob takes an ArrayBuffer; copy to be safe.
  const buf = fontBytes.buffer.slice(
    fontBytes.byteOffset,
    fontBytes.byteOffset + fontBytes.byteLength,
  ) as ArrayBuffer;
  const blob = hb.createBlob(buf);
  const face = hb.createFace(blob, 0);
  const upem = typeof face.get_upem === "function" ? face.get_upem() : (face.upem ?? 1000);
  const font = hb.createFont(face);
  // Best-effort metrics — refined later via fontkit if needed.
  const ascender = Math.round(upem * 0.85);
  const descender = -Math.round(upem * 0.25);
  const result: HbFont = {
    font,
    face,
    blob,
    unitsPerEm: upem,
    ascender,
    descender,
  };
  fontCache.set(fontBytes, result);
  return result;
}

/** A run of characters all rendered with the same font. */
export type FontChunk = {
  /** Reference key used by callers to identify which font to draw with. */
  fontKey: string;
  text: string;
  shape: ShapeResult;
};

/**
 * Shape a string using a primary font; for any character whose glyph in the
 * primary font is .notdef (id=0), fall back to the secondary font for that
 * character. Returns the input split into per-font chunks in *visual* order
 * (i.e. as HarfBuzz emits glyphs for an RTL run).
 */
export async function shapeWithFallback(
  text: string,
  primary: { key: string; bytes: Uint8Array },
  fallback: { key: string; bytes: Uint8Array },
): Promise<FontChunk[]> {
  // First pass: shape entire string with primary, identify which clusters
  // (input character indices) ended up as .notdef.
  const primaryShape = await shapeRtlThaana(text, primary.bytes);
  const missingClusters = new Set<number>();
  for (const g of primaryShape.glyphs) {
    if (g.glyphId === 0) missingClusters.add(g.cluster);
  }
  if (missingClusters.size === 0) {
    return [{ fontKey: primary.key, text, shape: primaryShape }];
  }

  // Walk the input characters in *logical* order, grouping consecutive
  // characters that share the same font assignment. Iterate by code point
  // (handle surrogate pairs by step-by-2 when needed; Thaana/Latin/Arabic
  // here is all in BMP so simple per-char is fine).
  const chunks: { font: typeof primary | typeof fallback; chars: string }[] = [];
  let current: { font: typeof primary | typeof fallback; chars: string } | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const useFallback = missingClusters.has(i);
    const font = useFallback ? fallback : primary;
    if (!current || current.font !== font) {
      if (current) chunks.push(current);
      current = { font, chars: ch };
    } else {
      current.chars += ch;
    }
  }
  if (current) chunks.push(current);

  const result: FontChunk[] = [];
  for (const c of chunks) {
    const shape = await shapeRtlThaana(c.chars, c.font.bytes);
    result.push({ fontKey: c.font.key, text: c.chars, shape });
  }
  return result;
}

export async function shapeRtlThaana(text: string, fontBytes: Uint8Array): Promise<ShapeResult> {
  return shapeWithFont(text, fontBytes, "rtl", (buf) => {
    buf.setDirection("rtl");
    buf.setScript("Thaa");
    buf.setLanguage("dhv");
  });
}

/**
 * Auto-detect direction. For mixed text (numbers in RTL), HarfBuzz with
 * direction-guess via guessSegmentProperties handles it; we just give it a
 * starting hint.
 */
export async function shapeAuto(text: string, fontBytes: Uint8Array): Promise<ShapeResult> {
  const hasRtl = /[֐-׿؀-ۿހ-޿]/u.test(text);
  if (hasRtl) return shapeRtlThaana(text, fontBytes);
  return shapeWithFont(text, fontBytes, "ltr", (buf) => {
    buf.guessSegmentProperties();
  });
}
