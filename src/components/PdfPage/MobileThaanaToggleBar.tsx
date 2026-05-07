import { useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@heroui/react";
import { useVisualViewportFollow } from "@/platform/hooks/useVisualViewport";

export function MobileThaanaToggleBar({
  enabled,
  value,
  onChange,
}: {
  enabled: boolean;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useVisualViewportFollow(ref, "bottom", enabled);
  if (!enabled || typeof document === "undefined") return null;
  return createPortal(
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
        flexWrap: "wrap",
        gap: 6,
        padding: 8,
        paddingBottom: `max(8px, var(--safe-bottom, 0px))`,
        alignItems: "center",
        pointerEvents: "auto",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Button
        size="sm"
        variant={value ? "primary" : "ghost"}
        onPress={() => onChange(!value)}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={
          value
            ? "Thaana phonetic input (click to type Latin)"
            : "Latin input (click to type Thaana)"
        }
        style={{ minWidth: 44, fontWeight: 600, fontSize: 12, marginLeft: "auto" }}
      >
        {value ? "DV" : "EN"}
      </Button>
    </div>,
    document.body,
  );
}
