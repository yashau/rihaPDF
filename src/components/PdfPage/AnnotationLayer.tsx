// Per-page overlay for user-added annotations.
//
// Renders three things visually:
//   - highlight rects (translucent fill, one rect per quad)
//   - comment boxes (FreeText with inline textarea editor + drag-to-move)
//   - ink polylines (SVG, one path per stroke)
//
// Plus, when the active tool is "ink", captures pointer events to
// build a new InkAnnotation: pointerdown starts a stroke, pointermove
// extends it, pointerup commits via onAnnotationAdd. Highlight and
// comment tools route through PdfPage's existing run-click and
// onCanvasClick paths respectively, so this layer only has to render
// for those two.
//
// Coordinate convention: every Annotation field is in PDF user space
// (y-up). We convert to NATURAL viewport pixels (y-down) for layout,
// matching the rest of PdfPage's overlays. The outer container is
// already CSS-transformed by displayScale; we don't need to deal with
// fit-to-width in this file except when interpreting raw screen-pixel
// pointer deltas during a drag — those divide by `effectivePdfScale`
// (= page.scale × displayScale) to land in PDF user space.

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  type Annotation,
  type AnnotationColor,
  DEFAULT_INK_COLOR,
  newAnnotationId,
} from "../../lib/annotations";
import { useDragGesture } from "../../lib/useDragGesture";
import type { ToolMode } from "../../App";

type Props = {
  annotations: Annotation[];
  pageScale: number;
  viewHeight: number;
  /** Source page's natural→displayed ratio. Drag pointer deltas in
   *  screen pixels divide by `pageScale * displayScale` to land in PDF
   *  user space — same convention as the InsertedTextOverlay drag. */
  displayScale: number;
  /** Page index within slots — written into the new annotation so save
   *  can re-address it to the slot's source page. App rewrites
   *  sourceKey/pageIndex at flatten time, but we still need a value. */
  pageIndex: number;
  sourceKey: string;
  tool: ToolMode;
  onAnnotationAdd: (annotation: Annotation) => void;
  onAnnotationChange: (id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string) => void;
};

/** rgba() css string from our 0..1 RGB tuple plus an alpha. Used by
 *  highlight rects (translucent fill) and ink strokes (full alpha). */
