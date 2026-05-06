import { Button } from "@heroui/react";
import {
  Check,
  Download,
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
import { ThemeToggle } from "./ThemeToggle";
import type { ThemeMode } from "../lib/theme";
import type { ToolMode } from "../App";

type PendingImage = {
  kind: "image" | "signature";
  bytes: Uint8Array;
  format: "png" | "jpeg";
  naturalWidth: number;
  naturalHeight: number;
};

type CommonProps = {
  tool: ToolMode;
  setTool: (updater: ToolMode | ((prev: ToolMode) => ToolMode)) => void;
  pendingImage: PendingImage | null;
  setPendingImage: (v: PendingImage | null) => void;
  primaryFilename: string | null;
  busy: boolean;
  saveDisabled: boolean;
  totalChangeCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  imageFileInputRef: React.RefObject<HTMLInputElement | null>;
  onAboutOpen: () => void;
  onSignatureOpen: () => void;
  canInstall: boolean;
  onInstall: () => void;
  hasSources: boolean;
  toolTip: string | null;
};

export function AppFileInputs({
  fileInputRef,
  imageFileInputRef,
  onPickPdf,
  onPickImage,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  imageFileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickPdf: (file: File) => void;
  onPickImage: (file: File) => void;
}) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        data-testid="open-pdf-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickPdf(f);
          e.target.value = "";
        }}
      />
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickImage(f);
          e.target.value = "";
        }}
      />
    </>
  );
}

export function AppHeader(
  props: CommonProps & {
    isMobile: boolean;
    mobileSidebarOpen: boolean;
    setMobileSidebarOpen: (updater: boolean | ((prev: boolean) => boolean)) => void;
    mobileHeaderRef: React.RefObject<HTMLElement | null>;
    slotsLength: number;
  },
) {
  return props.isMobile ? <MobileHeader {...props} /> : <DesktopHeader {...props} />;
}

