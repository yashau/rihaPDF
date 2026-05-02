// Polyfill `ReadableStream.prototype[Symbol.asyncIterator]` (and its
// alias `.values()`) for WebKit. As of Safari 18 / iOS 18 the spec'd
// async-iterator protocol on ReadableStream is unimplemented, so any
// `for await (const v of stream) ...` throws "undefined is not a
// function" — pdf.js's `getTextContent` hits this exact path.
//
// Loaded synchronously from main.tsx before any other module that
// might transitively touch pdf.js.

/** True if `ReadableStream.prototype[Symbol.asyncIterator]` was missing
 *  natively and we polyfilled it below. Surfaced in the About-modal
 *  diagnostics so we can tell at a glance whether a given browser is
 *  using the native impl or our shim. */
export const READABLE_STREAM_ASYNC_ITER_POLYFILLED =
  typeof ReadableStream !== "undefined" && !(Symbol.asyncIterator in ReadableStream.prototype);

if (READABLE_STREAM_ASYNC_ITER_POLYFILLED) {
  async function* values<T>(
    this: ReadableStream<T>,
    options?: { preventCancel?: boolean },
  ): AsyncGenerator<T> {
    const reader = this.getReader();
    const preventCancel = options?.preventCancel === true;
    try {
      while (true) {
        const r = await reader.read();
        if (r.done) return;
        yield r.value;
      }
    } finally {
      if (!preventCancel) {
        // Best-effort cancel; swallow because we're in iterator
        // cleanup and cancel itself can reject.
        reader.cancel().catch(() => {});
      }
      reader.releaseLock();
    }
  }
  // Install on the prototype. TS marks these as read-only, hence the cast.
  const proto = ReadableStream.prototype as unknown as Record<string | symbol, unknown>;
  proto.values = values;
  proto[Symbol.asyncIterator] = values;
}
