import { Button } from "@heroui/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  TEXT_COLOR_PRESETS,
  colorToCss,
  colorToHex,
  colorsEqual,
  hexToColor,
  type ColorPreset,
} from "@/domain/color";
import type { AnnotationColor } from "@/domain/annotations";
import { useIsMobile } from "@/platform/hooks/useMediaQuery";

/** Universal color picker — the trigger button IS the swatch (whole
 *  face filled with the current color), clicking opens a popover with
 *  a preset grid + a hex input.
 *
 *  Why a custom popover instead of HeroUI's: HeroUI's color picker
 *  pulled in enough of react-aria's overlay stack to cause noticeable
 *  jank on a fast machine. This is presets-first anyway — users who
 *  want arbitrary colors type a hex.
 *
 *  Reused by the format toolbar (text colors, dark presets), the ink
 *  toolbar (any color), and the highlight toolbar (light presets) —
 *  the `presets` prop swaps the swatch grid; the trigger renders the
 *  CURRENT value regardless. */
export function ColorPickerPopover({
  value,
  onChange,
  presets = TEXT_COLOR_PRESETS,
  ariaLabel = "Color",
  trigger = "swatch",
  placement = "bottom",
}: {
  /** Current color, 0..1 RGB. Undefined means "no override" — the
   *  swatch renders black (the default) and the grid's Black preset
   *  shows as active when present. */
  value: AnnotationColor | undefined;
  /** Called when the user picks a preset or commits a valid hex. */
  onChange: (next: AnnotationColor) => void;
  /** Swatch palette for the popover. Defaults to the dark text-color
   *  preset for backward compatibility with the format toolbar. */
  presets?: ReadonlyArray<ColorPreset>;
  /** aria-label for the trigger button — varies by use site so the
   *  same component can describe itself as "Text color" / "Stroke
   *  color" / "Highlight color" without parent boilerplate. */
  ariaLabel?: string;
  /** Trigger style. Text formatting uses the conventional "A" with a
   *  color bar; annotation/tool pickers keep the plain swatch. */
  trigger?: "swatch" | "text";
  /** Popover placement relative to the trigger. */
  placement?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
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

  // Anchor the popover to the trigger. Computed in the open-press
  // handler so the rect reflects any toolbar reflow at the moment the
  // user opens it (e.g. mobile keyboard show/hide).
  const [anchor, setAnchor] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
  } | null>(null);

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
        anchor
          ? {
              position: "fixed",
              left: anchor.left,
              top: anchor.top,
              bottom: anchor.bottom,
              zIndex: 80,
              borderRadius: isMobile ? 8 : 6,
              padding: isMobile ? 12 : 8,
              width: anchor.width,
            }
          : {
              position: "fixed",
              left: 0,
              top: 0,
              zIndex: 80,
              borderRadius: isMobile ? 8 : 6,
              padding: isMobile ? 12 : 8,
              width: isMobile ? 220 : 180,
              visibility: "hidden",
            }
      }
      // Same focus-preservation pattern as the toolbar buttons —
      // clicking inside the popover must not blur the editor input.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div id={labelId} className="sr-only">
        {ariaLabel}
      </div>
      <SwatchGrid
        value={value}
        presets={presets}
        onPick={(c) => {
          onChange(c);
          setOpen(false);
        }}
        isMobile={isMobile}
      />
      <HexInput value={value} onCommit={onChange} />
    </div>
  ) : null;

  return (
    <>
      {/* Wrapper span owns the bounding-rect ref for popover anchoring
          — HeroUI's Button doesn't forward refs to the DOM element in a
          typed way, and the wrapper has the same box anyway. */}
      <span ref={triggerRef} style={{ display: "inline-flex" }}>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onPress={() => {
            // Measure the trigger before flipping `open` so the popover's
            // first render already has its anchor — avoids the one-frame
            // flash you'd get if we deferred this to a useEffect.
            if (!open) {
              const r = triggerRef.current?.getBoundingClientRect();
              setAnchor(r ? makeAnchor(r, isMobile, placement) : null);
            }
            setOpen((v) => !v);
          }}
          // Same focus-preservation pattern as every other toolbar
          // button: don't let the click steal focus from the editor
          // input that mounted us.
          onMouseDown={(e) => e.preventDefault()}
        >
          {trigger === "text" ? (
            <span
              aria-hidden
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
            >
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
          ) : (
            <span
              aria-hidden
              style={{
                color: swatchCss,
                fontSize: 18,
                lineHeight: 1,
                textShadow: "0 0 1px rgba(0,0,0,0.35)",
              }}
            >
              ■
            </span>
          )}
        </Button>
      </span>
      {popover && typeof document !== "undefined" ? createPortal(popover, document.body) : popover}
    </>
  );
}

function makeAnchor(
  triggerRect: DOMRect,
  isMobile: boolean,
  placement: "top" | "bottom",
): { left: number; top?: number; bottom?: number; width: number } {
  const width = isMobile ? 220 : 180;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || width;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const margin = 8;
  const gap = 6;
  const centeredLeft = triggerRect.left + triggerRect.width / 2 - width / 2;
  const left = Math.min(
    Math.max(margin, centeredLeft),
    Math.max(margin, viewportWidth - width - margin),
  );

  if (placement === "top") {
    return {
      left,
      bottom: Math.max(margin, viewportHeight - triggerRect.top + gap),
      width,
    };
  }
  return {
    left,
    top: triggerRect.bottom + gap,
    width,
  };
}

function SwatchGrid({
  value,
  presets,
  onPick,
  isMobile,
}: {
  value: AnnotationColor | undefined;
  presets: ReadonlyArray<ColorPreset>;
  onPick: (c: AnnotationColor) => void;
  isMobile: boolean;
}) {
  const swatchSize = isMobile ? 36 : 24;
  return (
    <div
      role="listbox"
      aria-label="Preset colors"
      style={{
        display: "grid",
        // 4 columns on both — desktop fits 4×2 in ~120px, mobile in ~180px.
        gridTemplateColumns: `repeat(4, ${swatchSize}px)`,
        gap: 6,
        marginBottom: 8,
      }}
    >
      {presets.map((p) => {
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
