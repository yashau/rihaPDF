// One-shot probe: walk every font dict in maldivian2.pdf, then for the
// fonts that lack /ToUnicode, decode their embedded FontFile2 SFNT and
// inspect (a) the cmap subtables, and (b) the post table glyph names.
// This decides whether maldivian2.pdf is a useful test bed for the
// "PDFs without /ToUnicode + stripped cmap → need glyph-name table" TODO.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRef,
  PDFRawStream,
  PDFArray,
  decodePDFRawStream,
} from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "..", "test/fixtures/maldivian2.pdf");

const bytes = fs.readFileSync(PDF);
const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

class SfntReader {
  constructor(buf) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.bytes = buf;
  }
  u8(o) {
    return this.dv.getUint8(o);
  }
  u16(o) {
    return this.dv.getUint16(o, false);
  }
  u32(o) {
    return this.dv.getUint32(o, false);
  }
  i16(o) {
    return this.dv.getInt16(o, false);
  }
  tag(o) {
    return String.fromCharCode(this.u8(o), this.u8(o + 1), this.u8(o + 2), this.u8(o + 3));
  }
}

function readTableDir(buf) {
  const r = new SfntReader(buf);
  const numTables = r.u16(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = r.tag(o);
    const off = r.u32(o + 8);
    const len = r.u32(o + 12);
    tables[tag] = { off, len };
  }
  return tables;
}

function summarizeCmap(buf, tableOff, tableLen) {
  const r = new SfntReader(buf);
  const numSub = r.u16(tableOff + 2);
  const subs = [];
  for (let i = 0; i < numSub; i++) {
    const eo = tableOff + 4 + i * 8;
    const platform = r.u16(eo);
    const encoding = r.u16(eo + 2);
    const off = tableOff + r.u32(eo + 4);
    const format = r.u16(off);
    subs.push({ platform, encoding, format });
  }
  return { numSub, subs };
}

function summarizePost(buf, tableOff, tableLen) {
  const r = new SfntReader(buf);
  const versionFixed = r.u32(tableOff);
  const versionStr = (versionFixed >>> 16) + "." + (versionFixed & 0xffff).toString(16);
  let glyphNameSample = null;
  if (versionFixed === 0x00020000) {
    // version 2.0: numGlyphs (u16) at tableOff+32, followed by glyphNameIndex[numGlyphs] (u16),
    // followed by Pascal strings.
    const numGlyphs = r.u16(tableOff + 32);
    const indexOff = tableOff + 34;
    const stringsOff = indexOff + numGlyphs * 2;
    const indices = [];
    for (let i = 0; i < numGlyphs; i++) indices.push(r.u16(indexOff + i * 2));
    // Walk Pascal strings.
    const customNames = [];
    let p = stringsOff;
    while (p < tableOff + tableLen) {
      const len = r.u8(p);
      p++;
      const s = new TextDecoder("latin1").decode(buf.subarray(p, p + len));
      customNames.push(s);
      p += len;
    }
    // Resolve a sample of glyph names: first 30 glyphs (skip .notdef).
    const sample = [];
    for (let g = 0; g < Math.min(numGlyphs, 30); g++) {
      const idx = indices[g];
      if (idx < 258)
        sample.push(`#${idx}`); // standard Macintosh name table
      else sample.push(customNames[idx - 258]);
    }
    // Also pull names that look Maldivian/Thaana-related.
    const interesting = customNames.filter((n) =>
      /thaana|fili|sukun|naviyaani|alif|gaaf|seenu|lhaviyani|noonu|raa|baa|haa|kaaf|laamu|meemu|faafu|daalu|thaa|nyaaviyani|gnaviyani|tha|aabaaf|afii577|afii578|afii579|afii580|afii581|afii582|afii583|afii584|afii585|afii586|afii587|afii588|afii589|afii590|afii591|afii592|afii593|afii594|afii595|afii596|afii597|afii598|afii599|afii600|afii601|afii602|afii603/i.test(
        n,
      ),
    );
    return {
      version: versionStr,
      numGlyphs,
      sampleFirst30: sample,
      thaanaLookingNames: interesting.slice(0, 60),
      totalCustomNames: customNames.length,
    };
  }
  return { version: versionStr };
}

