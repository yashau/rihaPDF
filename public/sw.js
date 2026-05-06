const CACHE_NAME = "rihapdf-v1";
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
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/"));
    return;
  }

  if (shouldCacheAsset(request, url)) {
    event.respondWith(cacheFirst(request));
  }
});

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
