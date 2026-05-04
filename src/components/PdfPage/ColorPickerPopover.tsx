import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  TEXT_COLOR_PRESETS,
  colorToCss,
  colorToHex,
  colorsEqual,
  hexToColor,
} from "../../lib/color";
import type { AnnotationColor } from "../../lib/annotations";
import { useIsMobile } from "../../lib/useMediaQuery";

/** Format-toolbar text-color picker. The trigger is a small swatch
 *  button (filled with the current color); clicking opens a popover
 *  with the preset palette + a hex input.
 *
 *  Why a custom popover instead of HeroUI's: HeroUI's color picker
 *  pulled in enough of react-aria's overlay stack to cause noticeable
 *  jank on a fast machine. This is presets-first anyway — users who
 *  want arbitrary colors type a hex. */
export function ColorPickerPopover({
  value,
  onChange,
}: {
  /** Current text color, 0..1 RGB. Undefined means "no override" —
   *  the swatch renders black (the default) and the grid's Black
   *  preset shows as active. */
  value: AnnotationColor | undefined;
  /** Called when the user picks a preset or commits a valid hex. */
  onChange: (next: AnnotationColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useIsMobile();

  // Close on outside click + Esc. Capture: true so we see the click
  // before any toolbar/overlay handler eats it.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Anchor the popover under the trigger when it opens. Recompute on
  // open so the position picks up any toolbar reflow that happened
  // since the last render (e.g. mobile keyboard show/hide). On mobile
  // the popover is a centered sheet — no anchoring needed.
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!open || isMobile) {
      setAnchor(null);
      return;
    }
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setAnchor({ left: r.left, top: r.bottom + 4 });
  }, [open, isMobile]);

  const swatchCss = colorToCss(value) ?? "#000";
  const labelId = useId();

  const popover = open ? (
    <div
      ref={popoverRef}
      role="dialog"
      aria-labelledby={labelId}
      data-edit-toolbar
      className="border border-zinc-300 bg-white text-zinc-900 shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      style={
        isMobile
          ? {
              position: "fixed",
              left: "50%",
              bottom: 80,
              transform: "translateX(-50%)",
              zIndex: 40,
              borderRadius: 8,
              padding: 12,
              minWidth: 220,
            }
          : {
              position: "fixed",
              left: anchor?.left ?? 0,
              top: anchor?.top ?? 0,
              zIndex: 40,
              borderRadius: 6,
              padding: 8,
              minWidth: 180,
              visibility: anchor ? "visible" : "hidden",
            }
      }
      // Same focus-preservation pattern as the toolbar buttons —
      // clicking inside the popover must not blur the editor input.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div id={labelId} className="sr-only">
        Text color
      </div>
      <SwatchGrid value={value} onPick={(c) => { onChange(c); setOpen(false); }} isMobile={isMobile} />
      <HexInput value={value} onCommit={onChange} />
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Text color"
        aria-haspopup="dialog"
        aria-expanded={open}
        // Match the size + padding of the HeroUI iconOnly buttons
        // adjacent to us so the toolbar row stays tonally consistent.
        className="inline-flex items-center justify-center rounded border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
        style={{
          width: 32,
          height: 32,
          padding: 4,
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        {/* "A" with a colored bar underneath — the standard
            text-color affordance from Word / Docs. */}
        <span aria-hidden style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 700, lineHeight: "12px" }}>A</span>
          <span
            style={{
              width: 16,
              height: 4,
              background: swatchCss,
              borderRadius: 1,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.15) inset",
            }}
          />
        </span>
      </button>
      {popover && typeof document !== "undefined" ? createPortal(popover, document.body) : popover}
    </>
  );
}

function SwatchGrid({
  value,
  onPick,
  isMobile,
}: {
  value: AnnotationColor | undefined;
  onPick: (c: AnnotationColor) => void;
  isMobile: boolean;
}) {
  const swatchSize = isMobile ? 36 : 24;
  return (
    <div
      role="listbox"
      aria-label="Preset text colors"
      style={{
        display: "grid",
        // 4 columns on both — desktop fits 4×2 in ~120px, mobile in ~180px.
        gridTemplateColumns: `repeat(4, ${swatchSize}px)`,
        gap: 6,
        marginBottom: 8,
      }}
    >
      {TEXT_COLOR_PRESETS.map((p) => {
        const active = colorsEqual(value, p.value);
        return (
          <button
            key={p.hex}
            type="button"
            role="option"
            aria-selected={active}
            aria-label={p.label}
            title={`${p.label} (${p.hex})`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(p.value)}
            style={{
              width: swatchSize,
              height: swatchSize,
              padding: 0,
              borderRadius: 4,
              background: p.hex,
              border: active ? "2px solid #2563eb" : "1px solid rgba(0,0,0,0.2)",
              cursor: "pointer",
            }}
          />
        );
      })}
    </div>
  );
}

function HexInput({
  value,
  onCommit,
}: {
  value: AnnotationColor | undefined;
  onCommit: (c: AnnotationColor) => void;
}) {
  // Local draft so the user can type without each keystroke firing
  // onCommit (which would re-key the swatch grid mid-type). Commit on
  // Enter / blur when the draft parses.
  const [draft, setDraft] = useState<string>(value ? colorToHex(value) : "#000000");
  const lastValueRef = useRef(value);
  useEffect(() => {
    // Sync the input when the underlying value changes from outside
    // (e.g. user clicked a preset). Skip when the value didn't change
    // — otherwise typing into the input would get clobbered by a
    // re-render with the previous external value.
    if (value !== lastValueRef.current) {
      setDraft(value ? colorToHex(value) : "#000000");
      lastValueRef.current = value;
    }
  }, [value]);

  const tryCommit = () => {
    const parsed = hexToColor(draft);
    if (parsed) {
      onCommit(parsed);
      setDraft(colorToHex(parsed));
    } else {
      // Reset to the last good value so the input doesn't show a
      // garbage string after the user tabs away.
      setDraft(value ? colorToHex(value) : "#000000");
    }
  };

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span style={{ opacity: 0.7 }}>Hex</span>
      <input
        type="text"
        spellCheck={false}
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            tryCommit();
          }
        }}
        onBlur={tryCommit}
        className="border border-zinc-300 bg-white text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
        style={{
          flex: 1,
          padding: "4px 6px",
          borderRadius: 4,
          fontSize: 12,
          fontFamily: "monospace",
        }}
      />
    </label>
  );
}
