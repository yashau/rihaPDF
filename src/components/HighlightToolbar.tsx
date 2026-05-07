import type { AnnotationColor } from "@/domain/annotations";
import { HIGHLIGHT_COLOR_PRESETS } from "@/domain/color";
import { ColorPickerPopover } from "./PdfPage/ColorPickerPopover";
import { ToolOptionsBar } from "./ToolOptionsBar";

/** Options bar for the highlight tool. Mirrors `InkToolbar`'s shape:
 *  desktop renders a second header row attached under AppHeader;
 *  mobile renders a fixed bottom strip. Only mounted while
 *  `tool === "highlight"`. */
export function HighlightToolbar({
  color,
  onColorChange,
}: {
  color: AnnotationColor;
  onColorChange: (next: AnnotationColor) => void;
}) {
  return (
    <ToolOptionsBar label="Highlight">
      <HighlightControls color={color} onColorChange={onColorChange} />
    </ToolOptionsBar>
  );
}

type ControlProps = {
  color: AnnotationColor;
  onColorChange: (next: AnnotationColor) => void;
};

function HighlightControls({ color, onColorChange }: ControlProps) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ opacity: 0.75 }}>Color</span>
      <ColorPickerPopover
        value={color}
        onChange={onColorChange}
        presets={HIGHLIGHT_COLOR_PRESETS}
        ariaLabel="Highlight color"
      />
    </label>
  );
}
