import type { ReactNode } from "react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "../lib/useMediaQuery";
import { useVisualViewportFollow } from "../lib/useVisualViewport";

export function ToolOptionsBar({
  label,
  children,
  mobileChildren,
}: {
  label: string;
  children: ReactNode;
  mobileChildren?: ReactNode;
}) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <MobileToolOptionsBar>{mobileChildren ?? children}</MobileToolOptionsBar>
  ) : (
    <DesktopToolOptionsBar label={label}>{children}</DesktopToolOptionsBar>
  );
}

function DesktopToolOptionsBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      data-edit-toolbar
      className="flex items-center gap-4 px-4 py-2 bg-zinc-50 text-zinc-900 border-b border-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-800"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function MobileToolOptionsBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useVisualViewportFollow(ref, "bottom", true);
  const node = (
    <div
      ref={ref}
      data-edit-toolbar
      className="border-t border-zinc-300 bg-white text-zinc-900 shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:[color-scheme:dark]"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        display: "flex",
        gap: 12,
        padding: 8,
        paddingBottom: `max(8px, var(--safe-bottom, 0px))`,
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
  if (typeof document !== "undefined") {
    return createPortal(node, document.body);
  }
  return node;
}
