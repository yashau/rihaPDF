import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type ServiceWorkerListeners = {
  activate?: (event: ExtendableEventStub) => void;
  fetch?: (event: FetchEventStub) => void;
};

type ExtendableEventStub = {
  waitUntil: (promise: Promise<unknown>) => void;
};

type FetchEventStub = ExtendableEventStub & {
  request: Request;
  respondWith: (promise: Promise<Response>) => void;
};

class MemoryCache {
  private readonly entries = new Map<string, Response>();

  put(request: Request | string, response: Response): Promise<void> {
    this.entries.set(cacheKey(request), response);
    return Promise.resolve();
  }

  match(request: Request | string): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(cacheKey(request)));
  }

  delete(request: Request | string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(cacheKey(request)));
  }

  keys(): Promise<Request[]> {
    return Promise.resolve(Array.from(this.entries.keys(), (url) => new Request(url)));
  }
}

function cacheKey(request: Request | string): string {
  return typeof request === "string" ? request : request.url;
}

function loadServiceWorker() {
  const listeners: ServiceWorkerListeners = {};
  const cachesByName = new Map<string, MemoryCache>();
  const cacheStorage = {
    open(name: string) {
      let cache = cachesByName.get(name);
      if (!cache) {
        cache = new MemoryCache();
        cachesByName.set(name, cache);
      }
      return Promise.resolve(cache);
    },
    keys() {
      return Promise.resolve(Array.from(cachesByName.keys()));
    },
    delete(name: string) {
      return Promise.resolve(cachesByName.delete(name));
    },
  };
  const self = {
    location: { origin: "https://example.test" },
    clients: { claim: () => Promise.resolve(undefined) },
    skipWaiting: () => Promise.resolve(undefined),
    addEventListener(type: keyof ServiceWorkerListeners, handler: never) {
      listeners[type] = handler;
    },
  };

  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), {
    caches: cacheStorage,
    console,
    Date,
    fetch,
    Promise,
    Request,
    Response,
    self,
    URL,
  });

  return { cacheStorage, listeners };
}

async function dispatchDownloadFetch(listeners: ServiceWorkerListeners, url: string) {
  let responsePromise: Promise<Response> | undefined;
  const waits: Promise<unknown>[] = [];
  listeners.fetch?.({
    request: new Request(url),
    respondWith: (promise) => {
      responsePromise = promise;
    },
    waitUntil: (promise) => waits.push(promise),
  });
  expect(responsePromise).toBeDefined();
  const response = await responsePromise!;
  await Promise.all(waits);
  return response;
}

describe("service worker download cache", () => {
  it("serves a fresh cached download once and removes it", async () => {
    const { cacheStorage, listeners } = loadServiceWorker();
    const cache = await cacheStorage.open("rihapdf-downloads-v1");
    const url = "https://example.test/__rihapdf_downloads__/token/file.pdf";
    await cache.put(
      url,
      new Response("pdf", { headers: { "X-RihaPDF-Download-Expires": String(Date.now() + 1000) } }),
    );

    const response = await dispatchDownloadFetch(listeners, url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("pdf");
    expect(await cache.match(url)).toBeUndefined();
  });

  it("expires stale cached downloads without serving them", async () => {
    const { cacheStorage, listeners } = loadServiceWorker();
    const cache = await cacheStorage.open("rihapdf-downloads-v1");
    const url = "https://example.test/__rihapdf_downloads__/token/file.pdf";
    await cache.put(
      url,
      new Response("stale", {
        headers: { "X-RihaPDF-Download-Expires": String(Date.now() - 1) },
      }),
    );

    const response = await dispatchDownloadFetch(listeners, url);

    expect(response.status).toBe(410);
    expect(await response.text()).toBe("Download expired.");
    expect(await cache.match(url)).toBeUndefined();
  });
});
