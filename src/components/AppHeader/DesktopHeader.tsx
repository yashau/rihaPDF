import { Button } from "@heroui/react";
import {
  Check,
  FolderOpen,
  Highlighter,
  Image as ImageIcon,
  MessageSquare,
  MousePointer2,
  Pencil,
  Redo2,
  Save,
  Signature,
  Square,
  Type,
  Undo2,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { HeaderCommonProps } from "./types";

export function DesktopHeader({
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
  toolTip,
}: HeaderCommonProps) {
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
