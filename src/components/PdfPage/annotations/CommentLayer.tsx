import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import type { Annotation, AnnotationColor } from "../../../lib/annotations";
import type { ToolMode } from "../../../lib/toolMode";
import { useDragGesture } from "../../../lib/useDragGesture";
import { isRtlScript } from "../../../lib/fonts";
import { useIsMobile } from "../../../lib/useMediaQuery";
import { attachThaanaTransliteration } from "../../../lib/thaanaKeyboard";
import { findPageAtPoint, isFocusMovingToToolbar } from "../helpers";
import { MobileThaanaToggleBar } from "../MobileThaanaToggleBar";
import { rgba, vpY } from "./helpers";

/** Comment-box layer. HTML divs (not SVG) so we can drop a real
 *  textarea over a box for inline editing without `<foreignObject>`
 *  quirks. Owns the cross-page drag (dragLive state + body-portal
 *  preview that escapes the page wrapper's overflow:hidden), the
 *  click-to-edit handoff, and the auto-open-on-creation effect for
 *  freshly-added empty comments. */
export function CommentLayer({
  annotations,
  pageScale,
  viewHeight,
  displayScale,
  pageIndex,
  tool,
  onAnnotationChange,
  onAnnotationDelete,
}: {
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
  tool: ToolMode;
  onAnnotationChange: (id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string) => void;
}) {
  /** id of a comment whose body text is currently being edited inline. */
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  /** Mobile-only DV/EN toggle state, shared across editing sessions
   *  in this layer. Defaults to DV (Latin → Thaana phonetic input)
   *  since most mobile users have a Latin soft keyboard but want to
   *  type Thaana into comments. The pinned floating button below
   *  flips it; desktop ignores it (keystrokes pass through raw). */
  const [thaanaInput, setThaanaInput] = useState(true);
  const isMobile = useIsMobile();
  /** Active textarea ref — there's only ever one open editor at a
   *  time (gated by `editingCommentId`), so a single layer-level ref
   *  is enough. The DV/EN-mode effect below attaches the Thaana
   *  transliterator to whichever element this points at. */
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // `editingCommentId` is in deps (rather than just an `enabled`
  // boolean) so the listener reattaches when the user switches
  // directly from editing comment A to comment B — `textareaRef`
  // points at a different element each session, but the layer-level
  // gate (mobile + thaanaInput) doesn't flip across that swap.
  useEffect(() => {
    if (!isMobile || editingCommentId === null || !thaanaInput) return;
    const el = textareaRef.current;
    if (!el) return;
    return attachThaanaTransliteration(el);
  }, [isMobile, editingCommentId, thaanaInput]);
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

  /** Live drag state for the currently-grabbed comment. We hold this
   *  locally instead of patching `pdfX/pdfY` on every pointermove so
   *  (a) the in-place overlay stays put while the body-portal clone
   *  follows the cursor (escapes the page wrapper's overflow:hidden
   *  during cross-page drags) and (b) onEnd can pick the right slot /
   *  PDF coords without intermediate same-page commits leaving stale
   *  off-page values. Null when no comment is being dragged. */
  const [commentDragLive, setCommentDragLive] = useState<{
    id: string;
    baseX: number;
    baseY: number;
    pdfWidth: number;
    pdfHeight: number;
    color: AnnotationColor;
    text: string;
    fontSize: number;
    cursorOffsetX: number;
    cursorOffsetY: number;
    /** Box dimensions in screen pixels (= natural × displayScale). */
    width: number;
    height: number;
    clientX: number;
    clientY: number;
    moved: boolean;
  } | null>(null);
  type CommentDragCtx = {
    id: string;
    baseX: number;
    baseY: number;
    cursorOffsetX: number;
    cursorOffsetY: number;
    boxScreenW: number;
    boxScreenH: number;
    pdfWidth: number;
    pdfHeight: number;
    color: AnnotationColor;
    text: string;
    fontSize: number;
  };
  const commentDragLiveRef = useRef(commentDragLive);
  useEffect(() => {
    commentDragLiveRef.current = commentDragLive;
  }, [commentDragLive]);
  const beginCommentDrag = useDragGesture<CommentDragCtx>({
    onStart: (ctx, e) => {
      setCommentDragLive({
        id: ctx.id,
        baseX: ctx.baseX,
        baseY: ctx.baseY,
        pdfWidth: ctx.pdfWidth,
        pdfHeight: ctx.pdfHeight,
        color: ctx.color,
        text: ctx.text,
        fontSize: ctx.fontSize,
        cursorOffsetX: ctx.cursorOffsetX,
        cursorOffsetY: ctx.cursorOffsetY,
        width: ctx.boxScreenW,
        height: ctx.boxScreenH,
        clientX: e.clientX,
        clientY: e.clientY,
        moved: false,
      });
    },
    onMove: (_ctx, info) => {
      setCommentDragLive((prev) =>
        prev ? { ...prev, clientX: info.clientX, clientY: info.clientY, moved: true } : prev,
      );
    },
    onEnd: (ctx, info) => {
      const live = commentDragLiveRef.current;
      setCommentDragLive(null);
      if (!info.moved || !live) return;
      // Suppress the trailing click that would otherwise toggle the
      // editor open immediately after the drag releases.
      justDraggedCommentRef.current = ctx.id;
      setTimeout(() => {
        if (justDraggedCommentRef.current === ctx.id) {
          justDraggedCommentRef.current = null;
        }
      }, 50);
      // Resolve the dropped-on page. Cross-page drops emit a
      // `sourceKey + pageIndex` patch alongside the new PDF coords —
      // App.onAnnotationChange uses those to re-bucket the annotation
      // into the target slot's array (mirrors how inserted text /
      // image cross-page drops work).
      const hit = findPageAtPoint(info.clientX, info.clientY);
      const newScreenLeft = info.clientX - live.cursorOffsetX;
      const newScreenTop = info.clientY - live.cursorOffsetY;
      if (hit) {
        const newBoxLeftNat = (newScreenLeft - hit.rect.left) / hit.displayScale;
        const newBoxTopNat = (newScreenTop - hit.rect.top) / hit.displayScale;
        // pdfY is the BOTTOM-LEFT y in y-up PDF space. Box top in
        // viewport y-down = viewHeight - (pdfY + pdfHeight) × scale.
        const newPdfX = newBoxLeftNat / hit.scale;
        const heightOnHitNat = ctx.pdfHeight * hit.scale;
        const newPdfY = (hit.viewHeight - newBoxTopNat - heightOnHitNat) / hit.scale;
        if (hit.pageIndex === pageIndex) {
          // Same slot — just a position update.
          onAnnotationChange(ctx.id, { pdfX: newPdfX, pdfY: newPdfY });
        } else {
          // Cross-page drop. App resolves `pageIndex` (slot index) +
          // `sourceKey` to the target slot and moves the annotation
          // into that slot's bucket.
          onAnnotationChange(ctx.id, {
            sourceKey: hit.sourceKey,
            pageIndex: hit.pageIndex,
            pdfX: newPdfX,
            pdfY: newPdfY,
          });
        }
      } else {
        // Dropped outside any page — fall back to the original
        // same-page math so the comment doesn't end up in a void.
        const dxPdf = info.dxRaw / effectivePdfScale;
        const dyPdf = info.dyRaw / effectivePdfScale;
        onAnnotationChange(ctx.id, {
          pdfX: ctx.baseX + dxPdf,
          pdfY: ctx.baseY - dyPdf,
        });
      }
    },
    onCancel: () => setCommentDragLive(null),
  });

  // Close the inline editor when the user switches tool — keeps the
  // textarea from sticking around as a stale overlay during a tool change.
  useEffect(() => {
    // oxlint-disable-next-line react-hooks/set-state-in-effect
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
      // oxlint-disable-next-line react-hooks/set-state-in-effect
      setEditingCommentId(newlyAdded);
    }
  }, [annotations]);

  return (
    <>
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
        const isDraggingThis = commentDragLive?.id === a.id && commentDragLive.moved;
        // Faruma for Thaana, Arial for Latin. Comments don't carry
        // an explicit font field — auto-detect from body codepoints
        // so the rendered text matches what the save path will pick
        // (saveAnnotations.ts also branches on `isRtlScript`).
        const commentFontFamily = isRtlScript(a.text) ? '"Faruma"' : '"Arial"';
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
              // Hide the in-place comment once the user has actually
              // moved — the body-portal clone takes over so the
              // comment can cross page boundaries (which the page
              // wrapper's overflow:hidden would otherwise clip).
              visibility: isDraggingThis ? "hidden" : "visible",
            }}
            onPointerDown={(e) => {
              if (tool !== "select") return;
              // While the textarea is mounted, let it handle pointer
              // events normally — caret placement, selection, etc.
              if (isEditing) return;
              const target = e.currentTarget;
              const r = target.getBoundingClientRect();
              beginCommentDrag(e, {
                id: a.id,
                baseX: a.pdfX,
                baseY: a.pdfY,
                cursorOffsetX: e.clientX - r.left,
                cursorOffsetY: e.clientY - r.top,
                boxScreenW: r.width,
                boxScreenH: r.height,
                pdfWidth: a.pdfWidth,
                pdfHeight: a.pdfHeight,
                color: a.color,
                text: a.text,
                fontSize: a.fontSize,
              });
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
                ref={textareaRef}
                autoFocus
                className="absolute inset-0 w-full h-full bg-transparent text-zinc-900 outline-none resize-none px-1 py-0.5"
                style={{ fontSize: fontSizePx, lineHeight: 1.2, fontFamily: commentFontFamily }}
                // Auto-detect text direction from codepoints so a
                // Thaana comment right-aligns and a Latin comment
                // left-aligns without any explicit user toggle.
                dir="auto"
                // Mobile + DV mode: suppress soft-keyboard autocorrect /
                // autocapitalise / spellcheck so each keystroke fires a
                // single-char `insertText` event the Thaana
                // transliterator can intercept (matches the
                // InsertedTextOverlay's input).
                autoComplete={isMobile && thaanaInput ? "off" : undefined}
                autoCorrect={isMobile && thaanaInput ? "off" : undefined}
                autoCapitalize={isMobile && thaanaInput ? "none" : undefined}
                spellCheck={isMobile && thaanaInput ? false : undefined}
                value={a.text}
                placeholder="Type a comment..."
                onChange={(e) => onAnnotationChange(a.id, { text: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  // Tapping the floating DV/EN toggle moves focus to
                  // its button and would otherwise close the editor
                  // (and delete an empty comment). The toggle wrapper
                  // is tagged `data-edit-toolbar` so this check skips
                  // the close — same pattern as EditField /
                  // InsertedTextOverlay.
                  if (isFocusMovingToToolbar(e.relatedTarget)) return;
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
                style={{ fontSize: fontSizePx, lineHeight: 1.2, fontFamily: commentFontFamily }}
                dir="auto"
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
      {/* Body-portal preview for the dragged comment. Mirrors the
          source-text / inserted-text pattern: rendered to document.body
          via createPortal so it isn't clipped by the page wrapper's
          overflow:hidden when the cursor crosses onto another page.
          Only mounted once the user has actually moved (so a no-motion
          click on the comment opens the editor instead of getting
          intercepted by a hidden overlay). */}
      {commentDragLive?.moved
        ? createPortal(
            <div
              aria-hidden
              className="rounded-sm shadow-sm border border-amber-400/70"
              style={{
                position: "fixed",
                left: commentDragLive.clientX - commentDragLive.cursorOffsetX,
                top: commentDragLive.clientY - commentDragLive.cursorOffsetY,
                width: commentDragLive.width,
                height: commentDragLive.height,
                background: rgba(commentDragLive.color, 0.95),
                pointerEvents: "none",
                zIndex: 10000,
              }}
            >
              <div
                className="absolute inset-0 px-1 py-0.5 text-zinc-900 whitespace-pre-wrap break-words overflow-hidden"
                style={{
                  fontSize: commentDragLive.fontSize * pageScale * displayScale,
                  lineHeight: 1.2,
                  fontFamily: isRtlScript(commentDragLive.text) ? '"Faruma"' : '"Arial"',
                }}
                dir="auto"
              >
                {commentDragLive.text}
              </div>
            </div>,
            document.body,
          )
        : null}
      <MobileThaanaToggleBar
        enabled={isMobile && editingCommentId !== null}
        value={thaanaInput}
        onChange={setThaanaInput}
      />
    </>
  );
}
