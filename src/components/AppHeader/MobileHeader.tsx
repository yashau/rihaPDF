import { Button } from "@heroui/react";
import {
  Check,
  FolderOpen,
  Highlighter,
  Image as ImageIcon,
  MessageSquare,
  MousePointer2,
  PanelLeft,
  Pencil,
  Redo2,
  Save,
  Signature,
  Square,
  Type,
  Undo2,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { AppHeaderProps } from "./types";

export function MobileHeader({
  tool,
  setTool,
  pendingImage,
  setPendingImage,
  primaryFilename,
  busy,
  saveDisabled,
  totalChangeCount,
  canUndo,
  canRedo,
  onOpen,
  onSave,
  onUndo,
  onRedo,
  themeMode,
  setThemeMode,
  imageFileInputRef,
  onAboutOpen,
  onSignatureOpen,
  hasSources,
  mobileSidebarOpen,
  setMobileSidebarOpen,
  mobileHeaderRef,
  slotsLength,
}: AppHeaderProps) {
  return (
    /* Mobile header — two stacked rows, icon-only tool buttons.
        position: fixed so it sits in front of the scrolling page
        list and so `useVisualViewportFollow` (above) can apply a
        visualViewport-driven transform that keeps it at constant
        visual size during pinch-zoom. <main> below receives a
        matching `paddingTop` so first-paint content isn't hidden
        behind the header. */
    <header
      ref={mobileHeaderRef}
      className="fixed inset-x-0 top-0 z-20 flex flex-col gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800"
      style={{ transformOrigin: "0 0" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onAboutOpen}
          className="flex items-center gap-1.5 cursor-pointer rounded hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 shrink-0"
          aria-label="About rihaPDF"
          style={{ touchAction: "manipulation" }}
        >
          <img src="/riha-logo.png" alt="" className="h-6 w-auto" />
          <h1 className="text-base font-semibold">
            rihaPDF
            <sup className="ml-0.5 text-[0.55rem] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              preview
            </sup>
          </h1>
        </button>
        {/* Filename slot doubles as the open-file affordance.
            Two render branches:
              - file loaded: subtle tappable filename with a
                folder-icon prefix to hint it swaps files.
              - empty: the primary "Open" Button itself sits in
                the slot — same styling as the old second-row
                button so it pulls the eye on first paint.
            The standalone Open button is omitted from the
            second row on mobile in all branches; this slot is
            the only path. The mid-tool tip text used to live
            here too — dropped to keep this row stable while a
            tool is active (the icon-only tool button is its own
            cue, and the row was getting crowded once Undo/Redo
            moved up here). */}
        {primaryFilename ? (
          <button
            type="button"
            onClick={onOpen}
            disabled={busy}
            className="flex items-center gap-1 min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 cursor-pointer rounded px-1 -mx-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={`Open a different PDF (current file: ${primaryFilename})`}
            style={{ touchAction: "manipulation" }}
            data-testid="mobile-open-target"
          >
            <FolderOpen size={12} aria-hidden className="shrink-0" />
            <span className="truncate">{primaryFilename}</span>
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <Button
              size="sm"
              variant="primary"
              isDisabled={busy}
              onPress={onOpen}
              aria-label="Open PDF"
              data-testid="mobile-open-target"
            >
              <FolderOpen size={14} aria-hidden />
              Open
            </Button>
          </div>
        )}
        {/* Save + Undo/Redo cluster: file-level controls grouped
            on the first row so the second row only carries the
            sidebar toggle + tool palette. Undo/Redo were on row
            2; moved up here to free row-2 space for an extra
            tool (Redact). All three are gated on `primaryFilename`
            because none make sense before a file is loaded. */}
        {primaryFilename && (
          <>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={saveDisabled}
              onPress={onSave}
              aria-label={`Save (${totalChangeCount} change${totalChangeCount === 1 ? "" : "s"})`}
            >
              <Save size={14} aria-hidden />
              Save
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              isDisabled={busy || !canUndo}
              onPress={onUndo}
              aria-label="Undo"
              data-testid="undo-mobile"
            >
              <Undo2 size={14} aria-hidden />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              isDisabled={busy || !canRedo}
              onPress={onRedo}
              aria-label="Redo"
              data-testid="redo-mobile"
            >
              <Redo2 size={14} aria-hidden />
            </Button>
          </>
        )}
        <div className="shrink-0">
          <ThemeToggle mode={themeMode} onChange={setThemeMode} cycle />
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          isDisabled={slotsLength === 0}
          onPress={() => setMobileSidebarOpen((v) => !v)}
          aria-label={mobileSidebarOpen ? "Close pages sidebar" : "Open pages sidebar"}
          aria-expanded={mobileSidebarOpen}
          data-testid="mobile-sidebar-toggle"
        >
          <PanelLeft size={14} aria-hidden />
        </Button>
        <div className="flex items-center gap-1 ml-1 pl-1 border-l border-zinc-200 dark:border-zinc-800">
          <Button
            isIconOnly
            size="sm"
            variant={tool === "select" ? "primary" : "ghost"}
            isDisabled={busy || !hasSources}
            onPress={() => {
              setTool("select");
              setPendingImage(null);
            }}
            aria-label="Select tool"
          >
            <MousePointer2 size={14} aria-hidden />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant={tool === "addText" ? "primary" : "ghost"}
            isDisabled={busy || !hasSources}
            onPress={() => {
              setTool((t) => (t === "addText" ? "select" : "addText"));
              setPendingImage(null);
            }}
            aria-label="Add text"
          >
            <Type size={14} aria-hidden />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant={
              tool === "addImage" && pendingImage?.kind !== "signature" ? "primary" : "ghost"
            }
            isDisabled={busy || !hasSources}
            onPress={() => {
              if (tool === "addImage" && pendingImage?.kind !== "signature") {
                setTool("select");
                setPendingImage(null);
              } else {
                imageFileInputRef.current?.click();
              }
            }}
            aria-label="Add image"
          >
            <ImageIcon size={14} aria-hidden />
            {pendingImage?.kind === "image" ? <Check size={12} aria-label="image queued" /> : null}
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant={
              tool === "addImage" && pendingImage?.kind === "signature" ? "primary" : "ghost"
            }
            isDisabled={busy || !hasSources}
            onPress={() => {
              setPendingImage(null);
              onSignatureOpen();
            }}
            aria-label="Signature"
          >
            <Signature size={14} aria-hidden />
            {pendingImage?.kind === "signature" ? (
              <Check size={12} aria-label="signature queued" />
            ) : null}
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant={tool === "highlight" ? "primary" : "ghost"}
            isDisabled={busy || !hasSources}
            onPress={() => {
              setTool((t) => (t === "highlight" ? "select" : "highlight"));
              setPendingImage(null);
            }}
            aria-label="Highlight"
          >
            <Highlighter size={14} aria-hidden />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant={tool === "redact" ? "primary" : "ghost"}
            isDisabled={busy || !hasSources}
            onPress={() => {
              setTool((t) => (t === "redact" ? "select" : "redact"));
              setPendingImage(null);
            }}
            aria-label="Redact"
          >
            <Square size={14} aria-hidden fill="currentColor" />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant={tool === "comment" ? "primary" : "ghost"}
            isDisabled={busy || !hasSources}
            onPress={() => {
              setTool((t) => (t === "comment" ? "select" : "comment"));
              setPendingImage(null);
            }}
            aria-label="Comment"
          >
            <MessageSquare size={14} aria-hidden />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant={tool === "ink" ? "primary" : "ghost"}
            isDisabled={busy || !hasSources}
            onPress={() => {
              setTool((t) => (t === "ink" ? "select" : "ink"));
              setPendingImage(null);
            }}
            aria-label="Draw"
          >
            <Pencil size={14} aria-hidden />
          </Button>
        </div>
      </div>
    </header>
  );
}