function fontFile2Bytes(desc, ctx) {
  const ff2 = desc.lookup(PDFName.of("FontFile2"));
  if (!(ff2 instanceof PDFRawStream)) return null;
  return decodePDFRawStream(ff2).decode();
}

function fontProgramKind(desc) {
  if (desc.lookup(PDFName.of("FontFile")) instanceof PDFRawStream) return "Type1";
  if (desc.lookup(PDFName.of("FontFile2")) instanceof PDFRawStream) return "TrueType";
  if (desc.lookup(PDFName.of("FontFile3")) instanceof PDFRawStream) {
    const s = desc.lookup(PDFName.of("FontFile3"));
    const sub = s.dict?.lookup?.(PDFName.of("Subtype"));
    return sub ? `FF3:${sub.toString()}` : "FF3";
  }
  return "none";
}

const seenFontRefs = new Set();
const reports = [];

function summarizeEncoding(enc, ctx) {
  if (!enc) return { kind: "none" };
  if (enc instanceof PDFName) return { kind: "named", value: enc.toString() };
  if (enc instanceof PDFRef) return summarizeEncoding(ctx.lookup(enc), ctx);
  if (enc instanceof PDFDict) {
    const base = enc.lookup(PDFName.of("BaseEncoding"));
    const diffs = enc.lookup(PDFName.of("Differences"));
    let diffCount = 0;
    let sampleNames = [];
    if (diffs instanceof PDFArray) {
      for (let i = 0; i < diffs.size(); i++) {
        const item = diffs.lookup(i);
        if (item instanceof PDFName) {
          diffCount++;
          if (sampleNames.length < 12) sampleNames.push(item.toString());
        }
      }
    }
    return {
      kind: "dict",
      baseEncoding: base instanceof PDFName ? base.toString() : null,
      diffCount,
      sampleNames,
    };
  }
  return { kind: "other" };
}

const pages = doc.getPages();
for (let pi = 0; pi < pages.length; pi++) {
  const page = pages[pi];
  let node = page.node;
  let fontDict = null;
  while (node && !fontDict) {
    const r = node.lookup(PDFName.of("Resources"));
    if (r instanceof PDFDict) {
      const f = r.lookup(PDFName.of("Font"));
      if (f instanceof PDFDict) fontDict = f;
    }
    if (fontDict) break;
    const p = node.lookup(PDFName.of("Parent"));
    if (p instanceof PDFDict) node = p;
    else if (p instanceof PDFRef) {
      const r2 = doc.context.lookup(p);
      node = r2 instanceof PDFDict ? r2 : null;
    } else node = null;
  }
  if (!fontDict) continue;

  for (const [name] of fontDict.entries()) {
    const raw = fontDict.get(name);
    const fd = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
    if (!(fd instanceof PDFDict)) continue;
    const refKey = raw instanceof PDFRef ? raw.toString() : `inline:${pi}:${name.toString()}`;
    if (seenFontRefs.has(refKey)) continue;
    seenFontRefs.add(refKey);

    const baseFont = String(fd.lookup(PDFName.of("BaseFont")) ?? "");
    const hasToUnicode = fd.lookup(PDFName.of("ToUnicode")) instanceof PDFRawStream;
    const enc = summarizeEncoding(fd.lookup(PDFName.of("Encoding")), doc.context);
    let cmapInfo = null,
      postInfo = null,
      sfntErr = null,
      fontKind = null;
    if (!hasToUnicode) {
      const desc = fd.lookup(PDFName.of("FontDescriptor"));
      if (desc instanceof PDFDict) {
        fontKind = fontProgramKind(desc);
        try {
          const ff = fontFile2Bytes(desc, doc.context);
          if (ff) {
            const tables = readTableDir(ff);
            if (tables.cmap) cmapInfo = summarizeCmap(ff, tables.cmap.off, tables.cmap.len);
            else cmapInfo = { numSub: 0, subs: [], stripped: true };
            if (tables.post) postInfo = summarizePost(ff, tables.post.off, tables.post.len);
            else postInfo = { stripped: true };
          }
        } catch (e) {
          sfntErr = String(e);
        }
      }
    }

    reports.push({
      page: pi + 1,
      resource: name.toString(),
      baseFont,
      hasToUnicode,
      fontKind,
      encoding: enc,
      cmap: cmapInfo,
      post: postInfo,
      sfntErr,
    });
  }
}

