import { useEffect, useRef, useState } from "react";
import type { TextRun } from "../../lib/pdf";
import type { EditStyle } from "../../lib/save";
import { useThaanaTransliteration } from "../../lib/thaanaKeyboard";
import { useCenterInVisibleViewport } from "../../lib/useVisualViewport";
import { useIsMobile } from "../../lib/useMediaQuery";
import { EditTextToolbar } from "./EditTextToolbar";
import { chooseToolbarTop, hasStyle, isFocusMovingToToolbar } from "./helpers";
import type { EditValue, ToolbarBlocker } from "./types";

export function EditField({
  run,
  pageScale,
  toolbarBlockers,
  initial,
  onCommit,
  onCancel,
  onDelete,
}: {
  run: TextRun;
  /** Viewport pixels per PDF point — used to convert between the
   *  toolbar's user-facing PDF-point size and the CSS pixel size for
   *  rendering. */
  pageScale: number;
  /** Page-local rects the formatting toolbar must avoid — see
   *  `chooseToolbarTop`. The run being edited is included; the helper
   *  filters it out via `selfId`. */
  toolbarBlockers: readonly ToolbarBlocker[];
  initial: EditValue;
  onCommit: (value: EditValue) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [text, setText] = useState(initial.text);
  const isMobile = useIsMobile();
  // Editor opens at the run's CURRENT position (= original bounds + any
  // committed move offset). Otherwise dragging-then-clicking opens the
  // input at the original spot, which is jarring.
  const dx = initial.dx ?? 0;
  const dy = initial.dy ?? 0;
  const [style, setStyle] = useState<EditStyle>(initial.style ?? {});
  const [width, setWidth] = useState<number>(Math.max(run.bounds.width + 24, 80));
  // Mobile DV/EN toggle — DV transliterates Latin keystrokes to Thaana,
  // EN passes through. Default DV since most mobile users hit a Latin
  // keyboard and are editing a Thaana run; the toolbar exposes the flip.
  const [thaanaInput, setThaanaInput] = useState(true);

  // Default everything to the run's source-detected formatting; the
  // toolbar overrides take precedence when explicitly set.
  const effectiveFamily = style.fontFamily ?? run.fontFamily;
  const fontFamilyCss = `"${effectiveFamily}"`;
  const effectiveBold = style.bold ?? run.bold;
  const effectiveItalic = style.italic ?? run.italic;
  // style.fontSize is stored in PDF points (the same unit as the saved
  // PDF). Default to the run's measured height, which buildTextRuns
  // returns in viewport pixels — divide by scale to convert.
  const defaultFontSizePt = run.height / pageScale;
  const fontSizePt = style.fontSize ?? defaultFontSizePt;
  const fontSizePx = fontSizePt * pageScale;

  const remeasure = () => {
    const node = measureRef.current;
    if (!node) return;
    setWidth(Math.max(run.bounds.width, node.offsetWidth) + 24);
  };

  // Mobile-only Latin → Thaana phonetic transliteration so users without
  // a Dhivehi system keyboard can type into Faruma-styled fields. On
  // desktop the user typically has a real Dhivehi keyboard or wants
  // mixed Latin/Thaana flexibility, so the hook is a no-op there. The
  // toolbar's DV/EN toggle flips `thaanaInput` for raw-passthrough
  // typing on mobile (e.g. typing a number or a Latin word).
  useThaanaTransliteration(inputRef, isMobile && thaanaInput);
  // Mobile: scroll so the input sits in the centre of the *visible*
  // viewport (above the keyboard, above the bottom-pinned toolbar).
  // Re-fires on visualViewport changes so it tracks keyboard show/hide.
  useCenterInVisibleViewport(inputRef, isMobile);

  useEffect(() => {
    if (measureRef.current) measureRef.current.textContent = text || " ";
    inputRef.current?.focus();
    inputRef.current?.select();
    remeasure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => onCommit({ text, style: hasStyle(style) ? style : undefined });

  return (
    <>
      <span
        ref={measureRef}
        aria-hidden
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "pre",
          fontFamily: fontFamilyCss,
          fontSize: `${fontSizePx}px`,
          lineHeight: `${run.bounds.height}px`,
          fontWeight: effectiveBold ? 700 : 400,
          fontStyle: effectiveItalic ? "italic" : "normal",
          left: -9999,
          top: -9999,
        }}
      />
      <EditTextToolbar
        left={run.bounds.left - 2 + dx}
        top={chooseToolbarTop({
          editorLeft: run.bounds.left - 2 + dx,
          editorTop: run.bounds.top - 2 + dy,
          editorBottom: run.bounds.top + run.bounds.height + 2 + dy,
          blockers: toolbarBlockers,
          selfId: run.id,
        })}
        fontFamily={effectiveFamily}
        fontSize={fontSizePt}
        bold={effectiveBold}
        italic={effectiveItalic}
        underline={!!style.underline}
        dir={style.dir}
        thaanaInput={thaanaInput}
        onThaanaInputChange={setThaanaInput}
        onChange={(patch) =>
          setStyle((s) => {
            const next: EditStyle = { ...s };
            if (patch.fontFamily !== undefined) next.fontFamily = patch.fontFamily;
            // Toolbar's value is in PDF points — store as-is.
            if (patch.fontSize !== undefined) next.fontSize = patch.fontSize;
            if (patch.bold !== undefined) next.bold = patch.bold;
            if (patch.italic !== undefined) next.italic = patch.italic;
            if (patch.underline !== undefined) next.underline = patch.underline;
            if (patch.dir !== undefined) {
              // null = clear back to auto-detect; "rtl"/"ltr" = override.
              if (patch.dir === null) delete next.dir;
              else next.dir = patch.dir;
            }
            return next;
          })
        }
        onCancel={onCancel}
        onDelete={onDelete}
      />
      <input
        ref={inputRef}
        value={text}
        // Explicit `style.dir` overrides auto-detection (set via the
        // toolbar's direction button); falls back to "auto" so the
        // browser picks based on the text's strong codepoints.
        dir={style.dir ?? "auto"}
        data-run-id={run.id}
        data-editor
        // On mobile + DV mode, suppress the soft keyboard's autocorrect
        // / autocapitalise / spellcheck so each keystroke fires a
        // single-char `insertText` event the transliterator can
        // intercept. EN mode + desktop keep native defaults.
        autoComplete={isMobile && thaanaInput ? "off" : undefined}
        autoCorrect={isMobile && thaanaInput ? "off" : undefined}
        autoCapitalize={isMobile && thaanaInput ? "none" : undefined}
        spellCheck={isMobile && thaanaInput ? false : undefined}
        style={{
          position: "absolute",
          left: run.bounds.left - 2 + dx,
          top: run.bounds.top - 2 + dy,
          width,
          height: run.bounds.height + 4,
          fontFamily: fontFamilyCss,
          fontSize: `${fontSizePx}px`,
          lineHeight: `${run.bounds.height}px`,
          fontWeight: effectiveBold ? 700 : 400,
          fontStyle: effectiveItalic ? "italic" : "normal",
          textDecoration: style.underline ? "underline" : "none",
          padding: "0 4px",
          border: "none",
          outline: "2px solid rgb(59, 130, 246)",
          background: "white",
          // Explicit color + color-scheme so dark mode (`.dark` on <html>)
          // doesn't resolve the UA default input text color to a light
          // tone, which leaves white-on-white text.
          color: "black",
          colorScheme: "light",
          pointerEvents: "auto",
          boxSizing: "border-box",
        }}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setText(v);
          if (measureRef.current) measureRef.current.textContent = v || " ";
          remeasure();
        }}
        onChange={() => {}}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") onCancel();
        }}
        onBlur={(e) => {
          // Don't commit when focus is just moving into the floating
          // toolbar (font picker / size / B-I-U). The user is mid-edit;
          // commit would close the editor and undo their change.
          if (isFocusMovingToToolbar(e.relatedTarget)) return;
          commit();
        }}
      />
    </>
  );
}
