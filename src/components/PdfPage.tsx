import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import type { RenderedPage, TextRun } from "../lib/pdf";
import type { EditStyle } from "../lib/save";
import { FONTS } from "../lib/fonts";

export type EditValue = {
  text: string;
  style?: EditStyle;
};

type Props = {
  page: RenderedPage;
  pageIndex: number;
  edits: Map<string, EditValue>;
  onEdit: (runId: string, value: EditValue) => void;
};

export function PdfPage({ page, pageIndex, edits, onEdit }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const node = containerRef.current?.querySelector(
      "[data-canvas-slot]",
    ) as HTMLElement | null;
    if (!node) return;
    node.replaceChildren(page.canvas);
    page.canvas.style.display = "block";
    page.canvas.style.width = `${page.viewWidth}px`;
    page.canvas.style.height = `${page.viewHeight}px`;
  }, [page]);

  return (
    <div
      ref={containerRef}
      className="relative inline-block shadow-md"
      style={{ width: page.viewWidth, height: page.viewHeight }}
      data-page-index={pageIndex}
    >
      <div data-canvas-slot />
      <div
        className="absolute inset-0"
        style={{ pointerEvents: editingId === null ? "auto" : "none" }}
      >
        {page.textRuns.map((run) => {
          const isEditing = editingId === run.id;
          const editedValue = edits.get(run.id);
          if (isEditing) {
            return (
              <EditField
                key={run.id}
                run={run}
                initial={
                  editedValue ?? { text: run.text, style: undefined }
                }
                onCommit={(value) => {
                  if (value.text !== run.text || value.style) {
                    onEdit(run.id, value);
                  }
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            );
          }
          const edited = editedValue !== undefined;
          if (edited) {
            const padX = 4;
            const padY = Math.max(run.height * 0.25, 4);
            const style = editedValue.style ?? {};
            return (
              <span
                key={run.id}
                data-run-id={run.id}
                style={{
                  position: "absolute",
                  left: run.bounds.left - padX,
                  top: run.bounds.top - padY,
                  width: Math.max(run.bounds.width, 12) + padX * 2,
                  height: run.bounds.height + padY * 2,
                  backgroundColor: "white",
                  outline: "1px solid rgba(255, 200, 60, 0.7)",
                  pointerEvents: "auto",
                  cursor: "text",
                  display: "flex",
                  alignItems: "center",
                  overflow: "visible",
                }}
                title={editedValue.text}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(run.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(run.id);
                }}
              >
                <span
                  dir="auto"
                  style={{
                    fontFamily: style.fontFamily
                      ? `"${style.fontFamily}"`
                      : undefined,
                    fontSize: `${style.fontSize ?? run.height}px`,
                    lineHeight: `${run.bounds.height}px`,
                    fontWeight: style.bold ? 700 : 400,
                    fontStyle: style.italic ? "italic" : "normal",
                    textDecoration: style.underline ? "underline" : "none",
                    color: "black",
                    width: "100%",
                    whiteSpace: "pre",
                    paddingLeft: padX,
                    paddingRight: padX,
                  }}
                  className={style.fontFamily ? "" : "thaana-stack"}
                >
                  {editedValue.text}
                </span>
              </span>
            );
          }
          return (
            <span
              key={run.id}
              data-run-id={run.id}
              dir="auto"
              className="thaana-stack absolute cursor-text select-text"
              style={{
                left: run.bounds.left,
                top: run.bounds.top,
                width: Math.max(run.bounds.width, 12),
                height: run.bounds.height,
                fontSize: `${run.height}px`,
                lineHeight: `${run.bounds.height}px`,
                color: "transparent",
                backgroundColor: "transparent",
                pointerEvents: "auto",
                whiteSpace: "pre",
                overflow: "visible",
              }}
              title={run.text}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingId(run.id);
              }}
              onClick={(e) => {
                e.stopPropagation();
                setEditingId(run.id);
              }}
            >
              {run.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function EditField({
  run,
  initial,
  onCommit,
  onCancel,
}: {
  run: TextRun;
  initial: EditValue;
  onCommit: (value: EditValue) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [text, setText] = useState(initial.text);
  const [style, setStyle] = useState<EditStyle>(initial.style ?? {});
  const [width, setWidth] = useState<number>(
    Math.max(run.bounds.width + 24, 80),
  );

  const fontFamilyCss = style.fontFamily ? `"${style.fontFamily}"` : undefined;
  const fontSizePx = style.fontSize ?? run.height;

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
          fontWeight: style.bold ? 700 : 400,
          fontStyle: style.italic ? "italic" : "normal",
          left: -9999,
          top: -9999,
        }}
        className={style.fontFamily ? "" : "thaana-stack"}
      />
      {/* Floating toolbar above the input */}
      <div
        data-edit-toolbar
        style={{
          position: "absolute",
          left: run.bounds.left - 2,
          top: run.bounds.top - 48,
          zIndex: 10,
          display: "flex",
          gap: 4,
          padding: 4,
          background: "white",
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          alignItems: "center",
          pointerEvents: "auto",
          whiteSpace: "nowrap",
        }}
        onMouseDown={(e) => {
          // Prevent the input from blurring (which commits the edit) when
          // the user clicks a toolbar button.
          e.preventDefault();
        }}
      >
        <select
          aria-label="Font"
          value={style.fontFamily ?? "Faruma"}
          style={{
            padding: "4px 6px",
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 4,
            fontSize: 12,
            background: "white",
            minWidth: 140,
          }}
          onChange={(e) =>
            setStyle((s) => ({ ...s, fontFamily: e.target.value }))
          }
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
          value={Math.round(fontSizePx)}
          style={{
            width: 56,
            padding: "4px 6px",
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 4,
            fontSize: 12,
          }}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setStyle((s) => ({
              ...s,
              fontSize: Number.isFinite(v) ? v : undefined,
            }));
          }}
        />
        <ToggleButton
          label="B"
          active={!!style.bold}
          weight="bold"
          onClick={() => setStyle((s) => ({ ...s, bold: !s.bold }))}
        />
        <ToggleButton
          label="I"
          active={!!style.italic}
          italic
          onClick={() => setStyle((s) => ({ ...s, italic: !s.italic }))}
        />
        <ToggleButton
          label="U"
          active={!!style.underline}
          underline
          onClick={() => setStyle((s) => ({ ...s, underline: !s.underline }))}
        />
        <Button
          size="sm"
          variant="ghost"
          onPress={() => onCancel()}
          aria-label="Cancel edit"
        >
          ✕
        </Button>
      </div>
      <input
        ref={inputRef}
        value={text}
        dir="auto"
        data-run-id={run.id}
        data-editor
        className={style.fontFamily ? "" : "thaana-stack"}
        style={{
          position: "absolute",
          left: run.bounds.left - 2,
          top: run.bounds.top - 2,
          width,
          height: run.bounds.height + 4,
          fontFamily: fontFamilyCss,
          fontSize: `${fontSizePx}px`,
          lineHeight: `${run.bounds.height}px`,
          fontWeight: style.bold ? 700 : 400,
          fontStyle: style.italic ? "italic" : "normal",
          textDecoration: style.underline ? "underline" : "none",
          padding: "0 4px",
          border: "none",
          outline: "2px solid rgb(59, 130, 246)",
          background: "white",
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
        onBlur={commit}
      />
    </>
  );
}

function hasStyle(s: EditStyle): boolean {
  return !!(
    s.fontFamily ||
    s.fontSize ||
    s.bold ||
    s.italic ||
    s.underline
  );
}

function ToggleButton({
  label,
  active,
  weight,
  italic,
  underline,
  onClick,
}: {
  label: string;
  active: boolean;
  weight?: "bold";
  italic?: boolean;
  underline?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-pressed={active}
      style={{
        width: 26,
        height: 26,
        border: "1px solid rgba(0,0,0,0.15)",
        borderRadius: 4,
        background: active ? "rgb(219, 234, 254)" : "white",
        cursor: "pointer",
        fontWeight: weight === "bold" ? 700 : 500,
        fontStyle: italic ? "italic" : "normal",
        textDecoration: underline ? "underline" : "none",
        fontSize: 12,
      }}
    >
      {label}
    </button>
  );
}
