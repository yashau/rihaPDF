import { useRef } from "react";
import type { AnnotationColor } from "../lib/annotations";
import { HIGHLIGHT_COLOR_PRESETS } from "../lib/color";
import { useIsMobile } from "../lib/useMediaQuery";
import { useVisualViewportFollow } from "../lib/useVisualViewport";
import { ColorPickerPopover } from "./PdfPage/ColorPickerPopover";

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
  const isMobile = useIsMobile();
  return isMobile ? (
    <MobileCommentBar color={color} onColorChange={onColorChange} />
  ) : (
    <DesktopCommentBar color={color} onColorChange={onColorChange} />
  );
}

type ControlProps = {
  color: AnnotationColor;
  onColorChange: (next: AnnotationColor) => void;
};

function DesktopCommentBar({ color, onColorChange }: ControlProps) {
  return (
    <div
      data-edit-toolbar
      className="flex items-center gap-4 px-4 py-2 bg-zinc-50 text-zinc-900 border-b border-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-800"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Comment
      </span>
      <CommentControls color={color} onColorChange={onColorChange} />
    </div>
  );
}

function MobileCommentBar({ color, onColorChange }: ControlProps) {
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
      <CommentControls color={color} onColorChange={onColorChange} />
    </div>
  );
}

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
