import { useCallback, useRef, useState } from "react";
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
  type ImageMove,
  type PageOp,
} from "./lib/save";
import { PdfPage, type EditValue, type ImageMoveValue } from "./components/PdfPage";

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      setEdits(new Map());
      setImageMoves(new Map());
      setPageOps([]);
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
          if ((value.dx ?? 0) === 0 && (value.dy ?? 0) === 0) continue;
          flatImageMoves.push({
            pageIndex,
            imageId,
            dx: value.dx,
            dy: value.dy,
          });
        }
      }
      const out = await applyEditsAndSave(
        originalBytes,
        pages,
        flatEdits,
        pageOps,
        flatImageMoves,
      );
      const baseName = filename.replace(/\.pdf$/i, "");
      downloadBlob(out, `${baseName}.edited.pdf`);
    } finally {
      setBusy(false);
    }
  }, [originalBytes, filename, edits, imageMoves, pageOps, pages]);

  const totalEdits = Array.from(edits.values()).reduce(
    (sum, m) => sum + m.size,
    0,
  );
  const totalImageMoves = Array.from(imageMoves.values()).reduce(
    (sum, m) => sum + m.size,
    0,
  );

  return (
    <div className="flex flex-col h-screen bg-zinc-100">
      <header className="flex items-center gap-3 px-4 py-3 bg-white border-b">
        <h1 className="text-lg font-semibold mr-4">Dhivehi PDF Editor</h1>
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
            totalEdits + totalImageMoves + pageOps.length === 0
          }
          onPress={onSave}
        >
          Save ({totalEdits} edit{totalEdits === 1 ? "" : "s"}
          {totalImageMoves
            ? `, ${totalImageMoves} image move${totalImageMoves === 1 ? "" : "s"}`
            : ""}
          {pageOps.length ? `, ${pageOps.length} page op` : ""})
        </Button>
        <span className="text-sm text-zinc-500 ml-auto">
          {filename ?? "No file loaded"}
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
                onEdit={(runId, value) => onEdit(idx, runId, value)}
                onImageMove={(imageId, value) =>
                  onImageMove(idx, imageId, value)
                }
                onPageOp={(op) => setPageOps((prev) => [...prev, op])}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function PageWithToolbar({
  page,
  pageIndex,
  edits,
  imageMoves,
  onEdit,
  onImageMove,
  onPageOp,
}: {
  page: RenderedPage;
  pageIndex: number;
  edits: Map<string, EditValue>;
  imageMoves: Map<string, ImageMoveValue>;
  onEdit: (runId: string, value: EditValue) => void;
  onImageMove: (imageId: string, value: ImageMoveValue) => void;
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
        onEdit={onEdit}
        onImageMove={onImageMove}
      />
    </div>
  );
}
