import { useState } from "react";
import { Modal } from "@heroui/react";
import { Globe, Mail } from "lucide-react";
import { READABLE_STREAM_ASYNC_ITER_POLYFILLED } from "../lib/polyfills";

type BrowserId = "ios-safari" | "safari" | "firefox" | "chromium";

function detectBrowser(ua: string): BrowserId {
  // iOS forces every browser onto WebKit, so iPhone/iPad UAs are
  // grouped as ios-safari regardless of brand.
  if (/iPhone|iPad|iPod/.test(ua)) return "ios-safari";
  if (/Firefox\//.test(ua)) return "firefox";
  // Desktop Safari has "Safari/" but not "Chrome/" or "Chromium/".
  if (/Safari\//.test(ua) && !/Chrom(e|ium)\//.test(ua)) return "safari";
  return "chromium";
}

const BROWSER_LABEL: Record<BrowserId, string> = {
  "ios-safari": "iOS Safari",
  safari: "Safari",
  firefox: "Firefox",
  chromium: "Chrome",
};

function BrowserSupportSection() {
  const [shown, setShown] = useState(false);
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const browser = detectBrowser(ua);
  const label = BROWSER_LABEL[browser];
  // Min version per check for the detected browser. Sources: MDN compat
  // tables. Each tuple is [iosSafari, safari, firefox, chromium].
  const minVersion = (per: Record<BrowserId, string>) => `${label} ${per[browser]}+`;

  const checks: { label: string; status: "ok" | "missing" | "polyfilled" }[] = [
    {
      label: `ReadableStream async iterator (${minVersion({ "ios-safari": "—", safari: "—", firefox: "131", chromium: "124" })})`,
      status: READABLE_STREAM_ASYNC_ITER_POLYFILLED ? "polyfilled" : "ok",
    },
    {
      label: `Promise.withResolvers (${minVersion({ "ios-safari": "17.4", safari: "17.4", firefox: "121", chromium: "119" })})`,
      status:
        typeof (Promise as { withResolvers?: unknown }).withResolvers === "function"
          ? "ok"
          : "missing",
    },
    {
      label: `Set.prototype.intersection (${minVersion({ "ios-safari": "17", safari: "17", firefox: "127", chromium: "122" })})`,
      status:
        typeof (Set.prototype as { intersection?: unknown }).intersection === "function"
          ? "ok"
          : "missing",
    },
    {
      label: `Iterator.prototype.toArray (${minVersion({ "ios-safari": "18.4", safari: "18.4", firefox: "131", chromium: "122" })})`,
      status:
        typeof (globalThis as { Iterator?: { prototype?: { toArray?: unknown } } }).Iterator
          ?.prototype?.toArray === "function"
          ? "ok"
          : "missing",
    },
    {
      label: `Array.prototype.findLast (${minVersion({ "ios-safari": "15.4", safari: "15.4", firefox: "104", chromium: "97" })})`,
      status: typeof Array.prototype.findLast === "function" ? "ok" : "missing",
    },
    {
      label: `Object.groupBy (${minVersion({ "ios-safari": "17.4", safari: "17.4", firefox: "119", chromium: "117" })})`,
      status: typeof (Object as { groupBy?: unknown }).groupBy === "function" ? "ok" : "missing",
    },
    {
      label: `OffscreenCanvas (${minVersion({ "ios-safari": "16.4", safari: "16.4", firefox: "105", chromium: "69" })})`,
      status: typeof globalThis.OffscreenCanvas === "function" ? "ok" : "missing",
    },
    {
      label: `structuredClone (${minVersion({ "ios-safari": "15.4", safari: "15.4", firefox: "94", chromium: "98" })})`,
      status: typeof globalThis.structuredClone === "function" ? "ok" : "missing",
    },
  ];
  return (
    <section>
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 underline underline-offset-2"
      >
        {shown ? "Hide browser diagnostics" : "Show browser diagnostics"}
      </button>
      {shown && (
        <div className="mt-2">
          <ul className="space-y-0.5 text-zinc-700 dark:text-zinc-300 font-mono text-xs">
            {checks.map((c) => {
              const color =
                c.status === "ok"
                  ? "text-green-600 dark:text-green-400"
                  : c.status === "polyfilled"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400";
              return (
                <li key={c.label}>
                  <span className={color}>[{c.status}]</span> {c.label}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 break-all">UA: {ua}</p>
        </div>
      )}
    </section>
  );
}

export function AboutModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.CloseTrigger className="ml-auto" />
            </Modal.Header>
            <Modal.Body className="space-y-5 text-sm text-zinc-800 dark:text-zinc-200">
              <section className="flex flex-col items-center text-center gap-3">
                <Modal.Heading className="text-xl font-semibold">rihaPDF</Modal.Heading>
                <img src="/riha-logo.png" alt="" className="h-28 w-auto" />
                <p>
                  Browser-based PDF editor for Dhivehi / Thaana, with full RTL support.{" "}
                  <a
                    href="https://github.com/yashau/rihaPDF"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Open source
                  </a>{" "}
                  — contributions welcome.
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Features</h3>
                <ul className="list-disc list-inside space-y-0.5 text-zinc-700 dark:text-zinc-300">
                  <li>Edit text — RTL/LTR, <strong>B</strong>/<em>I</em>/<span className="underline">U</span>/<span className="line-through">S</span>/<span className="font-serif">font</span>/<span className="text-red-500">c</span><span className="text-orange-500">o</span><span className="text-yellow-500">l</span><span className="text-green-500">o</span><span className="text-blue-500">r</span></li>
                  <li>Insert and move text or images; delete any object</li>
                  <li>Highlight, comment, and ink annotations</li>
                  <li>Redact — no recoverable text under the rect</li>
                  <li>Reorder, delete, or insert pages</li>
                  <li>Phonetic Latin → Thaana keyboard on mobile</li>
                  <li>Saved PDFs keep real, selectable, searchable text</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Built with</h3>
                <ul className="list-disc list-inside space-y-0.5 text-zinc-700 dark:text-zinc-300">
                  <li>React 19 + TypeScript + Vite</li>
                  <li>Tailwind CSS + HeroUI + lucide-react</li>
                  <li>pdf-lib (write) and pdfjs-dist (render)</li>
                  <li>harfbuzzjs (shaping) and bidi-js (bidi)</li>
                  <li>Runs entirely in the browser — no server, no upload</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Author</h3>
                <p className="text-zinc-700 dark:text-zinc-300">Ibrahim Yashau</p>
                <p className="text-zinc-700 dark:text-zinc-300 flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                  <a
                    href="https://yashau.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                  >
                    <Globe size={14} aria-hidden />
                    yashau.com
                  </a>
                  <span aria-hidden>·</span>
                  <a
                    href="mailto:ibrahim@yashau.com"
                    className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                  >
                    <Mail size={14} aria-hidden />
                    ibrahim@yashau.com
                  </a>
                </p>
              </section>

              <BrowserSupportSection />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
