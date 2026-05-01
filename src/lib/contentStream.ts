// Minimal PDF content-stream parser + serializer.
//
// Goal: read a page's content stream into a typed list of operations, let
// the caller find / modify / remove specific text-show ops, and emit the
// result back to bytes that pdf-lib stores in the page.
//
// Scope: the operators we actually touch when editing text — text state
// (BT, ET, Tf, Tm, Td, TD, T*), text-show (Tj, TJ, ', "), graphics-state
// stack (q, Q), and a generic "passthrough" for everything else (we keep
// the original bytes verbatim so we never accidentally corrupt non-text
// drawing).
//
// PDF content-stream grammar (per spec §7.8):
//   Whitespace:  0x00 0x09 0x0A 0x0C 0x0D 0x20
//   Delimiters:  ( )  < >  [ ]  / %
//   Tokens:
//     number:        [-+]? digits [. digits]?
//     name:          / nameChars
//     literal str:   ( ... )   with \( \) \\ \n \r \t \b \f, \ddd, \<EOL>
//     hex str:       < hex+ >  (whitespace permitted, odd → trailing 0)
//     array:         [ tokens ]
//     dict:          << ... >>   (rare in content streams; passthrough OK)
//     operator:      bareword (no leading slash, not numeric, not delim)

export type ContentToken =
  | { kind: "number"; value: number; raw: string }
  | { kind: "name"; value: string }
  | { kind: "literal-string"; bytes: Uint8Array }
  | { kind: "hex-string"; bytes: Uint8Array }
  | { kind: "array"; items: ContentToken[] }
  | { kind: "dict"; raw: Uint8Array };

export type ContentOp = {
  /** Operator name, e.g. "Tj", "Tm", "BT". */
  op: string;
  /** Operand tokens, in order. */
  operands: ContentToken[];
};

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITER = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isWS(b: number) {
  return WS.has(b);
}
function isDelim(b: number) {
  return DELIMITER.has(b);
}
function isDigitOrSign(b: number) {
  return (b >= 0x30 && b <= 0x39) || b === 0x2b || b === 0x2d || b === 0x2e;
}

class Tokenizer {
  pos = 0;
  bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  eof(): boolean {
    return this.pos >= this.bytes.length;
  }

  peek(off = 0): number {
    return this.bytes[this.pos + off];
  }

  /** Skip whitespace + comments. */
  skipWS(): void {
    while (!this.eof()) {
      const b = this.bytes[this.pos];
      if (isWS(b)) {
        this.pos++;
      } else if (b === 0x25) {
        // % comment to end of line
        while (!this.eof() && this.bytes[this.pos] !== 0x0a && this.bytes[this.pos] !== 0x0d) {
          this.pos++;
        }
      } else {
        return;
      }
    }
  }

  /** Read until whitespace/delimiter, returning bytes as ASCII string. */
  readBareword(): string {
    const start = this.pos;
    while (!this.eof()) {
      const b = this.bytes[this.pos];
      if (isWS(b) || isDelim(b)) break;
      this.pos++;
    }
    return new TextDecoder("ascii").decode(this.bytes.slice(start, this.pos));
  }

