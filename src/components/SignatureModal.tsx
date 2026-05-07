import { Button, Modal, Tabs } from "@heroui/react";
import { Eraser, Image as ImageIcon, Plus, Signature, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AnnotationColor } from "@/domain/annotations";
import { colorToHex, colorsEqual, SIGNATURE_COLOR_PRESETS } from "@/domain/color";
import { useIsMobile } from "@/platform/hooks/useMediaQuery";
import {
  deleteSignatureAsset,
  listSignatureAssets,
  processDrawnSignature,
  processImportedSignature,
  type ProcessedSignatureImage,
  saveSignatureAsset,
  signatureAssetToPendingImage,
  type SignatureAsset,
} from "@/domain/signatures";

type PendingSignatureImage = {
  bytes: Uint8Array;
  format: "png";
  naturalWidth: number;
  naturalHeight: number;
};

type SignatureTab = "library" | "draw" | "import";

export function SignatureModal({
  isOpen,
  onOpenChange,
  onUseSignature,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onUseSignature: (image: PendingSignatureImage) => void;
}) {
  const [assets, setAssets] = useState<SignatureAsset[]>([]);
  const [tab, setTab] = useState<SignatureTab>("library");
  const [color, setColor] = useState<AnnotationColor>(SIGNATURE_COLOR_PRESETS[0].value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    const next = await listSignatureAssets();
    setAssets(next);
    if (next.length === 0) setTab("draw");
  };

  useEffect(() => {
    if (!isOpen) return;
    // Signature storage is an external browser system; loading on open
    // intentionally syncs that store into modal state.
    // oxlint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch((err) => {
      console.error("Failed to load signatures:", err);
      setError("Could not load saved signatures.");
    });
  }, [isOpen]);

  const saveProcessed = async (work: () => Promise<ProcessedSignatureImage | null>) => {
    setBusy(true);
    setError(null);
    try {
      const processed = await work();
      if (!processed) {
        setError("No signature marks were found.");
        return null;
      }
      const asset = await saveSignatureAsset(processed);
      setAssets((prev) => [asset, ...prev.filter((a) => a.id !== asset.id)]);
      setTab("library");
      return asset;
    } catch (err) {
      console.error("Failed to save signature:", err);
      setError("Could not save that signature.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const placeAsset = (asset: SignatureAsset) => {
    onUseSignature(signatureAssetToPendingImage(asset));
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog>
            <Modal.Header className="flex items-center gap-2">
              <Modal.Heading className="text-lg font-semibold">Add Signature</Modal.Heading>
              <Modal.CloseTrigger className="ml-auto" />
            </Modal.Header>
            <Modal.Body className="space-y-4 text-sm text-zinc-800 dark:text-zinc-200">
              {error ? (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                  {error}
                </div>
              ) : null}

              <Tabs
                selectedKey={tab}
                onSelectionChange={(key) => setTab(String(key) as SignatureTab)}
                variant="secondary"
              >
                <Tabs.ListContainer>
                  <Tabs.List aria-label="Signature source">
                    <Tabs.Tab id="library">
                      Saved
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id="draw">
                      Draw
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id="import">
                      Import
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
                <Tabs.Panel id="library" className="h-[300px] overflow-auto sm:h-[340px]">
                  <SignatureLibrary
                    assets={assets}
                    busy={busy}
                    onUse={placeAsset}
                    onCreate={() => setTab("draw")}
                    onDelete={(id) => {
                      setBusy(true);
                      deleteSignatureAsset(id)
                        .then(() => setAssets((prev) => prev.filter((a) => a.id !== id)))
                        .catch((err) => {
                          console.error("Failed to delete signature:", err);
                          setError("Could not delete that signature.");
                        })
                        .finally(() => setBusy(false));
                    }}
                  />
                </Tabs.Panel>
                <Tabs.Panel id="draw" className="h-[300px] overflow-auto sm:h-[340px]">
                  <DrawSignaturePanel
                    color={color}
                    onColorChange={setColor}
                    busy={busy}
                    onSave={(canvas) => {
                      void saveProcessed(() => processDrawnSignature(canvas, color));
                    }}
                    onSaveAndUse={(canvas) => {
                      void (async () => {
                        const asset = await saveProcessed(() =>
                          processDrawnSignature(canvas, color),
                        );
                        if (asset) placeAsset(asset);
                      })();
                    }}
                  />
                </Tabs.Panel>
                <Tabs.Panel id="import" className="h-[300px] overflow-auto sm:h-[340px]">
                  <ImportSignaturePanel
                    busy={busy}
                    fileInputRef={fileInputRef}
                    onPickFile={(file) => {
                      void saveProcessed(() =>
                        processImportedSignature(file, SIGNATURE_COLOR_PRESETS[0].value),
                      );
                    }}
                  />
                </Tabs.Panel>
              </Tabs>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function SignatureColorPicker({
  value,
  onChange,
}: {
  value: AnnotationColor;
  onChange: (next: AnnotationColor) => void;
}) {
  return (
    <div
      className="flex items-center gap-1"
      role="listbox"
      aria-label="Signature color"
      data-testid="signature-color-presets"
    >
      {SIGNATURE_COLOR_PRESETS.map((preset) => {
        const active = colorsEqual(value, preset.value);
        return (
          <Button
            key={preset.hex}
            isIconOnly
            size="sm"
            variant={active ? "primary" : "ghost"}
            aria-label={preset.label}
            onMouseDown={(e) => e.preventDefault()}
            onPress={() => onChange(preset.value)}
          >
            <span
              aria-hidden
              style={{
                width: 16,
                height: 16,
                borderRadius: 2,
                background: preset.hex,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.2) inset",
              }}
            />
          </Button>
        );
      })}
    </div>
  );
}

function SignatureLibrary({
  assets,
  busy,
  onUse,
  onCreate,
  onDelete,
}: {
  assets: SignatureAsset[];
  busy: boolean;
  onUse: (asset: SignatureAsset) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  if (assets.length === 0) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
        <Signature size={28} aria-hidden className="text-zinc-500" />
        <div className="text-zinc-600 dark:text-zinc-300">No saved signatures</div>
        <Button variant="primary" onPress={onCreate}>
          <Plus size={14} aria-hidden />
          Draw signature
        </Button>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {assets.map((asset) => (
        <SignatureCard
          key={asset.id}
          asset={asset}
          busy={busy}
          onUse={() => onUse(asset)}
          onDelete={() => onDelete(asset.id)}
        />
      ))}
    </div>
  );
}

function SignatureCard({
  asset,
  busy,
  onUse,
  onDelete,
}: {
  asset: SignatureAsset;
  busy: boolean;
  onUse: () => void;
  onDelete: () => void;
}) {
  const dataUrl = useMemo(() => bytesToPngDataUrl(asset.bytes), [asset.bytes]);
  return (
    <div className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="group relative">
        <button
          type="button"
          className="grid h-28 w-full cursor-pointer place-items-center rounded border border-zinc-200 bg-white transition hover:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-700"
          aria-label="Place saved signature"
          onClick={onUse}
        >
          <img src={dataUrl} alt="" className="max-h-20 max-w-full object-contain" />
        </button>
        <div
          className="absolute bottom-1 right-1 z-10 opacity-0 group-hover:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Button
            isIconOnly
            size="sm"
            variant="danger-soft"
            onPress={onDelete}
            isDisabled={busy}
            aria-label="Delete signature"
          >
            <Trash2 size={14} aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

function DrawSignaturePanel({
  color,
  onColorChange,
  busy,
  onSave,
  onSaveAndUse,
}: {
  color: AnnotationColor;
  onColorChange: (next: AnnotationColor) => void;
  busy: boolean;
  onSave: (canvas: HTMLCanvasElement) => void;
  onSaveAndUse: (canvas: HTMLCanvasElement) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const [empty, setEmpty] = useState(true);
  const isMobile = useIsMobile();
  const strokeCss = colorToHex(color);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = isMobile ? 3.25 : 2.5;
      ctx.strokeStyle = strokeCss;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    return () => ro.disconnect();
  }, [isMobile, strokeCss]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Color</span>
        <SignatureColorPicker value={color} onChange={onColorChange} />
      </div>
      <div
        ref={hostRef}
        className="min-h-0 flex-1 rounded border border-zinc-300 bg-white dark:border-zinc-700"
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none bg-white"
          data-testid="signature-draw-canvas"
          onPointerDown={(e) => {
            const p = point(e);
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d");
            if (!p || !canvas || !ctx) return;
            e.preventDefault();
            canvas.setPointerCapture(e.pointerId);
            drawingRef.current = true;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (!drawingRef.current) return;
            const p = point(e);
            const ctx = canvasRef.current?.getContext("2d");
            if (!p || !ctx) return;
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            setEmpty(false);
          }}
          onPointerUp={() => {
            drawingRef.current = false;
          }}
          onPointerCancel={() => {
            drawingRef.current = false;
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onPress={clear} isDisabled={empty || busy}>
          <Eraser size={14} aria-hidden />
          Clear
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            const canvas = canvasRef.current;
            if (canvas) onSave(canvas);
          }}
          isDisabled={empty || busy}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="primary"
          onPress={() => {
            const canvas = canvasRef.current;
            if (canvas) onSaveAndUse(canvas);
          }}
          isDisabled={empty || busy}
        >
          Save and place
        </Button>
      </div>
    </div>
  );
}

function ImportSignaturePanel({
  busy,
  fileInputRef,
  onPickFile,
}: {
  busy: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onPickFile: (file: File) => void;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        data-testid="signature-import-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPickFile(file);
          e.target.value = "";
        }}
      />
      <ImageIcon size={30} aria-hidden className="text-zinc-500" />
      <div className="max-w-sm text-zinc-600 dark:text-zinc-300">
        Import a signature image. Background cleanup and transparent trimming are applied before it
        is saved.
      </div>
      <Button variant="primary" onPress={() => fileInputRef.current?.click()} isDisabled={busy}>
        <Upload size={14} aria-hidden />
        Choose image
      </Button>
    </div>
  );
}

function bytesToPngDataUrl(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return `data:image/png;base64,${btoa(s)}`;
}
