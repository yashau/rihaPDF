import { describe, expect, it } from "vitest";
import { displayTextForEditor } from "@/components/PdfPage/rtlDisplayText";

describe("RTL source edit display text", () => {
  it("keeps non-RTL editor text unchanged", () => {
    expect(displayTextForEditor("morning 00:9, test", false)).toBe("morning 00:9, test");
  });

  it("reorders extracted slash dates and colon times for RTL editing", () => {
    expect(displayTextForEditor("ހެނދުނު 00:9 ގައި", true)).toBe("ހެނދުނު 9:00 ގައި");
    expect(displayTextForEditor("ހެނދުނު 00: 9 ގައި", true)).toBe("ހެނދުނު 9:00 ގައި");
    expect(displayTextForEditor("ތާރީޚް 2026/1/14", true)).toBe("ތާރީޚް 14/1/2026");
  });

  it("tightens punctuation gaps without eating the intended following space", () => {
    expect(displayTextForEditor("ބަސް ، ބުދަ ؛ އެއް ؟ ނޫން !", true)).toBe("ބަސް، ބުދަ؛ އެއް؟ ނޫން!");
  });

  it("tightens bracket and quote interiors while preserving the space before an opener", () => {
    expect(displayTextForEditor("ދުވަސް ( ބުރުނު ) [ 8 ]", true)).toBe("ދުވަސް (ބުރުނު) [8]");
  });
});
