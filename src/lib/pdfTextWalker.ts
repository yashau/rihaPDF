import type { ContentOp } from "./contentStream";

export type PdfTextState = {
  tm: [number, number, number, number, number, number];
  tlm: [number, number, number, number, number, number];
  fontName: string | null;
  fontSize: number;
  Tc: number;
  Tw: number;
  Th: number;
  TL: number;
};

export type TextShowSegment =
  | { kind: "string"; bytes: Uint8Array }
  | { kind: "spacer"; value: number };

export type TextShowVisit = {
  op: ContentOp;
  opIndex: number;
  state: PdfTextState;
  stringOperandIndex: number;
  segments: TextShowSegment[] | null;
};

export function freshTextState(): PdfTextState {
  return {
    tm: [1, 0, 0, 1, 0, 0],
    tlm: [1, 0, 0, 1, 0, 0],
    fontName: null,
    fontSize: 0,
    Tc: 0,
    Tw: 0,
    Th: 1,
    TL: 0,
  };
}

export function cloneTextState(s: PdfTextState): PdfTextState {
  return {
    tm: [...s.tm] as PdfTextState["tm"],
    tlm: [...s.tlm] as PdfTextState["tlm"],
    fontName: s.fontName,
    fontSize: s.fontSize,
    Tc: s.Tc,
    Tw: s.Tw,
    Th: s.Th,
    TL: s.TL,
  };
}

export function applyTextTd(s: PdfTextState, tx: number, ty: number): void {
  const [a, b, c, d, e, f] = s.tlm;
  s.tlm = [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
  s.tm = [...s.tlm];
}

export function parseTextShowSegments(
  op: ContentOp,
  stringOperandIndex = 0,
): TextShowSegment[] | null {
  const segments: TextShowSegment[] = [];
  if (op.op === "TJ") {
    const arr = op.operands[0];
    if (arr?.kind !== "array") return null;
    for (const item of arr.items) {
      if (item.kind === "literal-string" || item.kind === "hex-string") {
        segments.push({ kind: "string", bytes: item.bytes });
      } else if (item.kind === "number") {
        segments.push({ kind: "spacer", value: item.value });
      } else {
        return null;
      }
    }
    return segments;
  }
  const str = op.operands[stringOperandIndex];
  if (!str || (str.kind !== "literal-string" && str.kind !== "hex-string")) return null;
  segments.push({ kind: "string", bytes: str.bytes });
  return segments;
}

export function walkTextShows(ops: ContentOp[], onShow: (visit: TextShowVisit) => void): void {
  let s = freshTextState();
  const stack: PdfTextState[] = [];

  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    switch (o.op) {
      case "q":
        stack.push(cloneTextState(s));
        break;
      case "Q": {
        const popped = stack.pop();
        if (popped) s = popped;
        break;
      }
      case "BT":
        s.tm = [1, 0, 0, 1, 0, 0];
        s.tlm = [1, 0, 0, 1, 0, 0];
        break;
      case "Tf": {
        const [name, size] = o.operands;
        if (name?.kind === "name") s.fontName = name.value;
        if (size?.kind === "number") s.fontSize = size.value;
        break;
      }
      case "Tc":
        if (o.operands[0]?.kind === "number") s.Tc = o.operands[0].value;
        break;
      case "Tw":
        if (o.operands[0]?.kind === "number") s.Tw = o.operands[0].value;
        break;
      case "Tz":
        if (o.operands[0]?.kind === "number") s.Th = o.operands[0].value / 100;
        break;
      case "TL":
        if (o.operands[0]?.kind === "number") s.TL = o.operands[0].value;
        break;
      case "Tm":
        if (o.operands.length === 6 && o.operands.every((x) => x.kind === "number")) {
          s.tm = o.operands.map((x) => (x as { value: number }).value) as PdfTextState["tm"];
          s.tlm = [...s.tm];
        }
        break;
      case "Td":
      case "TD":
        if (
          o.operands.length === 2 &&
          o.operands[0].kind === "number" &&
          o.operands[1].kind === "number"
        ) {
          const tx = o.operands[0].value;
          const ty = o.operands[1].value;
          if (o.op === "TD") s.TL = -ty;
          applyTextTd(s, tx, ty);
        }
        break;
      case "T*":
        applyTextTd(s, 0, -s.TL);
        break;
      case "'":
      case '"':
      case "Tj":
      case "TJ": {
        let stringOperandIndex = 0;
        if (o.op === "'") {
          applyTextTd(s, 0, -s.TL);
        } else if (o.op === '"') {
          if (o.operands[0]?.kind === "number") s.Tw = o.operands[0].value;
          if (o.operands[1]?.kind === "number") s.Tc = o.operands[1].value;
          applyTextTd(s, 0, -s.TL);
          stringOperandIndex = 2;
        }
        onShow({
          op: o,
          opIndex: i,
          state: cloneTextState(s),
          stringOperandIndex,
          segments: parseTextShowSegments(o, stringOperandIndex),
        });
        break;
      }
    }
  }
}