  /** Read a literal string starting at the (. */
  readLiteralString(): Uint8Array {
    if (this.bytes[this.pos] !== 0x28) throw new Error("not a literal string");
    this.pos++; // skip (
    const out: number[] = [];
    let parens = 1;
    while (!this.eof() && parens > 0) {
      const b = this.bytes[this.pos++];
      if (b === 0x5c) {
        // backslash escape
        if (this.eof()) break;
        const n = this.bytes[this.pos++];
        switch (n) {
          case 0x6e:
            out.push(0x0a);
            break; // \n
          case 0x72:
            out.push(0x0d);
            break; // \r
          case 0x74:
            out.push(0x09);
            break; // \t
          case 0x62:
            out.push(0x08);
            break; // \b
          case 0x66:
            out.push(0x0c);
            break; // \f
          case 0x28:
            out.push(0x28);
            break; // \(
          case 0x29:
            out.push(0x29);
            break; // \)
          case 0x5c:
            out.push(0x5c);
            break; // \\
          case 0x0a:
            break; // line continuation
          case 0x0d:
            if (!this.eof() && this.bytes[this.pos] === 0x0a) this.pos++;
            break;
          default:
            if (n >= 0x30 && n <= 0x37) {
              // octal up to 3 digits
              let octal = n - 0x30;
              for (let i = 0; i < 2; i++) {
                if (this.eof()) break;
                const dn = this.bytes[this.pos];
                if (dn < 0x30 || dn > 0x37) break;
                this.pos++;
                octal = octal * 8 + (dn - 0x30);
              }
              out.push(octal & 0xff);
            } else {
              // unknown escape — drop the backslash, keep the char
              out.push(n);
            }
        }
      } else if (b === 0x28) {
        parens++;
        out.push(b);
      } else if (b === 0x29) {
        parens--;
        if (parens > 0) out.push(b);
      } else {
        out.push(b);
      }
    }
    return new Uint8Array(out);
  }

  /** Read a hex string starting at <. Returns the decoded bytes. */
  readHexString(): Uint8Array {
    if (this.bytes[this.pos] !== 0x3c) throw new Error("not a hex string");
    this.pos++; // skip <
    const out: number[] = [];
    let buf = -1;
    while (!this.eof()) {
      const b = this.bytes[this.pos++];
      if (b === 0x3e) {
        if (buf >= 0) out.push(buf << 4);
        return new Uint8Array(out);
      }
      if (isWS(b)) continue;
      let v: number;
      if (b >= 0x30 && b <= 0x39) v = b - 0x30;
      else if (b >= 0x41 && b <= 0x46) v = b - 0x41 + 10;
      else if (b >= 0x61 && b <= 0x66) v = b - 0x61 + 10;
      else continue; // ignore stray
      if (buf < 0) {
        buf = v;
      } else {
        out.push((buf << 4) | v);
        buf = -1;
      }
    }
    if (buf >= 0) out.push(buf << 4);
    return new Uint8Array(out);
  }

  /** Read a name starting at /. Returns the name without the slash. */
  readName(): string {
    if (this.bytes[this.pos] !== 0x2f) throw new Error("not a name");
    this.pos++;
    const start = this.pos;
    while (!this.eof()) {
      const b = this.bytes[this.pos];
      if (isWS(b) || isDelim(b)) break;
      this.pos++;
    }
    // Names support # hex escapes; for content streams we rarely see them.
    let raw = new TextDecoder("ascii").decode(this.bytes.slice(start, this.pos));
    raw = raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    return raw;
  }

  /** Read an array starting at [. */
  readArray(): ContentToken[] {
    if (this.bytes[this.pos] !== 0x5b) throw new Error("not an array");
    this.pos++;
    const out: ContentToken[] = [];
    while (!this.eof()) {
      this.skipWS();
      if (this.eof()) break;
      if (this.bytes[this.pos] === 0x5d) {
        this.pos++;
        return out;
      }
      out.push(this.readToken());
    }
    return out;
  }

  /** Read whatever's at pos as a non-operator token. */
  readToken(): ContentToken {
    this.skipWS();
    const b = this.bytes[this.pos];
    if (b === 0x28) return { kind: "literal-string", bytes: this.readLiteralString() };
    if (b === 0x3c) {
      // Either <hex> or << (dict)
      if (this.bytes[this.pos + 1] === 0x3c) {
        // dict — passthrough as raw bytes until matching >>
        const start = this.pos;
        let depth = 0;
        while (!this.eof()) {
          const c = this.bytes[this.pos];
          if (c === 0x3c && this.bytes[this.pos + 1] === 0x3c) {
            depth++;
            this.pos += 2;
          } else if (c === 0x3e && this.bytes[this.pos + 1] === 0x3e) {
            depth--;
            this.pos += 2;
            if (depth === 0) break;
          } else {
            this.pos++;
          }
        }
        return { kind: "dict", raw: this.bytes.slice(start, this.pos) };
      }
      return { kind: "hex-string", bytes: this.readHexString() };
    }
    if (b === 0x5b) return { kind: "array", items: this.readArray() };
    if (b === 0x2f) return { kind: "name", value: this.readName() };
    if (isDigitOrSign(b)) {
      const raw = this.readBareword();
      const n = Number(raw);
      if (!Number.isNaN(n)) return { kind: "number", value: n, raw };
      // It looked numeric but parsed NaN — treat as operator? caller decides
      throw new Error(`Bad number token: ${raw}`);
    }
    // Otherwise it's a bareword — operators are handled by parseContentStream.
    throw new Error(`Unexpected token start byte 0x${b.toString(16)} at ${this.pos}`);
  }
}

