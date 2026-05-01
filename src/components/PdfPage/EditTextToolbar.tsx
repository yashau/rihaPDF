import { Button, ToggleButton as HeroToggleButton } from "@heroui/react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Bold,
  Italic,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import { FONTS } from "../../lib/fonts";
import { useIsMobile } from "../../lib/useMediaQuery";

/** Shared formatting toolbar — font picker, size, B / I / U toggles, X.
 *  Used by both the existing-run EditField and the InsertedTextOverlay
 *  so a brand-new text box has the exact same controls as an inline
 *  edit on a source-PDF run. */
export function EditTextToolbar({
  left,
  top,
  fontFamily,
  fontSize,
  bold,
  italic,
  underline,
  dir,
  onChange,
  onCancel,
  onDelete,
}: {
  /** Viewport-pixel position of the toolbar's top-left corner. */
  left: number;
  top: number;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Explicit text direction. `undefined` = auto-detect from text. */
  dir: "rtl" | "ltr" | undefined;
  onChange: (patch: {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    /** `null` clears an explicit direction back to auto-detect. */
    dir?: "rtl" | "ltr" | null;
  }) => void;
  onCancel?: () => void;
  /** When provided, renders a trash button. Source-run deletion sets
   *  `deleted=true` on the stored EditValue; inserted-text deletion
   *  removes the entry from its slot bucket. */
  onDelete?: () => void;
}) {
  const isMobile = useIsMobile();
  // Mobile: pin to the bottom of the *dynamic* viewport (`100dvh`)
  // instead of the layout viewport (`100vh`). On modern mobile
  // browsers `dvh` shrinks when the soft keyboard opens, so a
  // dvh-anchored bar rides above the keyboard automatically — no
  // visualViewport JS bookkeeping required, and no risk of being
  // hidden behind it. Anchoring with `top: 100dvh` + a translateY of
  // -100% gives us "bottom of the dynamic viewport" without needing
  // the toolbar's own height.
  //
  // Desktop keeps the absolute / page-coord layout near the editor.
  const baseStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        left: 0,
        right: 0,
        top: "100dvh",
        transform: "translateY(-100%)",
        zIndex: 30,
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
        left,
        top,
        zIndex: 30,
        display: "flex",
        gap: 4,
        padding: 4,
        borderRadius: 6,
        alignItems: "center",
        pointerEvents: "auto",
        whiteSpace: "nowrap",
      };
  return (
    <div
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
          ? "border-t border-zinc-300 bg-white text-zinc-900 shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:[color-scheme:dark]"
          : "border border-zinc-300 bg-white text-zinc-900 shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:[color-scheme:dark]"
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
      <select
        aria-label="Font"
        value={fontFamily}
        className="border border-zinc-300 bg-white text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
        style={{
          padding: "4px 6px",
          borderRadius: 4,
          fontSize: 12,
          minWidth: 140,
          // On mobile the font picker takes the full first row so its
          // long names don't truncate; size + B/I/U + ✕ wrap below.
          flexBasis: isMobile ? "100%" : undefined,
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
          padding: "4px 6px",
          borderRadius: 4,
          fontSize: 12,
        }}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange({ fontSize: v });
        }}
      />
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
      {onDelete ? (
        <Button
          isIconOnly
          size="sm"
          variant="danger-soft"
          onPress={() => onDelete()}
          aria-label="Delete text (Del)"
        >
          <Trash2 size={14} />
        </Button>
      ) : null}
      {onCancel ? (
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={() => onCancel()}
          aria-label="Cancel edit"
        >
          <X size={14} />
        </Button>
      ) : null}
    </div>
  );
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
