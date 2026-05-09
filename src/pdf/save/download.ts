const DOWNLOAD_CACHE_NAME = "rihapdf-downloads-v1";
const DOWNLOAD_PATH_PREFIX = "/__rihapdf_downloads__/";
const DOWNLOAD_CACHE_TTL_MS = 60_000;
const DOWNLOAD_EXPIRES_HEADER = "X-RihaPDF-Download-Expires";

export async function downloadBlob(bytes: Uint8Array, filename: string): Promise<void> {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  if (isAppleMobileBrowser() && (await downloadViaServiceWorker(blob, filename))) return;

  triggerAnchorDownload(URL.createObjectURL(blob), filename, true);
}

async function downloadViaServiceWorker(blob: Blob, filename: string): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  if (!(await waitForServiceWorkerController())) return false;
  if (!("caches" in window)) return false;

  try {
    const token =
      "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36)}`;
    const url = new URL(
      `${DOWNLOAD_PATH_PREFIX}${encodeURIComponent(token)}/${encodeURIComponent(filename)}`,
      window.location.origin,
    );
    const cache = await caches.open(DOWNLOAD_CACHE_NAME);
    const expiresAt = Date.now() + DOWNLOAD_CACHE_TTL_MS;
    await cache.put(
      url.toString(),
      new Response(blob, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": contentDisposition(filename),
          "Content-Type": "application/pdf",
          [DOWNLOAD_EXPIRES_HEADER]: String(expiresAt),
        },
      }),
    );

    triggerAnchorDownload(url.toString(), filename, false);
    setTimeout(() => {
      void cache.delete(url.toString());
    }, DOWNLOAD_CACHE_TTL_MS);
    return true;
  } catch (err) {
    console.warn("Service-worker PDF download failed; falling back to blob URL.", err);
    return false;
  }
}

async function waitForServiceWorkerController(): Promise<boolean> {
  if (navigator.serviceWorker.controller) return true;

  await Promise.race([
    navigator.serviceWorker.ready.catch(() => undefined),
    new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
        once: true,
      });
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 750)),
  ]);

  return Boolean(navigator.serviceWorker.controller);
}

function triggerAnchorDownload(href: string, filename: string, revokeObjectUrl: boolean): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revokeObjectUrl) setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function isAppleMobileBrowser(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
