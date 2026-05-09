const CACHE_NAME = "rihapdf-v1";
const DOWNLOAD_CACHE_NAME = "rihapdf-downloads-v1";
const DOWNLOAD_PATH_PREFIX = "/__rihapdf_downloads__/";
const DOWNLOAD_EXPIRES_HEADER = "X-RihaPDF-Download-Expires";
const CORE_ASSETS = [
  "/",
  "/site.webmanifest",
  "/favicon.ico",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/riha-logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== DOWNLOAD_CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => purgeExpiredDownloads())
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(DOWNLOAD_PATH_PREFIX)) {
    event.respondWith(serveDownload(request, event));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/"));
    return;
  }

  if (shouldCacheAsset(request, url)) {
    event.respondWith(cacheFirst(request));
  }
});

async function serveDownload(request, event) {
  const cache = await caches.open(DOWNLOAD_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    event.waitUntil(purgeExpiredDownloads(cache));
    if (isExpiredDownload(cached)) {
      event.waitUntil(cache.delete(request));
      return expiredDownloadResponse();
    }

    event.waitUntil(cache.delete(request));
    return cached;
  }
  event.waitUntil(purgeExpiredDownloads(cache));
  return expiredDownloadResponse();
}

async function purgeExpiredDownloads(cache = undefined) {
  const downloadCache = cache || (await caches.open(DOWNLOAD_CACHE_NAME));
  const requests = await downloadCache.keys();
  await Promise.all(
    requests.map(async (request) => {
      const response = await downloadCache.match(request);
      if (!response || isExpiredDownload(response)) {
        await downloadCache.delete(request);
      }
    }),
  );
}

function isExpiredDownload(response) {
  const expiresAt = Number(response.headers.get(DOWNLOAD_EXPIRES_HEADER));
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

function expiredDownloadResponse() {
  return new Response("Download expired.", {
    status: 410,
    headers: { "Content-Type": "text/plain;charset=utf-8", "Cache-Control": "no-store" },
  });
}

function shouldCacheAsset(request, url) {
  return (
    ["font", "image", "manifest", "script", "style", "worker"].includes(request.destination) ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/fonts/")
  );
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(fallbackUrl)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}