/** Parse content-stream bytes into a list of operations. */
export function parseContentStream(bytes: Uint8Array): ContentOp[] {
  const tk = new Tokenizer(bytes);
  const ops: ContentOp[] = [];
  let operands: ContentToken[] = [];
  while (!tk.eof()) {
    tk.skipWS();
    if (tk.eof()) break;
    const b = tk.peek();
    if (b === 0x28 || b === 0x3c || b === 0x5b || b === 0x2f || isDigitOrSign(b)) {
      operands.push(tk.readToken());
      continue;
    }
    // Bareword — could be an operator or a keyword like true/false/null.
    const word = tk.readBareword();
    if (word === "true" || word === "false") {
      operands.push({ kind: "number", value: word === "true" ? 1 : 0, raw: word });
      continue;
    }
    if (word === "null") {
      operands.push({ kind: "number", value: 0, raw: "null" });
      continue;
    }
    if (word.length === 0) {
      // Stuck — bail out to avoid infinite loop.
      tk.pos++;
      continue;
    }
    ops.push({ op: word, operands });
    operands = [];
  }
  // Trailing operands without an operator → discard (malformed but tolerant).
  return ops;
}

const NUM_FMT = (n: number): string => {
  if (Number.isInteger(n)) return n.toString();
  // Limit to 6 decimals to keep output compact.
  return parseFloat(n.toFixed(6)).toString();
};

function serializeToken(t: ContentToken): Uint8Array {
  switch (t.kind) {
    case "number":
      return new TextEncoder().encode(NUM_FMT(t.value));
    case "name":
      return new TextEncoder().encode(`/${t.value}`);
    case "hex-string": {
      let s = "<";
      for (const b of t.bytes) s += b.toString(16).padStart(2, "0");
      s += ">";
      return new TextEncoder().encode(s);
    }
    case "literal-string": {
      // Escape ( ) and \, leave everything else as-is. Keep binary safe by
      // encoding each non-printable as its octal escape.
      const parts: number[] = [];
      parts.push(0x28); // (
      for (const b of t.bytes) {
        if (b === 0x28 || b === 0x29 || b === 0x5c) {
          parts.push(0x5c, b);
        } else if (b < 0x20 || b > 0x7e) {
          parts.push(0x5c);
          const oct = b.toString(8).padStart(3, "0");
          for (const c of oct) parts.push(c.charCodeAt(0));
        } else {
          parts.push(b);
        }
      }
      parts.push(0x29);
      return new Uint8Array(parts);
    }
    case "array": {
      const inner = t.items
        .map(serializeToken)
        .map((u) => new TextDecoder("latin1").decode(u))
        .join(" ");
      return new TextEncoder().encode(`[${inner}]`);
    }
    case "dict":
      return t.raw;
  }
}

