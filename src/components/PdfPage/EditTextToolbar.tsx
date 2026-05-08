import { Button, ToggleButton as HeroToggleButton } from "@heroui/react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Bold,
  Italic,
  Strikethrough,
  Trash2,
  Underline,
} from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import type { AnnotationColor } from "@/domain/annotations";
import { FONTS } from "@/pdf/text/fonts";
import { useIsMobile } from "@/platform/hooks/useMediaQuery";
import { useVisualViewportFollow } from "@/platform/hooks/useVisualViewport";
import { ColorPickerPopover } from "./ColorPickerPopover";

const DESKTOP_TOOLBAR_WIDTH_PX = 520;
const DESKTOP_TOOLBAR_MARGIN_PX = 4;

/** Shared formatting toolbar — font picker, size, B / I / U toggles.
 *  Used by both the existing-run EditField and the InsertedTextOverlay
 *  so a brand-new text box has the exact same controls as an inline
 *  edit on a source-PDF run.
 *
 *  No discard / cancel button: clicking outside commits in both
 *  surfaces, and the global undo button reverses any unintended
 *  commit. Keeping commit-on-outside-click as the only close
 *  affordance avoids two competing "close" buttons on mobile. */
export function EditTextToolbar({
  left,
  top,
  fontFamily,
  fontSize,
  bold,
  italic,
  underline,
  strikethrough,
  dir,
  color,
  thaanaInput,
  onThaanaInputChange,
  onChange,
  onDelete,
  boundaryWidth,
}: {
  /** Viewport-pixel position of the toolbar's top-left corner. */
  left: number;
  top: number;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** Explicit text direction. `undefined` = auto-detect from text. */
  dir: "rtl" | "ltr" | undefined;
  /** Current text fill color, 0..1 RGB. Undefined = no override
   *  (renders black). The picker shows the active swatch + hex
   *  reflecting this value. */
  color?: AnnotationColor;
  /** Mobile-only DV/EN toggle. When `true`, the input transliterates
   *  Latin keystrokes to Thaana; when `false`, the input takes raw
   *  Latin / system-keyboard text. The button is only rendered on
   *  mobile (toolbar reads `useIsMobile()` internally). */
  thaanaInput?: boolean;
  onThaanaInputChange?: (next: boolean) => void;
  onChange: (patch: {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    /** `null` clears an explicit direction back to auto-detect. */
    dir?: "rtl" | "ltr" | null;
    color?: AnnotationColor;
  }) => void;
  /** When provided, renders a trash button. Source-run deletion sets
   *  `deleted=true` on the stored EditValue; inserted-text deletion
   *  removes the entry from its slot bucket. */
  onDelete?: () => void;
  /** Page-local width used to keep the desktop toolbar inside the
   *  clipping page wrapper. Mobile portals to the body and ignores it. */
  boundaryWidth?: number;
}) {
  const isMobile = useIsMobile();
  // Mobile: pin to the visual-viewport bottom (above the keyboard,
  // surviving pinch-zoom). `useVisualViewportFollow` writes the
  // visualViewport-driven transform / origin onto this ref; we just
  // place the toolbar at `bottom: 0` of the layout viewport and let
  // the transform translate it up by the keyboard inset and counter-
  // scale it so it stays at constant visual size when the user
  // pinch-zooms the page. Desktop keeps the absolute / page-coord
  // layout near the editor.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  useVisualViewportFollow(toolbarRef, "bottom", isMobile);
  const desktopWouldOverflow =
    boundaryWidth !== undefined &&
    left + DESKTOP_TOOLBAR_WIDTH_PX + DESKTOP_TOOLBAR_MARGIN_PX > boundaryWidth;
  const desktopMaxWidth =
    boundaryWidth === undefined
      ? undefined
      : Math.max(0, boundaryWidth - DESKTOP_TOOLBAR_MARGIN_PX * 2);
  const baseStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 70,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: 8,
        paddingBottom: `max(8px, var(--safe-bottom, 0px))`,
        alignItems: "center",
        pointerEvents: "auto",
      }
    : {
        position: "absolute",
        left: desktopWouldOverflow ? undefined : Math.max(DESKTOP_TOOLBAR_MARGIN_PX, left),
        right: desktopWouldOverflow ? DESKTOP_TOOLBAR_MARGIN_PX : undefined,
        top,
        zIndex: 70,
        display: "flex",
        maxWidth: desktopMaxWidth,
        flexWrap: "wrap",
        gap: 4,
        padding: 4,
        borderRadius: 6,
        alignItems: "center",
        pointerEvents: "auto",
        whiteSpace: "nowrap",
      };
  const node = (
    <div
      ref={toolbarRef}
      data-edit-toolbar
      // Theme-aware colours: HeroUI's ToggleButton honours the `.dark`
      // class (added by useTheme()) and renders dark fills there. The
      // wrapper used to hard-code `background: "white"`, which made the
      // panel jarringly bright around dark-filled buttons when the user
      // was in dark mode (the "all toggled, font empty" symptom). Match
      // the rest of the chrome (PageSidebar tile / sidebar) by switching
      // to Tailwind dark-variants. `color-scheme: dark` on the wrapper
      // also makes the native <select> dropdown arrow + <input>
      // up/down spinner pick the OS dark UI.
      //
      // Mobile drops the rounded corners (it's a full-width strip) and
      // adds a top border to delineate it from the page content above.
      className={
        isMobile
          ? "border-t border-zinc-300 bg-white text-zinc-900 shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:scheme-dark"
          : "border border-zinc-300 bg-white text-zinc-900 shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:scheme-dark"
      }
      style={baseStyle}
      // We do NOT preventDefault on pointerdown here — the native
      // <select> dropdown won't open if its focus change is suppressed.
      // Instead each input's onBlur checks `relatedTarget`: if the new
      // focus target lives inside `[data-edit-toolbar]`, the editor
      // stays open. See `isFocusMovingToToolbar` below.
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      {/* Mobile: font picker + size share row 1 (sub-flex with
          flexBasis:100%) so the long font names don't truncate while
          keeping size adjacent. Desktop: inline siblings. */}
      <div
        style={
          isMobile
            ? { display: "flex", gap: 6, flexBasis: "100%", alignItems: "center" }
            : { display: "contents" }
        }
      >
        <select
          aria-label="Font"
          value={fontFamily}
          className="border border-zinc-300 bg-white text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
          style={{
            padding: "4px 6px",
            borderRadius: 4,
            fontSize: 12,
            minWidth: 140,
            flex: isMobile ? 1 : undefined,
          }}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
        >
          {FONTS.map((f) => (
            <option key={f.family} value={f.family}>
              {f.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Font size"
          type="number"
          min={6}
          max={144}
          step={1}
          value={Math.round(fontSize)}
          className="border border-zinc-300 bg-white text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
          style={{
            width: 56,
            flexShrink: 0,
            padding: "4px 6px",
            borderRadius: 4,
            fontSize: 12,
          }}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange({ fontSize: v });
          }}
        />
      </div>
      <StyleToggle
        label="Bold"
        isSelected={bold}
        onChange={(v) => onChange({ bold: v })}
        icon={<Bold size={14} strokeWidth={2.5} />}
      />
      <StyleToggle
        label="Italic"
        isSelected={italic}
        onChange={(v) => onChange({ italic: v })}
        icon={<Italic size={14} />}
      />
      <StyleToggle
        label="Underline"
        isSelected={underline}
        onChange={(v) => onChange({ underline: v })}
        icon={<Underline size={14} />}
      />
      <StyleToggle
        label="Strikethrough"
        isSelected={strikethrough}
        onChange={(v) => onChange({ strikethrough: v })}
        icon={<Strikethrough size={14} />}
      />
      {/* Text color picker — preset swatches + hex input. Sits between
          the inline style toggles and the direction button so it's
          adjacent to the formatting controls users reach for together. */}
      <ColorPickerPopover
        value={color}
        onChange={(c) => onChange({ color: c })}
        ariaLabel="Text color"
        trigger="text"
      />
      {/* Direction button — cycles auto → rtl → ltr → auto. Lets the
          user override the codepoint-based auto-detection used by the
          overlay (`dir="auto"`) and the save path. Useful when the
          string is a mix or all-digits that the auto-detector
          misclassifies (a digit-only run inside a Dhivehi paragraph
          that should stay RTL, for example). */}
      <Button
        isIconOnly
        size="sm"
        variant={dir === undefined ? "ghost" : "primary"}
        // Pass `null` to clear back to auto so the receiver can
        // distinguish "no change" (key missing from patch) from
        // "explicitly clear".
        onPress={() => {
          const next = dir === undefined ? "rtl" : dir === "rtl" ? "ltr" : null;
          onChange({ dir: next });
        }}
        aria-label={
          dir === "rtl"
            ? "Direction: right-to-left (click for left-to-right)"
            : dir === "ltr"
              ? "Direction: left-to-right (click for auto)"
              : "Direction: auto (click for right-to-left)"
        }
        // HeroUI ToggleButton suppresses focus shift via onMouseDown
        // preventDefault — we need the same so clicking direction
        // doesn't blur the editor input mid-edit.
        onMouseDown={(e) => e.preventDefault()}
      >
        {dir === "rtl" ? (
          <ArrowLeft size={14} />
        ) : dir === "ltr" ? (
          <ArrowRight size={14} />
        ) : (
          <ArrowLeftRight size={14} />
        )}
      </Button>
      {/* Mobile-only DV / EN input-mode toggle. DV = phonetic Latin →
          Thaana transliteration on every keystroke (so a user with the
          OS English keyboard can still type Thaana into a Faruma run);
          EN = raw passthrough for typing Latin or for users with a
          real Dhivehi system keyboard. Hidden on desktop and when the
          parent doesn't pass the prop. */}
      {isMobile && thaanaInput !== undefined && onThaanaInputChange ? (
        <Button
          size="sm"
          variant={thaanaInput ? "primary" : "ghost"}
          onPress={() => onThaanaInputChange(!thaanaInput)}
          onMouseDown={(e) => e.preventDefault()}
          aria-label={
            thaanaInput
              ? "Thaana phonetic input (click to type Latin)"
              : "Latin input (click to type Thaana)"
          }
          style={{ minWidth: 44, fontWeight: 600, fontSize: 12 }}
        >
          {thaanaInput ? "DV" : "EN"}
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          isIconOnly
          size="sm"
          variant="danger-soft"
          onPress={() => onDelete()}
          aria-label="Delete text (Del)"
          // Mobile: push to the right edge of row 2 so it's reachable
          // by the thumb that's already over there. `marginLeft: auto`
          // on a flex item eats the leftover row space. Desktop keeps
          // its inline placement.
          style={isMobile ? { marginLeft: "auto" } : undefined}
        >
          <Trash2 size={14} />
        </Button>
      ) : null}
    </div>
  );
  // Mobile: portal to document.body so `position: fixed` actually
  // anchors to the visual viewport. Inline rendering puts the toolbar
  // inside the per-page `transform: scale(...)` wrapper used for fit-
  // to-width, and per CSS spec a transform creates a containing block
  // for fixed-position descendants — so `top: 100dvh` lands inside
  // that scaled box (somewhere mid-page) rather than at the bottom of
  // the viewport. Desktop keeps inline rendering since it positions
  // absolutely against the page anyway.
  if (isMobile && typeof document !== "undefined") {
    return createPortal(node, document.body);
  }
  return node;
}

/** Wrapper around HeroUI's ToggleButton that suppresses focus-shift on
 *  mousedown — the editor's input must keep focus when the user clicks
 *  B/I/U, otherwise typing breaks mid-style. */
function StyleToggle({
  label,
  isSelected,
  onChange,
  icon,
}: {
  label: string;
  isSelected: boolean;
  onChange: (v: boolean) => void;
  icon: React.ReactNode;
}) {
  return (
    <HeroToggleButton
      isIconOnly
      size="sm"
      isSelected={isSelected}
      onChange={onChange}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
    >
      {icon}
    </HeroToggleButton>
  );
}
