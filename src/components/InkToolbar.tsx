import { useRef } from "react";
import type { AnnotationColor } from "../lib/annotations";
import { useIsMobile } from "../lib/useMediaQuery";
import { useVisualViewportFollow } from "../lib/useVisualViewport";
import { ColorPickerPopover } from "./PdfPage/ColorPickerPopover";

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
  const isMobile = useIsMobile();
  return isMobile ? (
    <MobileInkBar
      color={color}
      thickness={thickness}
      onColorChange={onColorChange}
      onThicknessChange={onThicknessChange}
    />
  ) : (
    <DesktopInkBar
      color={color}
      thickness={thickness}
      onColorChange={onColorChange}
      onThicknessChange={onThicknessChange}
    />
  );
}

type ControlProps = {
  color: AnnotationColor;
  thickness: number;
  onColorChange: (next: AnnotationColor) => void;
  onThicknessChange: (next: number) => void;
};

/** Desktop: an attached second row directly under the main header.
 *  Sits in the normal document flow (not fixed) so the page list
 *  shifts down by exactly the bar's height while the ink tool is
 *  active — same visual rhythm as the mobile two-row header. */
function DesktopInkBar({ color, thickness, onColorChange, onThicknessChange }: ControlProps) {
  return (
    <div
      data-edit-toolbar
      className="flex items-center gap-4 px-4 py-2 bg-zinc-50 text-zinc-900 border-b border-zinc-200 dark:bg-zinc-850 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-800"
      // Same focus / pointer-stop discipline as the format toolbar so
      // clicking these controls doesn't activate the page-level ink
      // capture surface beneath.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Draw
      </span>
      <InkControls
        color={color}
        thickness={thickness}
        onColorChange={onColorChange}
        onThicknessChange={onThicknessChange}
        compact
      />
    </div>
  );
}

/** Mobile: fixed strip at the bottom of the viewport. Mirrors the
 *  EditTextToolbar's mobile layout (visual viewport follow, safe-area
 *  padding) so it doesn't get covered by the keyboard. */
function MobileInkBar({ color, thickness, onColorChange, onThicknessChange }: ControlProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useVisualViewportFollow(ref, "bottom", true);
  return (
    <div
      ref={ref}
      data-edit-toolbar
      className="border-t border-zinc-300 bg-white text-zinc-900 shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:[color-scheme:dark]"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        display: "flex",
        gap: 12,
        padding: 8,
        paddingBottom: `max(8px, var(--safe-bottom, 0px))`,
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <InkControls
        color={color}
        thickness={thickness}
        onColorChange={onColorChange}
        onThicknessChange={onThicknessChange}
        compact={false}
      />
    </div>
  );
}

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
