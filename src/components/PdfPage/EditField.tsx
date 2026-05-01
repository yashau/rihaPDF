import { useEffect, useRef, useState } from "react";
import type { TextRun } from "../../lib/pdf";
import type { EditStyle } from "../../lib/save";
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

  useEffect(() => {
    if (measureRef.current) measureRef.current.textContent = text || " ";
    inputRef.current?.focus();
    inputRef.current?.select();
    remeasure();
    if (isMobile) {
      // The on-screen keyboard occupies the bottom ~40% of the viewport
      // and the fixed-bottom toolbar adds ~80px more. Without scrolling,
      // an EditField near the bottom of the page would be hidden.
      // Centre it in the visible viewport area on open. `auto` skips
      // the smooth-scroll animation so the user sees the editor
      // immediately rather than after a 250ms slide.
      inputRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
    }
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
