import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { loadPdf, renderPage } from "./lib/pdf";
import type { RenderedPage } from "./lib/pdf";
import { extractPageFontShows } from "./lib/sourceFonts";
import { extractPageGlyphMaps } from "./lib/glyphMap";
import { extractPageImages } from "./lib/sourceImages";
import { PDFDocument } from "pdf-lib";
import {
  applyEditsAndSave,
  downloadBlob,
  type Edit,
  type ImageInsert,
  type ImageMove,
  type PageOp,
  type TextInsert,
} from "./lib/save";
import {
  buildPreviewBytes,
  renderPagePreviewCanvas,
  type PageStripSpec,
} from "./lib/preview";
import {
  readImageFile,
  type ImageInsertion,
  type TextInsertion,
} from "./lib/insertions";
import { PdfPage, type EditValue, type ImageMoveValue } from "./components/PdfPage";

export type ToolMode = "select" | "addText" | "addImage";

const RENDER_SCALE = 1.5;

export default function App() {
  const [filename, setFilename] = useState<string | null>(null);
  const [originalBytes, setOriginalBytes] = useState<ArrayBuffer | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  /** Map<pageIndex, Map<runId, EditValue>> */
  const [edits, setEdits] = useState<Map<number, Map<string, EditValue>>>(
    new Map(),
  );
  /** Map<pageIndex, Map<imageId, ImageMoveValue>> — drag offsets per
   *  image, identical shape to edits but for image XObject placements. */
  const [imageMoves, setImageMoves] = useState<
    Map<number, Map<string, ImageMoveValue>>
  >(new Map());
  const [pageOps, setPageOps] = useState<PageOp[]>([]);
  const [busy, setBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Per-page replacement canvases produced by the live preview pipeline.
   *  When present, PdfPage paints `previewCanvases.get(pageIndex)`
   *  instead of the original `page.canvas` — that's how the original
   *  glyphs / images are actually removed from the render rather than
   *  covered with a white box. */
  const [previewCanvases, setPreviewCanvases] = useState<
    Map<number, HTMLCanvasElement>
  >(new Map());
  /** Monotonic generation counter used to discard stale preview-rebuild
   *  results when the user keeps editing during the rebuild. */
  const previewGenRef = useRef(0);
  /** Map<pageIndex, currently-open runId> — populated by PdfPage's
   *  onEditingChange. Folded into the preview-strip spec so an open
   *  editor immediately hides the original glyph behind it. */
  const [editingByPage, setEditingByPage] = useState<Map<number, string>>(
    new Map(),
  );
  /** Tool mode for click-to-place actions ("select" = no insertion;
   *  "addText" = next click on a page drops a new text box; "addImage"
   *  = next click drops the pending image at that position). */
  const [tool, setTool] = useState<ToolMode>("select");
  /** Per-page net-new text/image insertions — separate from edits
   *  because they don't reference an existing run/image. */
  const [insertedTexts, setInsertedTexts] = useState<
    Map<number, TextInsertion[]>
  >(new Map());
  const [insertedImages, setInsertedImages] = useState<
    Map<number, ImageInsertion[]>
  >(new Map());
  /** When the user picks an image file, we hold its bytes here until
   *  they click on a page to place it. Cleared on placement / cancel. */
  const [pendingImage, setPendingImage] = useState<{
    bytes: Uint8Array;
    format: "png" | "jpeg";
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const forPdfJs = buf.slice(0);
      const forSave = buf.slice(0);
      const forFonts = buf.slice(0);
      const forGlyphMaps = buf.slice(0);
      const forImages = buf.slice(0);
      const [doc, fontShowsByPage, glyphsDoc, imagesByPage] = await Promise.all([
        loadPdf(forPdfJs),
        extractPageFontShows(forFonts),
        PDFDocument.load(forGlyphMaps, { ignoreEncryption: true }),
        extractPageImages(forImages),
      ]);
      const rendered: RenderedPage[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const glyphMaps = extractPageGlyphMaps(glyphsDoc, i - 1);
        rendered.push(
          await renderPage(
            page,
            RENDER_SCALE,
            fontShowsByPage[i - 1] ?? [],
            glyphMaps,
            imagesByPage[i - 1] ?? [],
          ),
        );
      }
      setFilename(file.name);
      setOriginalBytes(forSave);
      setPages(rendered);
      // Dev-only: expose run.contentStreamOpIndices to E2E tests so a
      // probe can inspect what the strip pipeline thinks each run owns
      // without re-running the whole extractor in the browser.
      (
        window as unknown as {
          __runOpIndices?: Map<string, number[]>;
        }
      ).__runOpIndices = new Map(
        rendered.flatMap((p) =>
          p.textRuns.map((r) => [r.id, r.contentStreamOpIndices]),
        ),
      );
      setEdits(new Map());
      setImageMoves(new Map());
      setPageOps([]);
      setPreviewCanvases(new Map());
      setInsertedTexts(new Map());
      setInsertedImages(new Map());
      setTool("select");
      setPendingImage(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const onEdit = useCallback(
    (pageIndex: number, runId: string, value: EditValue) => {
      setEdits((prev) => {
        const next = new Map(prev);
        const pageMap = new Map(next.get(pageIndex) ?? new Map());
        pageMap.set(runId, value);
        next.set(pageIndex, pageMap);
        return next;
      });
    },
    [],
  );

  const onImageMove = useCallback(
    (pageIndex: number, imageId: string, value: ImageMoveValue) => {
      setImageMoves((prev) => {
        const next = new Map(prev);
        const pageMap = new Map(next.get(pageIndex) ?? new Map());
        pageMap.set(imageId, value);
        next.set(pageIndex, pageMap);
        return next;
      });
    },
    [],
  );

  // Rebuild the per-page preview canvases whenever the set of edited
  // runs or moved images changes. The preview is a copy of the source
  // PDF with those items REMOVED from the content stream — pdf.js then
  // renders a clean canvas for each affected page, and the HTML
  // overlays in PdfPage paint the moved/edited content on top with
  // nothing to hide. Debounced so a fast edit loop doesn't spawn a
  // dozen overlapping renders.
  useEffect(() => {
    if (!originalBytes || pages.length === 0) return;
    const specs: PageStripSpec[] = [];
    const affected = new Set<number>([
      ...edits.keys(),
      ...imageMoves.keys(),
      ...editingByPage.keys(),
    ]);
    for (const pi of affected) {
      const runIds = new Set(edits.get(pi)?.keys() ?? []);
      // Currently-open editor counts as "needs strip" too — we want
      // the original to vanish the moment the input appears, not only
      // after commit.
      const editing = editingByPage.get(pi);
      if (editing) runIds.add(editing);
      const imageIds = new Set(
        Array.from(imageMoves.get(pi) ?? new Map()).flatMap(([id, v]) =>
          (v.dx ?? 0) !== 0 ||
          (v.dy ?? 0) !== 0 ||
          (v.dw ?? 0) !== 0 ||
          (v.dh ?? 0) !== 0
            ? [id]
            : [],
        ),
      );
      if (runIds.size === 0 && imageIds.size === 0) continue;
      specs.push({ pageIndex: pi, runIds, imageIds });
    }
    if (specs.length === 0) {
      // Nothing left modified — drop any cached preview canvases so the
      // pristine `page.canvas` shows again.
      setPreviewCanvases((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    const gen = ++previewGenRef.current;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const previewBytes = await buildPreviewBytes(
          originalBytes.slice(0),
          pages,
          specs,
        );
        if (cancelled || previewGenRef.current !== gen) return;
        const next = new Map<number, HTMLCanvasElement>();
        for (const spec of specs) {
          const canvas = await renderPagePreviewCanvas(
            previewBytes,
            spec.pageIndex,
            RENDER_SCALE,
          );
          if (cancelled || previewGenRef.current !== gen) return;
          next.set(spec.pageIndex, canvas);
        }
        if (cancelled || previewGenRef.current !== gen) return;
        setPreviewCanvases(next);
      } catch (err) {
        // Don't tear down editing on a preview failure — fall back to
        // the original canvas (the user just sees the old glyphs along
        // with overlays, same as before this feature).
        console.warn("preview rebuild failed", err);
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [originalBytes, pages, edits, imageMoves, editingByPage]);

  const onEditingChange = useCallback(
    (pageIndex: number, runId: string | null) => {
      setEditingByPage((prev) => {
        const next = new Map(prev);
        if (runId) next.set(pageIndex, runId);
        else next.delete(pageIndex);
        return next;
      });
    },
    [],
  );

  /** Handle a click on a page when a tool mode is active — drops a new
   *  text/image insertion at the click position (PDF user space). */
  const onCanvasClick = useCallback(
    (pageIndex: number, pdfX: number, pdfY: number) => {
      if (tool === "addText") {
        const id = `p${pageIndex + 1}-t${Date.now().toString(36)}`;
        // Default font size: 12pt — tweakable via the editor toolbar.
        const ins: TextInsertion = {
          id,
          pageIndex,
          pdfX,
          pdfY,
          pdfWidth: 120,
          fontSize: 12,
          text: "",
        };
        setInsertedTexts((prev) => {
          const next = new Map(prev);
          const arr = [...(next.get(pageIndex) ?? []), ins];
          next.set(pageIndex, arr);
          return next;
        });
        setTool("select");
        // Open the editor for the brand-new text box automatically.
        setEditingByPage((prev) => {
          const next = new Map(prev);
          next.set(pageIndex, id);
          return next;
        });
        return;
      }
      if (tool === "addImage" && pendingImage) {
        const id = `p${pageIndex + 1}-ni${Date.now().toString(36)}`;
        // Drop with a sensible initial size: scale to fit ~200pt wide
        // while preserving aspect ratio, capped to the picture's
        // natural pixel dimensions.
        const targetW = Math.min(pendingImage.naturalWidth, 200);
        const aspect = pendingImage.naturalHeight / pendingImage.naturalWidth;
        const w = targetW;
        const h = targetW * aspect;
        const ins: ImageInsertion = {
          id,
          pageIndex,
          pdfX: pdfX - w / 2,
          pdfY: pdfY - h / 2,
          pdfWidth: w,
          pdfHeight: h,
          bytes: pendingImage.bytes,
          format: pendingImage.format,
        };
        setInsertedImages((prev) => {
          const next = new Map(prev);
          const arr = [...(next.get(pageIndex) ?? []), ins];
          next.set(pageIndex, arr);
          return next;
        });
        setPendingImage(null);
        setTool("select");
      }
    },
    [tool, pendingImage],
  );

  /** Update an inserted text box (text/style/position changes). */
  const onTextInsertChange = useCallback(
    (pageIndex: number, id: string, patch: Partial<TextInsertion>) => {
      setInsertedTexts((prev) => {
        const next = new Map(prev);
        const arr = (next.get(pageIndex) ?? []).map((t) =>
          t.id === id ? { ...t, ...patch } : t,
        );
        next.set(pageIndex, arr);
        return next;
      });
    },
    [],
  );
  const onTextInsertDelete = useCallback(
    (pageIndex: number, id: string) => {
      setInsertedTexts((prev) => {
        const next = new Map(prev);
        const arr = (next.get(pageIndex) ?? []).filter((t) => t.id !== id);
        next.set(pageIndex, arr);
        return next;
      });
    },
    [],
  );
  const onImageInsertChange = useCallback(
    (pageIndex: number, id: string, patch: Partial<ImageInsertion>) => {
      setInsertedImages((prev) => {
        const next = new Map(prev);
        const arr = (next.get(pageIndex) ?? []).map((m) =>
          m.id === id ? { ...m, ...patch } : m,
        );
        next.set(pageIndex, arr);
        return next;
      });
    },
    [],
  );
  const onImageInsertDelete = useCallback(
    (pageIndex: number, id: string) => {
      setInsertedImages((prev) => {
        const next = new Map(prev);
        const arr = (next.get(pageIndex) ?? []).filter((m) => m.id !== id);
        next.set(pageIndex, arr);
        return next;
      });
    },
    [],
  );

  const onPickImageFile = useCallback(async (file: File) => {
    const parsed = await readImageFile(file);
    if (!parsed) {
      console.warn("Unsupported image format (PNG/JPEG only):", file.name);
      return;
    }
    setPendingImage(parsed);
    setTool("addImage");
  }, []);

  const onSave = useCallback(async () => {
    if (!originalBytes || !filename) return;
    setBusy(true);
    try {
      const flatEdits: Edit[] = [];
      for (const [pageIndex, runs] of edits) {
        for (const [runId, value] of runs) {
          flatEdits.push({
            pageIndex,
            runId,
            newText: value.text,
            style: value.style,
            dx: value.dx,
            dy: value.dy,
          });
        }
      }
      const flatImageMoves: ImageMove[] = [];
      for (const [pageIndex, imgs] of imageMoves) {
        for (const [imageId, value] of imgs) {
          const dx = value.dx ?? 0;
          const dy = value.dy ?? 0;
          const dw = value.dw ?? 0;
          const dh = value.dh ?? 0;
          if (dx === 0 && dy === 0 && dw === 0 && dh === 0) continue;
          flatImageMoves.push({
            pageIndex,
            imageId,
            dx,
            dy,
            dw,
            dh,
          });
        }
      }
      const flatTextInserts: TextInsert[] = [];
      for (const arr of insertedTexts.values()) {
        for (const t of arr) {
          if (!t.text || t.text.trim().length === 0) continue;
          flatTextInserts.push({
            pageIndex: t.pageIndex,
            pdfX: t.pdfX,
            pdfY: t.pdfY,
            fontSize: t.fontSize,
            text: t.text,
            style: t.style,
          });
        }
      }
      const flatImageInserts: ImageInsert[] = [];
      for (const arr of insertedImages.values()) {
        for (const i of arr) {
          flatImageInserts.push({
            pageIndex: i.pageIndex,
            pdfX: i.pdfX,
            pdfY: i.pdfY,
            pdfWidth: i.pdfWidth,
            pdfHeight: i.pdfHeight,
            bytes: i.bytes,
            format: i.format,
          });
        }
      }
      const out = await applyEditsAndSave(
        originalBytes,
        pages,
        flatEdits,
        pageOps,
        flatImageMoves,
        flatTextInserts,
        flatImageInserts,
      );
      const baseName = filename.replace(/\.pdf$/i, "");
      downloadBlob(out, `${baseName}.edited.pdf`);
    } finally {
      setBusy(false);
    }
  }, [
    originalBytes,
    filename,
    edits,
    imageMoves,
    pageOps,
    pages,
    insertedTexts,
    insertedImages,
  ]);

  const totalEdits = Array.from(edits.values()).reduce(
    (sum, m) => sum + m.size,
    0,
  );
  const totalImageMoves = Array.from(imageMoves.values()).reduce(
    (sum, m) => sum + m.size,
    0,
  );
  const totalInsertedTexts = Array.from(insertedTexts.values()).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const totalInsertedImages = Array.from(insertedImages.values()).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );

  return (
    <div className="flex flex-col h-screen bg-zinc-100">
      <header className="flex items-center gap-3 px-4 py-3 bg-white border-b">
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="flex items-center gap-2 mr-4 cursor-pointer rounded hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="About rihaPDF"
        >
          <img src="/riha-logo.png" alt="" className="h-7 w-auto" />
          <h1 className="text-lg font-semibold">rihaPDF</h1>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="primary"
          isDisabled={busy}
          onPress={() => fileInputRef.current?.click()}
        >
          Open PDF
        </Button>
        <Button
          variant="secondary"
          isDisabled={
            !originalBytes ||
            busy ||
            totalEdits +
              totalImageMoves +
              pageOps.length +
              totalInsertedTexts +
              totalInsertedImages ===
              0
          }
          onPress={onSave}
        >
          Save ({totalEdits} edit{totalEdits === 1 ? "" : "s"}
          {totalImageMoves
            ? `, ${totalImageMoves} image move${totalImageMoves === 1 ? "" : "s"}`
            : ""}
          {totalInsertedTexts
            ? `, +${totalInsertedTexts} text${totalInsertedTexts === 1 ? "" : "s"}`
            : ""}
          {totalInsertedImages
            ? `, +${totalInsertedImages} image${totalInsertedImages === 1 ? "" : "s"}`
            : ""}
          {pageOps.length ? `, ${pageOps.length} page op` : ""})
        </Button>
        <div className="flex items-center gap-1 ml-2 border-l pl-3">
          <Button
            size="sm"
            variant={tool === "select" ? "primary" : "ghost"}
            isDisabled={busy || pages.length === 0}
            onPress={() => {
              setTool("select");
              setPendingImage(null);
            }}
          >
            Select
          </Button>
          <Button
            size="sm"
            variant={tool === "addText" ? "primary" : "ghost"}
            isDisabled={busy || pages.length === 0}
            onPress={() => {
              setTool((t) => (t === "addText" ? "select" : "addText"));
              setPendingImage(null);
            }}
          >
            + Text
          </Button>
          <Button
            size="sm"
            variant={tool === "addImage" ? "primary" : "ghost"}
            isDisabled={busy || pages.length === 0}
            onPress={() => {
              if (tool === "addImage") {
                setTool("select");
                setPendingImage(null);
              } else {
                imageFileInputRef.current?.click();
              }
            }}
          >
            + Image{pendingImage ? " ✓" : ""}
          </Button>
          <input
            ref={imageFileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickImageFile(f);
              e.target.value = "";
            }}
          />
        </div>
        <span className="text-sm text-zinc-500 ml-auto">
          {tool === "addText"
            ? "Click on a page to drop a text box"
            : tool === "addImage" && pendingImage
              ? "Click on a page to place the image"
              : filename ?? "No file loaded"}
        </span>
      </header>
      <main className="flex-1 overflow-auto px-6 py-6">
        {pages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-400">
            Open a PDF to begin. Double-click any text fragment to edit it.
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            {pages.map((page, idx) => (
              <PageWithToolbar
                key={`${filename}-${idx}`}
                page={page}
                pageIndex={idx}
                edits={edits.get(idx) ?? new Map()}
                imageMoves={imageMoves.get(idx) ?? new Map()}
                insertedTexts={insertedTexts.get(idx) ?? []}
                insertedImages={insertedImages.get(idx) ?? []}
                previewCanvas={previewCanvases.get(idx) ?? null}
                tool={tool}
                editingId={editingByPage.get(idx) ?? null}
                onEdit={(runId, value) => onEdit(idx, runId, value)}
                onImageMove={(imageId, value) =>
                  onImageMove(idx, imageId, value)
                }
                onEditingChange={(runId) => onEditingChange(idx, runId)}
                onCanvasClick={(pdfX, pdfY) =>
                  onCanvasClick(idx, pdfX, pdfY)
                }
                onTextInsertChange={(id, patch) =>
                  onTextInsertChange(idx, id, patch)
                }
                onTextInsertDelete={(id) => onTextInsertDelete(idx, id)}
                onImageInsertChange={(id, patch) =>
                  onImageInsertChange(idx, id, patch)
                }
                onImageInsertDelete={(id) => onImageInsertDelete(idx, id)}
                onPageOp={(op) => setPageOps((prev) => [...prev, op])}
              />
            ))}
          </div>
        )}
      </main>
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

function AboutModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-heading"
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-[92vw] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-6 pt-4 pb-2 border-b">
          <h2 id="about-heading" className="text-xl font-semibold">
            rihaPDF
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto text-zinc-500 hover:text-zinc-900 cursor-pointer text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 text-sm text-zinc-800">
          <section className="flex flex-col items-center text-center gap-3">
            <img src="/riha-logo.png" alt="" className="h-28 w-auto" />
            <p>
              Browser-based PDF editor focused on Dhivehi / Thaana documents.
              Click any text run on a page, type a replacement, save. The saved
              PDF contains real, selectable, searchable text — original glyphs
              are surgically removed and replaced with new ones rendered in the
              correct font. rihaPDF is{" "}
              <a
                href="https://github.com/yashau/rihaPDF"
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
              >
                open source
              </a>{" "}
              and contributions are welcome.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 mb-1">Features</h3>
            <ul className="list-disc list-inside space-y-0.5 text-zinc-700">
              <li>Edit existing text runs in place</li>
              <li>Insert new text and images anywhere on a page</li>
              <li>Move and resize inserted images; move text and image runs</li>
              <li>Saved PDFs keep real, selectable, searchable text</li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 mb-1">Built with</h3>
            <ul className="list-disc list-inside space-y-0.5 text-zinc-700">
              <li>React 19 + TypeScript + Vite</li>
              <li>Tailwind CSS + HeroUI</li>
              <li>pdf-lib (write) and pdfjs-dist (render)</li>
              <li>bidi-js for bidirectional text</li>
              <li>Runs entirely in the browser — no server, no upload</li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold text-zinc-900 mb-1">Author</h3>
            <p className="text-zinc-700">Ibrahim Yashau</p>
            <ul className="mt-1 space-y-0.5">
              <li>
                <a
                  href="https://yashau.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  yashau.com
                </a>
              </li>
              <li>
                <a
                  href="mailto:ibrahim@yashau.com"
                  className="text-blue-600 hover:underline"
                >
                  ibrahim@yashau.com
                </a>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function PageWithToolbar({
  page,
  pageIndex,
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  previewCanvas,
  tool,
  editingId,
  onEdit,
  onImageMove,
  onEditingChange,
  onCanvasClick,
  onTextInsertChange,
  onTextInsertDelete,
  onImageInsertChange,
  onImageInsertDelete,
  onPageOp,
}: {
  page: RenderedPage;
  pageIndex: number;
  edits: Map<string, EditValue>;
  imageMoves: Map<string, ImageMoveValue>;
  insertedTexts: TextInsertion[];
  insertedImages: ImageInsertion[];
  previewCanvas: HTMLCanvasElement | null;
  tool: ToolMode;
  editingId: string | null;
  onEdit: (runId: string, value: EditValue) => void;
  onImageMove: (imageId: string, value: ImageMoveValue) => void;
  onEditingChange: (runId: string | null) => void;
  onCanvasClick: (pdfX: number, pdfY: number) => void;
  onTextInsertChange: (id: string, patch: Partial<TextInsertion>) => void;
  onTextInsertDelete: (id: string) => void;
  onImageInsertChange: (id: string, patch: Partial<ImageInsertion>) => void;
  onImageInsertDelete: (id: string) => void;
  onPageOp: (op: PageOp) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-2 items-center text-sm">
        <span className="text-zinc-500">Page {pageIndex + 1}</span>
        <Button
          size="sm"
          variant="ghost"
          onPress={() =>
            onPageOp({ kind: "insertBlank", afterPageIndex: pageIndex })
          }
        >
          + Blank after
        </Button>
        <Button
          size="sm"
          variant="danger-soft"
          onPress={() => onPageOp({ kind: "remove", pageIndex })}
        >
          Remove
        </Button>
      </div>
      <PdfPage
        page={page}
        pageIndex={pageIndex}
        edits={edits}
        imageMoves={imageMoves}
        insertedTexts={insertedTexts}
        insertedImages={insertedImages}
        previewCanvas={previewCanvas}
        tool={tool}
        editingId={editingId}
        onEdit={onEdit}
        onImageMove={onImageMove}
        onEditingChange={onEditingChange}
        onCanvasClick={onCanvasClick}
        onTextInsertChange={onTextInsertChange}
        onTextInsertDelete={onTextInsertDelete}
        onImageInsertChange={onImageInsertChange}
        onImageInsertDelete={onImageInsertDelete}
      />
    </div>
  );
}