function rgba(c: AnnotationColor, a: number): string {
  return `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
}

/** Convert PDF user-space y → viewport-pixel y (y-down). The viewport
 *  coordinate system runs from 0 at the top to viewHeight at the
 *  bottom; PDF user space is y-up. */
function vpY(pdfY: number, pageScale: number, viewHeight: number): number {
  return viewHeight - pdfY * pageScale;
}

export function AnnotationLayer({
  annotations,
  pageScale,
  viewHeight,
  displayScale,
  pageIndex,
  sourceKey,
  tool,
  onAnnotationAdd,
  onAnnotationChange,
  onAnnotationDelete,
}: Props) {
  /** Stroke being captured by the ink tool. null when not drawing. The
   *  layer commits this as a fresh InkAnnotation on pointerup. */
  const [drawing, setDrawing] = useState<Array<{ x: number; y: number }> | null>(null);
  /** id of a comment whose body text is currently being edited inline. */
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);
  /** Comment ids the layer has already seen on a render. Used to detect
   *  a freshly-added empty comment so we can auto-open its editor —
   *  needs to outlive the typing-driven re-renders so we don't keep
   *  re-triggering the open after every keystroke. */
  const seenCommentIdsRef = useRef<Set<string>>(new Set());
  /** Set when a comment drag just ended, cleared a tick later. The
   *  comment's onClick checks this and bails so a drag-to-move doesn't
   *  also pop the editor open. */
  const justDraggedCommentRef = useRef<string | null>(null);

  // Screen-pixel pointer deltas divide by this to land in PDF user
  // space. (page.scale = PDF→viewport-natural; displayScale =
  // natural→displayed-screen. Their product = PDF→displayed-screen.)
  const effectivePdfScale = pageScale * displayScale;

  type CommentDragCtx = { id: string; baseX: number; baseY: number };
  const beginCommentDrag = useDragGesture<CommentDragCtx>({
    onMove: (ctx, info) => {
      // viewport y-down → PDF y-up: subtract dy.
      onAnnotationChange(ctx.id, {
        pdfX: ctx.baseX + info.dxRaw / effectivePdfScale,
        pdfY: ctx.baseY - info.dyRaw / effectivePdfScale,
      });
    },
    onEnd: (ctx, info) => {
      if (!info.moved) return;
      // Suppress the trailing click that would otherwise toggle the
      // editor open immediately after the drag releases. One tick is
      // enough — React's synthetic click fires synchronously after
      // pointerup but before the next event-loop turn.
      justDraggedCommentRef.current = ctx.id;
      setTimeout(() => {
        if (justDraggedCommentRef.current === ctx.id) {
          justDraggedCommentRef.current = null;
        }
      }, 50);
    },
  });

  // Close the inline editor when the user switches tool — keeps the
  // textarea from sticking around as a stale overlay during a tool change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tool !== "select") setEditingCommentId(null);
  }, [tool]);

  // Detect a newly-added empty comment and open its editor exactly
  // once. Doing this in an effect (instead of inferring from `text === ""`
  // at render time) keeps the textarea mounted continuously through
  // typing — the previous shortcut flipped isEditing back to false on
  // the first keystroke, dropping focus.
  useEffect(() => {
    let newlyAdded: string | null = null;
    const currentIds = new Set<string>();
    for (const a of annotations) {
      if (a.kind !== "comment") continue;
      currentIds.add(a.id);
      if (!seenCommentIdsRef.current.has(a.id) && a.text === "") {
        newlyAdded = a.id;
      }
    }
    seenCommentIdsRef.current = currentIds;
    if (newlyAdded !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditingCommentId(newlyAdded);
    }
  }, [annotations]);

  const isInkActive = tool === "ink";

  return (
    <div
      ref={captureRef}
      className="absolute inset-0"
      // The capture layer sits ABOVE existing overlays (zIndex high) so
      // it can intercept pointer events for ink. For other tools (and
      // for "select") it's pointer-events-none so highlights / notes /
      // ink polylines underneath stay clickable.
      style={{
        zIndex: isInkActive ? 60 : 5,
        pointerEvents: isInkActive ? "auto" : "none",
        cursor: isInkActive ? "crosshair" : "default",
        touchAction: isInkActive ? "none" : undefined,
      }}
      onPointerDown={(e) => {
        if (!isInkActive) return;
        const host = captureRef.current;
        if (!host) return;
        e.preventDefault();
        host.setPointerCapture(e.pointerId);
        const r = host.getBoundingClientRect();
        // r is the DISPLAYED rect (post-CSS-transform). `ds` is the
        // displayed-pixel-per-natural-pixel ratio, used to undo
        // fit-to-width before we convert to PDF user space below.
        const ds = r.width > 0 ? r.width / (host.clientWidth || 1) : 1;
        const xView = (e.clientX - r.left) / ds;
        const yView = (e.clientY - r.top) / ds;
        setDrawing([{ x: xView / pageScale, y: (viewHeight - yView) / pageScale }]);
      }}
      onPointerMove={(e) => {
        if (!isInkActive || !drawing) return;
        const host = captureRef.current;
        if (!host) return;
        const r = host.getBoundingClientRect();
        const ds = r.width > 0 ? r.width / (host.clientWidth || 1) : 1;
        const xView = (e.clientX - r.left) / ds;
        const yView = (e.clientY - r.top) / ds;
        const nextPoint = { x: xView / pageScale, y: (viewHeight - yView) / pageScale };
        setDrawing((prev) => {
          if (!prev) return prev;
          const last = prev[prev.length - 1];
          // Drop adjacent samples that are <0.5pt apart — pointer events
          // fire faster than ink files need to record, and the polyline
          // simplification keeps file size sane on long strokes.
          const dx = nextPoint.x - last.x;
          const dy = nextPoint.y - last.y;
          if (dx * dx + dy * dy < 0.25) return prev;
          return [...prev, nextPoint];
        });
      }}
      onPointerUp={() => {
        if (!isInkActive || !drawing) return;
        if (drawing.length >= 2) {
          onAnnotationAdd({
            kind: "ink",
            id: newAnnotationId("ink"),
            sourceKey,
            pageIndex,
            strokes: [drawing],
            color: DEFAULT_INK_COLOR,
            thickness: 1.5,
          });
        }
        setDrawing(null);
      }}
      onPointerCancel={() => setDrawing(null)}
    >
      {/* Existing annotations -- rendered with pointer-events:auto on
          themselves so individual overlays remain clickable even though
          the parent layer above is non-interactive in select mode. */}
      <svg
        className="absolute inset-0"
        width="100%"
        height="100%"
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        {annotations.map((a) => {
          if (a.kind === "highlight") {
            return a.quads.map((q, i) => {
              const x = Math.min(q.x1, q.x3) * pageScale;
              const y = vpY(Math.max(q.y1, q.y2), pageScale, viewHeight);
              const w = (Math.max(q.x2, q.x4) - Math.min(q.x1, q.x3)) * pageScale;
              const h = (Math.max(q.y1, q.y2) - Math.min(q.y3, q.y4)) * pageScale;
              return (
                <rect
                  key={`${a.id}-${i}`}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill={rgba(a.color, 0.4)}
                  style={{ pointerEvents: tool === "select" ? "auto" : "none" }}
                  onClick={(e) => {
                    if (tool !== "select") return;
                    e.stopPropagation();
                    if (window.confirm("Delete highlight?")) onAnnotationDelete(a.id);
                  }}
                />
              );
            });
          }
          if (a.kind === "ink") {
            return a.strokes.map((stroke, i) => {
              if (stroke.length < 2) return null;
              const d = stroke
                .map((p, j) => {
                  const x = p.x * pageScale;
                  const y = vpY(p.y, pageScale, viewHeight);
                  return `${j === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
                })
                .join(" ");
              return (
                <path
                  key={`${a.id}-${i}`}
                  d={d}
                  stroke={rgba(a.color, 1)}
                  strokeWidth={a.thickness * pageScale}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  style={{ pointerEvents: tool === "select" ? "auto" : "none" }}
                  onClick={(e) => {
                    if (tool !== "select") return;
                    e.stopPropagation();
                    if (window.confirm("Delete ink stroke?")) onAnnotationDelete(a.id);
                  }}
                />
              );
            });
          }
          return null;
        })}
        {/* Live ink preview while the user is drawing -- not yet
            committed. */}
        {drawing && drawing.length >= 2 ? (
          <path
            d={drawing
              .map((p, i) => {
                const x = p.x * pageScale;
                const y = vpY(p.y, pageScale, viewHeight);
                return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
              })
              .join(" ")}
            stroke={rgba(DEFAULT_INK_COLOR, 1)}
            strokeWidth={1.5 * pageScale}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}
      </svg>

      {/* Comment boxes -- visible inline text on the annotation layer.
          Rendered as HTML on top of the SVG so we can drop a real
          <textarea> over the box for editing without fighting SVG's
          foreignObject quirks. */}
      {annotations.map((a) => {
        if (a.kind !== "comment") return null;
        // /Rect uses bottom-left origin (PDF y-up). Convert to viewport
        // top-left + size in viewport pixels.
        const left = a.pdfX * pageScale;
        const top = vpY(a.pdfY + a.pdfHeight, pageScale, viewHeight);
        const w = a.pdfWidth * pageScale;
        const h = a.pdfHeight * pageScale;
        const fontSizePx = a.fontSize * pageScale;
        const isEditing = editingCommentId === a.id;
        return (
          <div
            key={a.id}
            className="absolute rounded-sm shadow-sm border border-amber-400/70"
            data-annotation-id={a.id}
            style={{
              left,
              top,
              width: w,
              height: h,
              background: rgba(a.color, 0.95),
              zIndex: 20,
              pointerEvents: tool === "select" ? "auto" : "none",
              // While editing, the textarea owns the cursor for text
              // selection; otherwise we show a move cursor since
              // pointerdown initiates a drag-to-move (and a clean
              // click-without-drag still falls through to edit mode).
              cursor: isEditing ? "text" : "move",
              touchAction: "pan-y pinch-zoom",
            }}
            onPointerDown={(e) => {
              if (tool !== "select") return;
              // While the textarea is mounted, let it handle pointer
              // events normally — caret placement, selection, etc.
              if (isEditing) return;
              beginCommentDrag(e, { id: a.id, baseX: a.pdfX, baseY: a.pdfY });
            }}
            onClick={(e) => {
              if (tool !== "select") return;
              e.stopPropagation();
              // A click that immediately follows a drag is the trailing
              // pointerup's synthetic click — don't open the editor.
              if (justDraggedCommentRef.current === a.id) return;
              setEditingCommentId(a.id);
            }}
          >
            {isEditing ? (
              <textarea
                autoFocus
                className="absolute inset-0 w-full h-full bg-transparent text-zinc-900 outline-none resize-none px-1 py-0.5"
                style={{ fontSize: fontSizePx, lineHeight: 1.2 }}
                value={a.text}
                placeholder="Type a comment..."
                onChange={(e) => onAnnotationChange(a.id, { text: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => {
                  setEditingCommentId(null);
                  // Drop the box if the user dismissed without typing
                  // anything -- avoids leaving stray empty boxes after
                  // an accidental click.
                  if (a.text === "") onAnnotationDelete(a.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingCommentId(null);
                    if (a.text === "") onAnnotationDelete(a.id);
                  }
                }}
              />
            ) : (
              <div
                className="absolute inset-0 px-1 py-0.5 text-zinc-900 whitespace-pre-wrap break-words overflow-hidden"
                style={{ fontSize: fontSizePx, lineHeight: 1.2 }}
              >
                {a.text}
              </div>
            )}
            {tool === "select" && !isEditing ? (
              <button
                type="button"
                aria-label="Delete comment"
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-zinc-300 text-red-600 shadow flex items-center justify-center hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation();
                  onAnnotationDelete(a.id);
                }}
              >
                <Trash2 size={10} aria-hidden />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
