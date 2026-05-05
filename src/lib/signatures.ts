import type { AnnotationColor } from "./annotations";
import { colorToHex } from "./color";

export type SignatureAsset = {
  id: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  colorHex: string;
  bytes: Uint8Array;
};

export type ProcessedSignatureImage = {
  bytes: Uint8Array;
  naturalWidth: number;
  naturalHeight: number;
  colorHex: string;
};

type SignatureRecord = Omit<SignatureAsset, "bytes"> & {
  bytes: ArrayBuffer;
};

const DB_NAME = "rihaPDF.signatures";
const DB_VERSION = 1;
const STORE = "assets";
const MAX_IMPORT_DIMENSION = 1600;
const TRIM_ALPHA_THRESHOLD = 8;
const TRIM_PAD = 8;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to open signature storage"));
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Signature storage operation failed"));
        tx.onerror = () => reject(tx.error ?? new Error("Signature storage transaction failed"));
      }),
  );
}

function recordToAsset(r: SignatureRecord): SignatureAsset {
  return {
    ...r,
    bytes: new Uint8Array(r.bytes),
  };
}

export async function listSignatureAssets(): Promise<SignatureAsset[]> {
  const records = await withStore<SignatureRecord[]>("readonly", (store) => {
    return store.getAll() as IDBRequest<SignatureRecord[]>;
  });
  return records
    .map(recordToAsset)
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

export async function saveSignatureAsset(image: ProcessedSignatureImage): Promise<SignatureAsset> {
  const now = Date.now();
  const asset: SignatureAsset = {
    id: `sig-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    width: image.naturalWidth,
    height: image.naturalHeight,
    colorHex: image.colorHex,
    bytes: image.bytes,
  };
  const record: SignatureRecord = {
    ...asset,
    bytes: copyToArrayBuffer(asset.bytes),
  };
  await withStore("readwrite", (store) => store.put(record));
  return asset;
}

export async function deleteSignatureAsset(id: string): Promise<void> {
  await withStore<undefined>("readwrite", (store) => store.delete(id));
}

export function signatureAssetToPendingImage(asset: SignatureAsset): {
  bytes: Uint8Array;
  format: "png";
  naturalWidth: number;
  naturalHeight: number;
} {
  return {
    bytes: asset.bytes,
    format: "png",
    naturalWidth: asset.width,
    naturalHeight: asset.height,
  };
}

export async function processDrawnSignature(
  canvas: HTMLCanvasElement,
  color: AnnotationColor,
): Promise<ProcessedSignatureImage | null> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width <= 0 || canvas.height <= 0) return null;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return imageDataToTrimmedPng(image, color, "alpha");
}

export async function processImportedSignature(
  file: File,
  color: AnnotationColor,
): Promise<ProcessedSignatureImage | null> {
  if (!file.type.startsWith("image/")) return null;
  const decoded = await decodeImageFile(file);
  if (!decoded) return null;
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, MAX_IMPORT_DIMENSION / Math.max(decoded.width, decoded.height));
  canvas.width = Math.max(1, Math.round(decoded.width * scale));
  canvas.height = Math.max(1, Math.round(decoded.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
  decoded.close?.();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mode = hasUsefulAlpha(image.data) ? "alpha" : "remove-background";
  return imageDataToTrimmedPng(image, color, mode);
}

async function decodeImageFile(file: File): Promise<{
  image: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
} | null> {
  try {
    if ("createImageBitmap" in window) {
      const bmp = await createImageBitmap(file);
      return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    }
  } catch {
    // Fall through to the HTMLImageElement decoder.
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ image: img, width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function hasUsefulAlpha(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 245) return true;
  }
  return false;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

async function imageDataToTrimmedPng(
  image: ImageData,
  color: AnnotationColor,
  mode: "alpha" | "remove-background",
): Promise<ProcessedSignatureImage | null> {
  const { width, height, data } = image;
  const out = new ImageData(width, height);
  const target = color.map((c) => Math.max(0, Math.min(255, Math.round(c * 255))));
  const bg = mode === "remove-background" ? estimateBorderColor(data, width, height) : null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 4;
      const alpha =
        mode === "alpha"
          ? data[off + 3]
          : Math.round(255 * backgroundRemovalAlpha(data[off], data[off + 1], data[off + 2], bg!));
      const a = alpha < TRIM_ALPHA_THRESHOLD ? 0 : alpha;
      out.data[off] = target[0];
      out.data[off + 1] = target[1];
      out.data[off + 2] = target[2];
      out.data[off + 3] = a;
      if (a > TRIM_ALPHA_THRESHOLD) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  minX = Math.max(0, minX - TRIM_PAD);
  minY = Math.max(0, minY - TRIM_PAD);
  maxX = Math.min(width - 1, maxX + TRIM_PAD);
  maxY = Math.min(height - 1, maxY + TRIM_PAD);
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const canvas = document.createElement("canvas");
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const cropped = new ImageData(cropW, cropH);
  for (let y = 0; y < cropH; y++) {
    const srcStart = ((minY + y) * width + minX) * 4;
    const srcEnd = srcStart + cropW * 4;
    cropped.data.set(out.data.slice(srcStart, srcEnd), y * cropW * 4);
  }
  ctx.putImageData(cropped, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    naturalWidth: cropW,
    naturalHeight: cropH,
    colorHex: colorToHex(color),
  };
}

function backgroundRemovalAlpha(
  r: number,
  g: number,
  b: number,
  bg: [number, number, number],
): number {
  const dist = colorDistance(r, g, b, bg[0], bg[1], bg[2]);
  const bgLum = luminance(bg[0], bg[1], bg[2]);
  const lum = luminance(r, g, b);
  const darkInkBoost = bgLum > 170 ? smoothstep(18, 130, bgLum - lum) : 0;
  const chromaDist = smoothstep(28, 96, dist);
  return Math.max(chromaDist, darkInkBoost);
}

function estimateBorderColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  const border = Math.max(3, Math.min(10, Math.floor(Math.min(width, height) / 24)));
  const step = Math.max(1, Math.floor(Math.max(width, height) / 400));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const add = (x: number, y: number) => {
    const off = (y * width + x) * 4;
    if (data[off + 3] < 16) return;
    rs.push(data[off]);
    gs.push(data[off + 1]);
    bs.push(data[off + 2]);
  };
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < border; x += step) add(x, y);
    for (let x = Math.max(border, width - border); x < width; x += step) add(x, y);
  }
  for (let x = 0; x < width; x += step) {
    for (let y = 0; y < border; y += step) add(x, y);
    for (let y = Math.max(border, height - border); y < height; y += step) add(x, y);
  }
  return [median(rs), median(gs), median(bs)];
}

function median(values: number[]): number {
  if (values.length === 0) return 255;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function colorDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