/** Serialize a list of operations back to bytes. */
export function serializeContentStream(ops: ContentOp[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const space = new Uint8Array([0x20]);
  const newline = new Uint8Array([0x0a]);
  for (const op of ops) {
    for (let i = 0; i < op.operands.length; i++) {
      chunks.push(serializeToken(op.operands[i]));
      chunks.push(space);
    }
    chunks.push(new TextEncoder().encode(op.op));
    chunks.push(newline);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Convenience: walk operations tracking text state so callers can match
 *  Tj/TJ ops by current font + position without re-implementing the state
 *  machine. Yields { op, fontName, fontSize, textMatrix } for each text-show. */
export type TextShowMatch = {
  /** Index into the original ops array. */
  index: number;
  op: ContentOp;
  fontName: string | null;
  fontSize: number;
  /** Current text matrix [a b c d e f] at the time of show. */
  textMatrix: [number, number, number, number, number, number];
  /** Active Text Rendering Mode (Tr) when the show ran. 0 = fill (default),
   *  1 = stroke, 2 = fill+stroke (Office uses this to simulate bold for
   *  fonts without a Bold variant), 3 = invisible, 4-7 = clipping. */
  textRenderingMode: number;
};

export function findTextShows(ops: ContentOp[]): TextShowMatch[] {
  let fontName: string | null = null;
  let fontSize = 0;
  let textRenderingMode = 0;
  // Identity matrix.
  let tm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  let tlm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

  // Text state lives inside the graphics state, so q/Q DOES push and
  // pop it (PDF §8.4.1 + §9.3.1 — `Tr`, `Tf`, `Tfs` are listed under
  // graphics state). Office output relies on this: it sets `Tr 2`
  // (fill+stroke fake-bold) inside a q…Q for an actually-bold Tj and
  // never emits an explicit `Tr 0` reset, expecting Q to undo the
  // mode. Without a stack here we'd carry Tr=2 across the whole page
  // and mis-flag every later show as bold.
  const stateStack: {
    tm: typeof tm;
    tlm: typeof tlm;
    fontName: string | null;
    fontSize: number;
    textRenderingMode: number;
  }[] = [];

  const result: TextShowMatch[] = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    switch (o.op) {
      case "q":
        stateStack.push({
          tm: [...tm],
          tlm: [...tlm],
          fontName,
          fontSize,
          textRenderingMode,
        });
        break;
      case "Q": {
        const popped = stateStack.pop();
        if (popped) {
          tm = popped.tm;
          tlm = popped.tlm;
          fontName = popped.fontName;
          fontSize = popped.fontSize;
          textRenderingMode = popped.textRenderingMode;
        }
        break;
      }
      case "BT":
        tm = [1, 0, 0, 1, 0, 0];
        tlm = [1, 0, 0, 1, 0, 0];
        break;
      case "Tr": {
        const arg = o.operands[0];
        if (arg?.kind === "number") textRenderingMode = arg.value;
        break;
      }
      case "Tf": {
        const [name, size] = o.operands;
        if (name?.kind === "name") fontName = name.value;
        if (size?.kind === "number") fontSize = size.value;
        break;
      }
      case "Tm": {
        if (o.operands.length === 6 && o.operands.every((x) => x.kind === "number")) {
          tm = o.operands.map((x) => (x as { value: number }).value) as typeof tm;
          tlm = [...tm];
        }
        break;
      }
      case "Td":
      case "TD": {
        if (
          o.operands.length === 2 &&
          o.operands[0].kind === "number" &&
          o.operands[1].kind === "number"
        ) {
          const tx = o.operands[0].value;
          const ty = o.operands[1].value;
          // text matrix translation in text space:
          //   tlm := [1 0 0 1 tx ty] * tlm
          tlm = [
            tlm[0],
            tlm[1],
            tlm[2],
            tlm[3],
            tx * tlm[0] + ty * tlm[2] + tlm[4],
            tx * tlm[1] + ty * tlm[3] + tlm[5],
          ];
          tm = [...tlm];
        }
        break;
      }
      case "T*": {
        // Like 0 -leading Td. We don't track leading; skip.
        break;
      }
      case "'":
      case '"':
      case "Tj":
      case "TJ":
        result.push({
          index: i,
          op: o,
          fontName,
          fontSize,
          textMatrix: [...tm],
          textRenderingMode,
        });
        break;
    }
  }
  return result;
}
