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
} from "../../lib/color";
import type { AnnotationColor } from "../../lib/annotations";
import { useIsMobile } from "../../lib/useMediaQuery";

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

  // Anchor the popover under the trigger. Computed in the open-press
  // handler so the rect reflects any toolbar reflow at the moment the
  // user opens it (e.g. mobile keyboard show/hide). On mobile the
  // popover is a centered sheet — no anchoring needed, the anchor is
  // simply ignored by the mobile style branch.
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

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
            if (!open && !isMobile) {
              const r = triggerRef.current?.getBoundingClientRect();
              setAnchor(r ? { left: r.left, top: r.bottom + 4 } : null);
            }
            setOpen((v) => !v);
          }}
          // Same focus-preservation pattern as every other toolbar
          // button: don't let the click steal focus from the editor
          // input that mounted us.
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* U+25A0 BLACK SQUARE rendered in the active color — sits
              inside the standard HeroUI button frame so the toolbar
              row stays tonally consistent with the B/I/U buttons. The
              text-shadow gives a near-white swatch a tiny dark edge so
              it doesn't disappear against the button's white fill. */}
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
        </Button>
      </span>
      {popover && typeof document !== "undefined" ? createPortal(popover, document.body) : popover}
    </>
  );
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
