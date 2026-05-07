import { useEffect, useMemo, useRef, useState } from "react";
import { usePreviewCanvases } from "./lib/usePreviewCanvases";
import { useSelection } from "./lib/useSelection";
import type { ImageInsertion, TextInsertion } from "./lib/insertions";
import {
  type Annotation,
  type AnnotationColor,
  DEFAULT_COMMENT_COLOR,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_INK_COLOR,
} from "./lib/annotations";
import type { Redaction } from "./lib/redactions";
import type { EditValue, FormValue, ImageMoveValue } from "./components/PdfPage";
import { CommentToolbar } from "./components/CommentToolbar";
import { HighlightToolbar } from "./components/HighlightToolbar";
import { InkToolbar } from "./components/InkToolbar";
import { PageSidebar } from "./components/PageSidebar";
import type { PageSlot } from "./lib/slots";
import type { LoadedSource } from "./lib/loadSource";
import { useTheme } from "./lib/theme";
import { useIsMobile } from "./lib/useMediaQuery";
import { useMobileChrome } from "./lib/useMobileChrome";
import { MIN_DOCUMENT_ZOOM, useMobileDocumentZoom } from "./lib/useMobileDocumentZoom";
import { useAppUndo } from "./lib/useAppUndo";
import { useDocumentIo } from "./lib/useDocumentIo";
import { useDocumentMutations } from "./lib/useDocumentMutations";
import { useSaveStatus } from "./lib/useSaveStatus";
import type { PendingImage, ToolMode } from "./lib/toolMode";
import { AboutModal } from "./components/AboutModal";
import { AppHeader, AppFileInputs } from "./components/AppHeader";
import { PageList } from "./components/PageList";
import { SignatureModal } from "./components/SignatureModal";

const RENDER_SCALE = 1.5;

