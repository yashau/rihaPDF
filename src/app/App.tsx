import { useEffect, useRef, useState } from "react";
import { useAppContentState, useAppDocumentState, useAppToolState } from "@/app/hooks/useAppState";
import { usePreviewCanvases } from "@/app/hooks/usePreviewCanvases";
import { useSelection } from "@/app/hooks/useSelection";
import { CommentToolbar } from "@/components/CommentToolbar";
import { HighlightToolbar } from "@/components/HighlightToolbar";
import { InkToolbar } from "@/components/InkToolbar";
import { PageSidebar } from "@/components/PageSidebar";
import { useTheme } from "@/platform/theme";
import { useIsMobile } from "@/platform/hooks/useMediaQuery";
import { useMobileChrome } from "@/app/hooks/useMobileChrome";
import { MIN_DOCUMENT_ZOOM, useMobileDocumentZoom } from "@/app/hooks/useMobileDocumentZoom";
import { useAppUndo } from "@/app/hooks/useAppUndo";
import { useDocumentIo } from "@/app/hooks/useDocumentIo";
import { useDocumentMutations } from "@/app/hooks/useDocumentMutations";
import { useSaveStatus } from "@/app/hooks/useSaveStatus";
import { AboutModal } from "@/components/AboutModal";
import { AppHeader, AppFileInputs } from "@/components/AppHeader";
import { PageList } from "@/components/PageList";
import { SignatureModal } from "@/components/SignatureModal";

const RENDER_SCALE = 1.5;

export default function App() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const isMobile = useIsMobile();
  const documentState = useAppDocumentState();
  const contentState = useAppContentState();
  const toolState = useAppToolState();
  const { primaryFilename, loadedFileKey, sources, slots, slotById } = documentState;
  const {
    edits,
    imageMoves,
    editingByPage,
    insertedTexts,
    insertedImages,
    shapeDeletes,
    annotations,
    redactions,
    formValues,
  } = contentState;
  const {
    tool,
    setTool,
    pendingImage,
    setPendingImage,
    inkColor,
    setInkColor,
    inkThickness,
    setInkThickness,
    highlightColor,
    setHighlightColor,
    commentColor,
    setCommentColor,
  } = toolState;
  const { mobileHeaderRef, mobileHeaderH, mobileSidebarOpen, setMobileSidebarOpen } =
    useMobileChrome(isMobile);
  const [documentZoom, setDocumentZoom] = useState(MIN_DOCUMENT_ZOOM);
  const [busy, setBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const documentZoomTargetRef = useRef<HTMLDivElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const effectiveDocumentZoom = isMobile && slots.length > 0 ? documentZoom : MIN_DOCUMENT_ZOOM;
  const documentZoomHandlers = useMobileDocumentZoom({
    enabled: isMobile && slots.length > 0,
    zoom: effectiveDocumentZoom,
    targetRef: documentZoomTargetRef,
    onZoomChange: setDocumentZoom,
  });

  const { recordHistory, undo, redo, clearHistory, canUndo, canRedo, bindSelectionSetter } =
    useAppUndo({ documentState, contentState });

  const {
    selection,
    setSelection,
    onSelectImage,
    onSelectInsertedImage,
    onSelectShape,
    onSelectRedaction,
    onSelectHighlight,
    onSelectInk,
    onDeleteSelection,
  } = useSelection({
    recordHistory,
    contentActions: contentState.contentActions,
  });
  useEffect(() => {
    bindSelectionSetter(setSelection);
  }, [bindSelectionSetter, setSelection]);

  const { handleFile, onAddExternalPdfs, onPickImageFile, onSave } = useDocumentIo({
    renderScale: RENDER_SCALE,
    documentState,
    contentState,
    toolState,
    setDocumentZoom,
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
    documentState,
    contentState,
    toolState,
    recordHistory,
    setSelection,
  });

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
    documentState,
    contentState,
    toolState,
    busy,
  });

  return (
    <div
      className="flex flex-col h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
      data-loaded-file-key={loadedFileKey}
      data-loaded-filename={primaryFilename ?? ""}
      data-print-app
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
      <div className="flex flex-1 overflow-hidden" data-print-workspace>
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
          data-print-document-surface
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
              Open a PDF to begin.
            </div>
          ) : (
            <div ref={documentZoomTargetRef} className="w-full" data-print-document>
              <PageList
                document={{
                  slots,
                  sources,
                  previewCanvases,
                  renderScale: RENDER_SCALE,
                  documentZoom: effectiveDocumentZoom,
                }}
                content={{
                  edits,
                  imageMoves,
                  insertedTexts,
                  insertedImages,
                  annotations,
                  redactions,
                  shapeDeletes,
                  editingByPage,
                  formValues,
                }}
                toolState={{ tool, inkColor, inkThickness, highlightColor }}
                selectionModel={{ selection }}
                controller={{
                  onEdit,
                  onImageMove,
                  onEditingChange,
                  onCanvasClick,
                  onTextInsertChange,
                  onTextInsertDelete,
                  onImageInsertChange,
                  onImageInsertDelete,
                  onSelectImage,
                  onSelectInsertedImage,
                  onSelectShape,
                  onAnnotationAdd,
                  onAnnotationChange,
                  onAnnotationDelete,
                  onRedactionAdd,
                  onRedactionChange,
                  onSelectRedaction,
                  onSelectHighlight,
                  onSelectInk,
                  onDeleteSelection,
                  onFormFieldChange,
                }}
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
