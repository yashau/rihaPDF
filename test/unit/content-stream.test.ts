import { describe, expect, it } from "vitest";
import {
  findTextShows,
  parseContentStream,
  serializeContentStream,
} from "@/pdf/content/contentStream";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (value: Uint8Array): string => new TextDecoder("ascii").decode(value);

describe("content stream parser", () => {
  it("decodes comments, escaped names, strings, and odd hex nibbles", () => {
    const ops = parseContentStream(
      bytes(
        "% ignored comment\r\nBT\n/F#201 12 Tf\n(a\\(b\\)\\053\\\r\nc) Tj\n[<41 4> -120 (B)] TJ\nET",
      ),
    );

    expect(ops.map((op) => op.op)).toEqual(["BT", "Tf", "Tj", "TJ", "ET"]);
    expect(ops[1].operands[0]).toEqual({ kind: "name", value: "F 1" });
    expect(ops[2].operands[0]).toEqual({
      kind: "literal-string",
      bytes: bytes("a(b)+c"),
    });

    const tjArray = ops[3].operands[0];
    expect(tjArray?.kind).toBe("array");
    if (tjArray?.kind !== "array") return;
    expect(tjArray.items[0]).toEqual({
      kind: "hex-string",
      bytes: new Uint8Array([0x41, 0x40]),
    });
    expect(tjArray.items[1]).toEqual({ kind: "number", value: -120, raw: "-120" });
    expect(tjArray.items[2]).toEqual({ kind: "literal-string", bytes: bytes("B") });
  });

  it("serializes literal strings with binary-safe escapes", () => {
    const serialized = serializeContentStream([
      {
        op: "Tj",
        operands: [{ kind: "literal-string", bytes: new Uint8Array([0x28, 0x29, 0x5c, 0x0a]) }],
      },
    ]);

    expect(text(serialized)).toBe("(\\(\\)\\\\\\012) Tj\n");
  });

  it("preserves inline images as opaque BI/ID/EI operations", () => {
    const rawInline = "BI /W 1 /H 1 /CS /RGB /BPC 8 ID abc EI";
    const ops = parseContentStream(bytes(`q ${rawInline} Q`));

    expect(ops.map((op) => op.op)).toEqual(["q", "BI", "Q"]);
    expect(text(ops[1].raw ?? new Uint8Array())).toBe(rawInline);
    expect(text(serializeContentStream(ops))).toBe(`q\n${rawInline}\nQ\n`);
  });
});

describe("content stream text-show finder", () => {
  it("restores graphics text state across q/Q", () => {
    const ops = parseContentStream(
      bytes(
        "q 2 Tr BT /F1 10 Tf 1 0 0 1 20 30 Tm (A) Tj ET Q BT /F1 10 Tf 1 0 0 1 40 50 Tm (B) Tj ET",
      ),
    );

    const shows = findTextShows(ops);

    expect(shows).toHaveLength(2);
    expect(shows[0]).toMatchObject({
      fontName: "F1",
      fontSize: 10,
      textMatrix: [1, 0, 0, 1, 20, 30],
      textRenderingMode: 2,
    });
    expect(shows[1]).toMatchObject({
      fontName: "F1",
      fontSize: 10,
      textMatrix: [1, 0, 0, 1, 40, 50],
      textRenderingMode: 0,
    });
  });
});