const verbose = process.argv.includes("--verbose");

const noTU = reports.filter((x) => !x.hasToUnicode);

// "TODO-relevant" = no ToUnicode AND (named-glyph Differences OR stripped cmap
// OR post v2.0 with glyph names that could feed an Adobe glyph-name table).
function looksSynthetic(n) {
  // /g3, /g142, /cid001, /uni0020 etc. — useless for an Adobe-name table.
  return /^\/(g\d+|cid\d+|uni[0-9A-Fa-f]{4,5}|index\d+|glyph\d+)$/.test(n);
}
function looksMaldivianAdobe(n) {
  // Common Adobe glyph names for Thaana / Maldivian: afii577–afii603 (Thaana
  // block) and post-table latin names like "fili", "alif", etc.
  return (
    /^\/afii(577|578|579|580|581|582|583|584|585|586|587|588|589|590|591|592|593|594|595|596|597|598|599|600|601|602|603)/.test(
      n,
    ) ||
    /^\/(fili|sukun|naviyaani|alif|gaaf|seenu|lhaviyani|noonu|raa|baa|haa|kaaf|laamu|meemu|faafu|daalu|thaana|nyaaviyani|gnaviyani|aabaaf)/i.test(
      n,
    )
  );
}
function isTodoRelevant(r) {
  if (r.hasToUnicode) return null;
  const reasons = [];
  if (r.encoding?.kind === "dict" && (r.encoding.diffCount ?? 0) > 0) {
    const names = r.encoding.sampleNames ?? [];
    const realNamed = names.filter((n) => !looksSynthetic(n));
    if (realNamed.length > 0) {
      const malNames = names.filter(looksMaldivianAdobe);
      reasons.push(
        `/Differences (${r.encoding.diffCount} names, ${realNamed.length} real-looking${
          malNames.length ? `, ${malNames.length} Maldivian` : ""
        })`,
      );
    }
  }
  if (r.cmap && (r.cmap.stripped || r.cmap.numSub === 0)) reasons.push("cmap stripped");
  if (r.post && r.post.version && r.post.version.startsWith("2.")) {
    reasons.push(`post v${r.post.version} (${r.post.totalCustomNames ?? 0} custom names)`);
  }
  return reasons.length ? reasons : null;
}

const flagged = noTU.map((r) => ({ r, reasons: isTodoRelevant(r) })).filter((x) => x.reasons);

if (verbose) {
  for (const r of noTU) {
    console.log(JSON.stringify(r, null, 2));
    console.log("---");
  }
}

console.log(`\n=== ${path.basename(PDF)} ===`);
console.log(`Fonts without /ToUnicode: ${noTU.length} / ${reports.length}`);
console.log(
  `TODO-relevant (named-glyph Differences / stripped cmap / post v2.0): ${flagged.length}`,
);
for (const { r, reasons } of flagged) {
  console.log(`  ${r.baseFont}  →  ${reasons.join("; ")}`);
  if (r.encoding?.kind === "dict" && r.encoding.sampleNames?.length)
    console.log(`     diff names: ${r.encoding.sampleNames.join(" ")}`);
  if (r.post?.thaanaLookingNames?.length)
    console.log(
      `     thaana-looking post names: ${r.post.thaanaLookingNames.slice(0, 12).join(" ")}`,
    );
}
