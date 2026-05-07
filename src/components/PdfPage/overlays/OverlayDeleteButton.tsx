import { Trash2 } from "lucide-react";

export function OverlayDeleteButton({
  "aria-label": ariaLabel,
  onDelete,
  positionClassName = "-bottom-7 -right-2",
  style,
}: {
  "aria-label": string;
  onDelete: () => void;
  positionClassName?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      data-edit-toolbar
      aria-label={ariaLabel}
      className={`absolute ${positionClassName} w-5 h-5 rounded-full bg-white border border-zinc-300 text-red-600 shadow flex items-center justify-center hover:bg-red-50`}
      style={{ zIndex: 40, touchAction: "none", ...style }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDelete();
      }}
    >
      <Trash2 size={10} aria-hidden />
    </button>
  );
}
