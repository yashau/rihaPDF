import type { AnnotationColor } from "@/domain/annotations";
import { HIGHLIGHT_COLOR_PRESETS } from "@/domain/color";
import { ColorPickerPopover } from "./PdfPage/ColorPickerPopover";
import { ToolOptionsBar } from "./ToolOptionsBar";

/** Options bar for the comment tool. Mirrors `HighlightToolbar` /
 *  `InkToolbar`: desktop renders a second header row attached under
 *  AppHeader; mobile renders a fixed bottom strip. Only the comment
 *  rect's BACKGROUND color is configurable here — the inline text
 *  inside a comment box stays black on whatever fill the user picks
 *  (highlighter palette, so dark text stays legible). */
export function CommentToolbar({
  color,
  onColorChange,
}: {
  color: AnnotationColor;
  onColorChange: (next: AnnotationColor) => void;
}) {
  return (
    <ToolOptionsBar label="Comment">
      <CommentControls color={color} onColorChange={onColorChange} />
    </ToolOptionsBar>
  );
}

type ControlProps = {
  color: AnnotationColor;
  onColorChange: (next: AnnotationColor) => void;
};

function CommentControls({ color, onColorChange }: ControlProps) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ opacity: 0.75 }}>Background</span>
      <ColorPickerPopover
        value={color}
        onChange={onColorChange}
        presets={HIGHLIGHT_COLOR_PRESETS}
        ariaLabel="Comment background color"
      />
    </label>
  );
}
