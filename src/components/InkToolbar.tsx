import type { AnnotationColor } from "@/domain/annotations";
import { ColorPickerPopover } from "./PdfPage/ColorPickerPopover";
import { ToolOptionsBar } from "./ToolOptionsBar";

/** Options bar for the ink tool. Renders in two shapes:
 *
 *   Desktop: a second header row directly under AppHeader, full-width
 *            with the controls left-aligned to sit near the Draw
 *            button that opened them.
 *   Mobile : a bottom-pinned fixed strip above the soft keyboard, in
 *            the same place as the EditTextToolbar's mobile layout so
 *            users see ink options where they expect them.
 *
 *  Only mounted while `tool === "ink"`; App handles the conditional
 *  render. */
export function InkToolbar({
  color,
  thickness,
  onColorChange,
  onThicknessChange,
}: {
  color: AnnotationColor;
  /** Stroke width in PDF points. The InkLayer multiplies by pageScale
   *  for SVG rendering and saves the raw value into the /Ink /BS dict. */
  thickness: number;
  onColorChange: (next: AnnotationColor) => void;
  onThicknessChange: (next: number) => void;
}) {
  return (
    <ToolOptionsBar
      label="Draw"
      mobileChildren={
        <InkControls
          color={color}
          thickness={thickness}
          onColorChange={onColorChange}
          onThicknessChange={onThicknessChange}
          compact={false}
        />
      }
    >
      <InkControls
        color={color}
        thickness={thickness}
        onColorChange={onColorChange}
        onThicknessChange={onThicknessChange}
        compact
      />
    </ToolOptionsBar>
  );
}

type ControlProps = {
  color: AnnotationColor;
  thickness: number;
  onColorChange: (next: AnnotationColor) => void;
  onThicknessChange: (next: number) => void;
};

/** Shared color + thickness controls. `compact` shrinks the slider
 *  width on desktop where horizontal space is tighter alongside the
 *  inline labels. */
function InkControls({
  color,
  thickness,
  onColorChange,
  onThicknessChange,
  compact,
}: ControlProps & { compact: boolean }) {
  return (
    <>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <span style={{ opacity: 0.75 }}>Color</span>
        <ColorPickerPopover value={color} onChange={onColorChange} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <span style={{ opacity: 0.75 }}>Thickness</span>
        <input
          type="range"
          min={0.5}
          max={10}
          step={0.5}
          value={thickness}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onThicknessChange(v);
          }}
          aria-label="Stroke thickness"
          // Generous on mobile (touch dragging) and tighter on desktop
          // where mouse precision means a smaller track is fine.
          style={{ width: compact ? 120 : 140 }}
        />
        <span
          aria-hidden
          style={{
            // Fixed-width readout so the slider doesn't jiggle as the
            // value's digit count changes.
            display: "inline-block",
            minWidth: 28,
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {thickness.toFixed(1)}
        </span>
      </label>
    </>
  );
}