function DesktopHeader({
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
  canInstall,
  onInstall,
  hasSources,
  toolTip,
}: CommonProps) {
  return (
    /* Desktop header — single row, full labels. */
    <header className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={onAboutOpen}
        className="flex items-center gap-2 mr-4 cursor-pointer rounded hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        aria-label="About rihaPDF"
      >
        <img src="/riha-logo.png" alt="" className="h-7 w-auto" />
        <h1 className="text-lg font-semibold">
          rihaPDF
          <sup className="ml-0.5 text-[0.6rem] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            preview
          </sup>
        </h1>
      </button>
      <Button variant="primary" isDisabled={busy} onPress={onOpen}>
        <FolderOpen size={16} aria-hidden />
        Open PDF
      </Button>
      {canInstall ? (
        <Button variant="ghost" isDisabled={busy} onPress={onInstall} aria-label="Install app">
          <Download size={16} aria-hidden />
          Install
        </Button>
      ) : null}
      <Button
        variant="secondary"
        isDisabled={saveDisabled}
        onPress={onSave}
        // Keep the visible label fixed-width — the change-count
        // breakdown lives only in aria-label so the button can't
        // grow and shift the toolbar to its right when the user
        // accumulates edits.
        aria-label={`Save (${totalChangeCount} change${totalChangeCount === 1 ? "" : "s"})`}
      >
        <Save size={16} aria-hidden />
        Save
      </Button>
      <Button
        variant="ghost"
        isDisabled={busy || !canUndo}
        onPress={onUndo}
        aria-label="Undo"
        data-testid="undo"
      >
        <Undo2 size={16} aria-hidden />
        Undo
      </Button>
      <Button
        variant="ghost"
        isDisabled={busy || !canRedo}
        onPress={onRedo}
        aria-label="Redo"
        data-testid="redo"
      >
        <Redo2 size={16} aria-hidden />
        Redo
      </Button>
      <div className="flex items-center gap-1 ml-2 border-l pl-3">
        <Button
          size="sm"
          variant={tool === "select" ? "primary" : "ghost"}
          isDisabled={busy || !hasSources}
          onPress={() => {
            setTool("select");
            setPendingImage(null);
          }}
        >
          <MousePointer2 size={14} aria-hidden />
          Select
        </Button>
        <Button
          size="sm"
          variant={tool === "addText" ? "primary" : "ghost"}
          isDisabled={busy || !hasSources}
          onPress={() => {
            setTool((t) => (t === "addText" ? "select" : "addText"));
            setPendingImage(null);
          }}
        >
          <Type size={14} aria-hidden />+ Text
        </Button>
        <Button
          size="sm"
          variant={tool === "addImage" && pendingImage?.kind !== "signature" ? "primary" : "ghost"}
          isDisabled={busy || !hasSources}
          onPress={() => {
            if (tool === "addImage" && pendingImage?.kind !== "signature") {
              setTool("select");
              setPendingImage(null);
            } else {
              imageFileInputRef.current?.click();
            }
          }}
        >
          <ImageIcon size={14} aria-hidden />+ Image
          {pendingImage?.kind === "image" ? <Check size={14} aria-label="image queued" /> : null}
        </Button>
        <Button
          size="sm"
          variant={tool === "addImage" && pendingImage?.kind === "signature" ? "primary" : "ghost"}
          isDisabled={busy || !hasSources}
          onPress={() => {
            setPendingImage(null);
            onSignatureOpen();
          }}
          aria-label="Signature"
          data-testid="tool-signature"
        >
          <Signature size={14} aria-hidden />+ Signature
          {pendingImage?.kind === "signature" ? (
            <Check size={14} aria-label="signature queued" />
          ) : null}
        </Button>
        <Button
          size="sm"
          variant={tool === "highlight" ? "primary" : "ghost"}
          isDisabled={busy || !hasSources}
          onPress={() => {
            setTool((t) => (t === "highlight" ? "select" : "highlight"));
            setPendingImage(null);
          }}
          aria-label="Highlight"
          data-testid="tool-highlight"
        >
          <Highlighter size={14} aria-hidden />
          Highlight
        </Button>
        <Button
          size="sm"
          variant={tool === "redact" ? "primary" : "ghost"}
          isDisabled={busy || !hasSources}
          onPress={() => {
            setTool((t) => (t === "redact" ? "select" : "redact"));
            setPendingImage(null);
          }}
          aria-label="Redact"
          data-testid="tool-redact"
        >
          <Square size={14} aria-hidden fill="currentColor" />
          Redact
        </Button>
        <Button
          size="sm"
          variant={tool === "comment" ? "primary" : "ghost"}
          isDisabled={busy || !hasSources}
          onPress={() => {
            setTool((t) => (t === "comment" ? "select" : "comment"));
            setPendingImage(null);
          }}
          aria-label="Comment"
          data-testid="tool-comment"
        >
          <MessageSquare size={14} aria-hidden />
          Comment
        </Button>
        <Button
          size="sm"
          variant={tool === "ink" ? "primary" : "ghost"}
          isDisabled={busy || !hasSources}
          onPress={() => {
            setTool((t) => (t === "ink" ? "select" : "ink"));
            setPendingImage(null);
          }}
          aria-label="Draw"
          data-testid="tool-ink"
        >
          <Pencil size={14} aria-hidden />
          Draw
        </Button>
      </div>
      {/* Filename / tool-tip slot. `truncate` + `min-w-0` keeps long
          filenames on a single line — without this, a 30+ char name
          like `maldivian2.move-only.pdf` wraps and grows the header
          by a row, shifting every page down by a few pixels and
          breaking layout-sensitive tests (and visually nudging the
          document under the user). */}
      <span className="text-sm text-zinc-500 dark:text-zinc-400 ml-auto truncate min-w-0 max-w-xs">
        {toolTip ?? primaryFilename ?? "No file loaded"}
      </span>
      <div className="flex items-center border-l border-zinc-200 dark:border-zinc-800 pl-3 ml-1">
        <ThemeToggle mode={themeMode} onChange={setThemeMode} />
      </div>
    </header>
  );
}

function MobileHeader({
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
  canInstall,
  onInstall,
  hasSources,
  mobileSidebarOpen,
  setMobileSidebarOpen,
  mobileHeaderRef,
  slotsLength,
}: CommonProps & {
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (updater: boolean | ((prev: boolean) => boolean)) => void;
  mobileHeaderRef: React.RefObject<HTMLElement | null>;
  slotsLength: number;
}) {
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
        {canInstall ? (
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            isDisabled={busy}
            onPress={onInstall}
            aria-label="Install app"
          >
            <Download size={14} aria-hidden />
          </Button>
        ) : null}
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
