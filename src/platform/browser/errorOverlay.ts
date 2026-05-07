// Fixed-position on-page overlay for uncaught errors / unhandled
// promise rejections. Lets us read the actual failure on devices where
// dev-tools aren't available (iPhone without a paired Mac).

export function installErrorOverlay(): void {
  if (typeof window === "undefined") return;

  const container = document.createElement("div");
  container.id = "riha-error-overlay";
  container.style.cssText = [
    "position:fixed",
    "left:0",
    "right:0",
    "bottom:0",
    "max-height:50vh",
    "overflow:auto",
    "z-index:2147483647",
    "background:rgba(180,0,0,0.95)",
    "color:#fff",
    "font:12px/1.4 ui-monospace,Menlo,Consolas,monospace",
    "padding:12px 14px",
    "white-space:pre-wrap",
    "word-break:break-word",
    "display:none",
    "box-shadow:0 -2px 12px rgba(0,0,0,0.4)",
  ].join(";");
  const messages: string[] = [];

  const dismiss = document.createElement("button");
  dismiss.textContent = "×";
  dismiss.style.cssText = [
    "position:sticky",
    "top:0",
    "float:right",
    "background:transparent",
    "border:0",
    "color:#fff",
    "font-size:18px",
    "cursor:pointer",
    "padding:0 6px",
  ].join(";");
  dismiss.addEventListener("click", () => {
    container.style.display = "none";
  });

  const body = document.createElement("div");
  container.appendChild(dismiss);
  container.appendChild(body);

  const append = (label: string, info: string) => {
    messages.push(`[${new Date().toISOString().slice(11, 19)}] ${label}: ${info}`);
    body.textContent = messages.join("\n\n");
    container.style.display = "block";
  };

  const formatError = (err: unknown): string => {
    if (err instanceof Error) {
      return `${err.name}: ${err.message}\n${err.stack ?? "(no stack)"}`;
    }
    try {
      return typeof err === "string" ? err : JSON.stringify(err);
    } catch {
      return String(err);
    }
  };

  window.addEventListener("error", (ev) => {
    const where = ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : "(unknown location)";
    append("error", `${ev.message}\nat ${where}\n${formatError(ev.error)}`);
  });

  window.addEventListener("unhandledrejection", (ev) => {
    append("unhandledrejection", formatError(ev.reason));
  });

  // Worker errors don't bubble to window — they fire on the Worker
  // instance. pdf.js creates its worker internally so we can't
  // attach a listener there directly; wrap the Worker constructor
  // to attach `error` / `messageerror` listeners on every spawned
  // worker.
  const OriginalWorker = window.Worker;
  if (OriginalWorker) {
    const Wrapped = function (this: Worker, scriptURL: string | URL, options?: WorkerOptions) {
      const w = new OriginalWorker(scriptURL, options);
      w.addEventListener("error", (ev) => {
        const where = ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : "(worker)";
        append("worker error", `${ev.message}\nat ${where}\nscript: ${String(scriptURL)}`);
      });
      w.addEventListener("messageerror", () => {
        append("worker messageerror", `script: ${String(scriptURL)}`);
      });
      return w;
    } as unknown as typeof Worker;
    Wrapped.prototype = OriginalWorker.prototype;
    window.Worker = Wrapped;
  }

  // Surface console.error to the overlay too — many libraries log a
  // diagnostic before throwing, and on devices without devtools that
  // diagnostic is invisible.
  const origConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      append("console.error", args.map(formatError).join(" "));
    } catch {
      /* ignore */
    }
    origConsoleError(...args);
  };

  const ready = () => document.body.appendChild(container);
  if (document.body) ready();
  else document.addEventListener("DOMContentLoaded", ready);
}