export default function App() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const isMobile = useIsMobile();
  const [primaryFilename, setPrimaryFilename] = useState<string | null>(null);
  const [loadedFileKey, setLoadedFileKey] = useState(0);
  const { mobileHeaderRef, mobileHeaderH, mobileSidebarOpen, setMobileSidebarOpen } =
    useMobileChrome(isMobile);
  const [documentZoom, setDocumentZoom] = useState(MIN_DOCUMENT_ZOOM);
  /** All loaded sources keyed by sourceKey. The primary file uses the
   *  fixed key from `PRIMARY_SOURCE_KEY`; externals use per-pick keys
   *  from `nextExternalSourceKey`. Promoting external pages to first-
   *  class status meant collapsing the old `originalBytes / pages /
   *  externalSources / externalRendered` fan-out into this single map. */
  const [sources, setSources] = useState<Map<string, LoadedSource>>(new Map());
  /** Ordered list of displayed pages. Each slot points back at a source
   *  page (`kind: "page"`) or is a fresh blank (`kind: "blank"`).
   *  Slot identity (`id`) is the stable key used to index per-page state
   *  so an entry follows its page through reorder. */
  const [slots, setSlots] = useState<PageSlot[]>([]);
  /** Map<slotId, Map<runId, EditValue>> */
  const [edits, setEdits] = useState<Map<string, Map<string, EditValue>>>(new Map());
  /** Map<slotId, Map<imageId, ImageMoveValue>> — drag offsets per
   *  image, identical shape to edits but for image XObject placements. */
  const [imageMoves, setImageMoves] = useState<Map<string, Map<string, ImageMoveValue>>>(new Map());
  const [busy, setBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const documentZoomTargetRef = useRef<HTMLDivElement | null>(null);
  /** Mirror of `slots` so callbacks that need slotIndex→slotId lookups
   *  (cross-page insertion drags land via slot index from PdfPage's
   *  hit-test) don't re-create on every slot mutation. */
  const slotsRef = useRef<PageSlot[]>([]);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);
  const effectiveDocumentZoom = isMobile && slots.length > 0 ? documentZoom : MIN_DOCUMENT_ZOOM;
  const documentZoomHandlers = useMobileDocumentZoom({
    enabled: isMobile && slots.length > 0,
    zoom: effectiveDocumentZoom,
    targetRef: documentZoomTargetRef,
    onZoomChange: setDocumentZoom,
  });
  /** Map<slotId, currently-open runId> — populated by PdfPage's
   *  onEditingChange. Folded into the preview-strip spec so an open
   *  editor immediately hides the original glyph behind it. */
  const [editingByPage, setEditingByPage] = useState<Map<string, string>>(new Map());
  /** Tool mode for click-to-place actions ("select" = no insertion;
   *  "addText" = next click on a page drops a new text box; "addImage"
   *  = next click drops the pending image at that position). */
  const [tool, setTool] = useState<ToolMode>("select");
  /** Active ink stroke color + thickness. Lifted to App so the
   *  setting persists across page focus changes — the bottom-pinned
   *  InkToolbar renders here, and the per-page InkLayer reads these
   *  through the existing prop chain to stamp them onto each new
   *  stroke at commit time. */
  const [inkColor, setInkColor] = useState<AnnotationColor>(DEFAULT_INK_COLOR);
  const [inkThickness, setInkThickness] = useState<number>(1.5);
  /** Active highlight color. Same lift-to-App rationale as ink — the
   *  HighlightToolbar reads/writes here, and PdfPage's
   *  `addHighlightForRun` stamps it onto each new highlight. */
  const [highlightColor, setHighlightColor] = useState<AnnotationColor>(DEFAULT_HIGHLIGHT_COLOR);
  /** Active comment box-background color. Comment text stays black —
   *  this only paints the rect behind it (= the /FreeText /C array
   *  on save). The CommentToolbar reads/writes here; the per-page
   *  comment-creation handler stamps it on each new comment. */
  const [commentColor, setCommentColor] = useState<AnnotationColor>(DEFAULT_COMMENT_COLOR);
  /** Per-slot net-new text/image insertions — separate from edits
   *  because they don't reference an existing run/image. Keyed by
   *  slotId so an insertion follows its slot through reorder. */
  const [insertedTexts, setInsertedTexts] = useState<Map<string, TextInsertion[]>>(new Map());
  const [insertedImages, setInsertedImages] = useState<Map<string, ImageInsertion[]>>(new Map());
  /** Map<slotId, Set<shapeId>> — vector shapes flagged for deletion.
   *  Shapes are delete-only in v1 (no move / resize) so a Set is enough. */
  const [shapeDeletes, setShapeDeletes] = useState<Map<string, Set<string>>>(new Map());
  /** Map<slotId, Annotation[]> — user-added highlights / sticky notes /
   *  ink strokes. Keyed by slotId so an annotation follows its page
   *  through reorder, same as the insertion / edit maps. */
  const [annotations, setAnnotations] = useState<Map<string, Annotation[]>>(new Map());
  /** Map<slotId, Redaction[]> — opaque-black redaction rectangles.
   *  Kept separate from `annotations` because at save time these
   *  paint into the page content stream + strip overlapping glyphs,
   *  rather than appending /Annot dicts (which leave underlying
   *  text selectable / extractable). */
  const [redactions, setRedactions] = useState<Map<string, Redaction[]>>(new Map());
  /** Map<sourceKey, Map<fullName, FormValue>> — AcroForm fills keyed
   *  by the field's fully-qualified name. Bucketed by `sourceKey` so
   *  external-PDF fills don't collide with the primary's. Mirrors the
   *  Maps above for the same persistence / undo / save plumbing. */
  const [formValues, setFormValues] = useState<Map<string, Map<string, FormValue>>>(new Map());
  /** When the user picks an image file, we hold its bytes here until
   *  they click on a page to place it. Cleared on placement / cancel. */
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);

  const { recordHistory, undo, redo, clearHistory, canUndo, canRedo, bindSelectionSetter } =
    useAppUndo({
      edits,
      imageMoves,
      insertedTexts,
      insertedImages,
      shapeDeletes,
      annotations,
      redactions,
      formValues,
      sources,
      slotsRef,
      setEdits,
      setImageMoves,
      setInsertedTexts,
      setInsertedImages,
      setShapeDeletes,
      setAnnotations,
      setRedactions,
      setFormValues,
      setSlots,
      setSources,
    });

  const {
    selection,
    setSelection,
    onSelectImage,
    onSelectInsertedImage,
    onSelectShape,
    onSelectRedaction,
    onSelectHighlight,
    onSelectInk,
  } = useSelection({
    recordHistory,
    setImageMoves,
    setInsertedImages,
    setShapeDeletes,
    setRedactions,
    setAnnotations,
  });
  useEffect(() => {
    bindSelectionSetter(setSelection);
  }, [bindSelectionSetter, setSelection]);

  const { handleFile, onAddExternalPdfs, onPickImageFile, onSave } = useDocumentIo({
    renderScale: RENDER_SCALE,
    sources,
    slots,
    primaryFilename,
    edits,
    imageMoves,
    insertedTexts,
    insertedImages,
    shapeDeletes,
    annotations,
    redactions,
    formValues,
    setPrimaryFilename,
    setLoadedFileKey,
    setDocumentZoom,
    setSources,
    setSlots,
    setEdits,
    setImageMoves,
    setInsertedTexts,
    setInsertedImages,
    setShapeDeletes,
    setAnnotations,
    setRedactions,
    setFormValues,
    setTool,
    setPendingImage,
    setBusy,
    recordHistory,
    clearHistory,
  });

  const {
    onEdit,
    onImageMove,
    onEditingChange,
    onCanvasClick,
    onTextInsertChange,
    onTextInsertDelete,
    onImageInsertChange,
    onImageInsertDelete,
    onAnnotationAdd,
    onAnnotationChange,
    onAnnotationDelete,
    onFormFieldChange,
    onRedactionAdd,
    onRedactionChange,
    onSlotsChange,
  } = useDocumentMutations({
    slotsRef,
    tool,
    pendingImage,
    commentColor,
    recordHistory,
    setTool,
    setPendingImage,
    setEditingByPage,
    setEdits,
    setImageMoves,
    setInsertedTexts,
    setInsertedImages,
    setAnnotations,
    setRedactions,
    setFormValues,
    setSlots,
    setSelection,
  });

  // Resolve a slotId to (sourceKey, sourcePageIndex). Used in the save
  // flatten phase + the preview strip hook.
  const slotById = useMemo(() => new Map<string, PageSlot>(slots.map((s) => [s.id, s])), [slots]);

  const { previewCanvases } = usePreviewCanvases({
    sources,
    slotById,
    edits,
    imageMoves,
    shapeDeletes,
    editingByPage,
    isMobile,
    renderScale: RENDER_SCALE,
  });

  const { totalChangeCount, saveDisabled, toolTip } = useSaveStatus({
    sources,
    slots,
    edits,
    imageMoves,
    insertedTexts,
    insertedImages,
    shapeDeletes,
    annotations,
    redactions,
    formValues,
    busy,
    tool,
    pendingImage,
  });

  return (
    <div
      className="flex flex-col h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
      data-loaded-file-key={loadedFileKey}
      data-loaded-filename={primaryFilename ?? ""}
    >
      {/* The hidden file inputs are rendered ONCE outside both header
          subtrees so the desktop / mobile layouts can target the same
          input ref via `.click()`. Two render paths sharing one input
          avoids the "ref attached to whichever subtree mounted last"
          foot-gun. */}
      <AppFileInputs
        fileInputRef={fileInputRef}
        imageFileInputRef={imageFileInputRef}
        // Surface load errors via console.error so E2E `loadFixture`
        // postmortems pick them up (the timeout error includes the
        // captured page log). Without this catch the rejection from
        // handleFile is silently dropped and the test just sees
        // "0 pages after 25s" with no clue why.
        onPickPdf={(f) => {
          handleFile(f).catch((err) => console.error("handleFile failed:", err));
        }}
        onPickImage={(f) => {
          void onPickImageFile(f);
        }}
      />
      {/* Render exactly one header at a time — keying by `isMobile`
          rather than CSS-only switching prevents duplicate buttons in
          the DOM (which would break `locator('button')` strict-mode
          tests + add hidden focus-cycle stops to keyboard users). */}
      <AppHeader
        isMobile={isMobile}
        tool={tool}
        setTool={setTool}
        pendingImage={pendingImage}
        setPendingImage={setPendingImage}
        primaryFilename={primaryFilename}
        busy={busy}
        saveDisabled={saveDisabled}
        totalChangeCount={totalChangeCount}
        canUndo={canUndo}
        canRedo={canRedo}
        onOpen={() => fileInputRef.current?.click()}
        onSave={() => void onSave()}
        onUndo={undo}
        onRedo={redo}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        imageFileInputRef={imageFileInputRef}
        onAboutOpen={() => setAboutOpen(true)}
        onSignatureOpen={() => setSignatureOpen(true)}
        hasSources={sources.size > 0}
        toolTip={toolTip}
        mobileSidebarOpen={mobileSidebarOpen}
        setMobileSidebarOpen={setMobileSidebarOpen}
        mobileHeaderRef={mobileHeaderRef}
        slotsLength={slots.length}
      />
      {/* Tool-options bars. Desktop: an attached second header row
          below the main toolbar so the controls sit near the tool
          button that activated them. Mobile: a fixed bottom strip
          above the soft keyboard. Each toolbar owns the mobile/
          desktop branch internally; we only mount one at a time
          based on the active tool. */}
      {tool === "ink" ? (
        <InkToolbar
          color={inkColor}
          thickness={inkThickness}
          onColorChange={setInkColor}
          onThicknessChange={setInkThickness}
        />
      ) : tool === "highlight" ? (
        <HighlightToolbar color={highlightColor} onColorChange={setHighlightColor} />
      ) : tool === "comment" ? (
        <CommentToolbar color={commentColor} onColorChange={setCommentColor} />
      ) : null}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar is a static left rail on desktop and an overlay
            drawer on mobile. We keep a single PageSidebar instance and
            swap the wrapper styling so the thumbnail cache survives
            open/close on mobile. The drawer sits below the fixed
            mobile header (z-20) so the toggle button stays tappable
            even while the drawer covers the page area. */}
        {slots.length > 0 &&
          (isMobile ? (
            <>
              <div
                onClick={() => setMobileSidebarOpen(false)}
                aria-hidden
                className={`fixed inset-0 z-10 bg-black/40 transition-opacity ${
                  mobileSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
                style={{ top: mobileHeaderH }}
              />
              <div
                className={`fixed left-0 bottom-0 z-10 w-[85vw] max-w-sm transition-transform duration-200 ease-out ${
                  mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
                }`}
                style={{ top: mobileHeaderH }}
                role="dialog"
                aria-label="Pages"
                aria-hidden={!mobileSidebarOpen}
              >
                <PageSidebar
                  slots={slots}
                  sources={sources}
                  onSlotsChange={onSlotsChange}
                  onAddExternalPdfs={(files, insertAt) => void onAddExternalPdfs(files, insertAt)}
                  widthClass="w-full"
                  onSlotActivate={() => setMobileSidebarOpen(false)}
                />
              </div>
            </>
          ) : (
            <PageSidebar
              slots={slots}
              sources={sources}
              onSlotsChange={onSlotsChange}
              onAddExternalPdfs={(files, insertAt) => void onAddExternalPdfs(files, insertAt)}
            />
          ))}
        <main
          className="flex-1 overflow-auto px-2 py-3 sm:px-6 sm:py-6"
          // Mobile header is `position: fixed` (out of flow), so push
          // page content down by its measured height. `mobileHeaderH`
          // is 0 on desktop, where the header is back in the flex flow.
          style={
            isMobile
              ? {
                  paddingTop: mobileHeaderH + 12,
                  // The PDF surface owns two-finger zoom. Keep native
                  // one-finger panning, but exclude browser pinch zoom
                  // so fixed app chrome no longer has to chase
                  // visualViewport scale events.
                  touchAction: "pan-x pan-y",
                }
              : undefined
          }
          {...documentZoomHandlers}
          onPointerDown={(e) => {
            // Tap on empty `<main>` (no overlay child consumed the
            // event) cancels a pending image placement so the user
            // can back out without picking a target page.
            if (e.target === e.currentTarget && tool === "addImage" && pendingImage) {
              setTool("select");
              setPendingImage(null);
            }
          }}
        >
          {slots.length === 0 ? (
            <div className="flex h-full items-center justify-center text-zinc-400 dark:text-zinc-500">
              Open a PDF to begin. Double-click any text fragment to edit it.
            </div>
          ) : (
            <div ref={documentZoomTargetRef} className="w-full">
              <PageList
                slots={slots}
                sources={sources}
                edits={edits}
                imageMoves={imageMoves}
                insertedTexts={insertedTexts}
                insertedImages={insertedImages}
                annotations={annotations}
                redactions={redactions}
                shapeDeletes={shapeDeletes}
                previewCanvases={previewCanvases}
                editingByPage={editingByPage}
                tool={tool}
                inkColor={inkColor}
                inkThickness={inkThickness}
                highlightColor={highlightColor}
                selection={selection}
                renderScale={RENDER_SCALE}
                documentZoom={effectiveDocumentZoom}
                onEdit={onEdit}
                onImageMove={onImageMove}
                onEditingChange={onEditingChange}
                onCanvasClick={onCanvasClick}
                onTextInsertChange={onTextInsertChange}
                onTextInsertDelete={onTextInsertDelete}
                onImageInsertChange={onImageInsertChange}
                onImageInsertDelete={onImageInsertDelete}
                onSelectImage={onSelectImage}
                onSelectInsertedImage={onSelectInsertedImage}
                onSelectShape={onSelectShape}
                onAnnotationAdd={onAnnotationAdd}
                onAnnotationChange={onAnnotationChange}
                onAnnotationDelete={onAnnotationDelete}
                onRedactionAdd={onRedactionAdd}
                onRedactionChange={onRedactionChange}
                onSelectRedaction={onSelectRedaction}
                onSelectHighlight={onSelectHighlight}
                onSelectInk={onSelectInk}
                formValues={formValues}
                onFormFieldChange={onFormFieldChange}
              />
            </div>
          )}
        </main>
      </div>
      <AboutModal isOpen={aboutOpen} onOpenChange={setAboutOpen} />
      <SignatureModal
        isOpen={signatureOpen}
        onOpenChange={setSignatureOpen}
        onUseSignature={(image) => {
          setPendingImage({ ...image, kind: "signature" });
          setTool("addImage");
        }}
      />
    </div>
  );
}
