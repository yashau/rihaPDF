// Top-bar control for picking system / light / dark. Two layouts:
// segmented (default) renders all three options side-by-side with the
// active one highlighted — one tap per mode, no indirection. Cycle
// mode renders a single icon-only button that advances through
// system → light → dark → system on each tap, used in the cramped
// mobile header where the segmented row competes with the filename.

import { Button } from "@heroui/react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemeMode } from "../lib/theme";

type Props = {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  /** When true, render a single button that cycles through modes
   *  instead of the 3-button segmented row. */
  cycle?: boolean;
};

const OPTIONS: Array<{
  mode: ThemeMode;
  Icon: typeof Sun;
  label: string;
}> = [
  { mode: "system", Icon: Monitor, label: "System theme" },
  { mode: "light", Icon: Sun, label: "Light theme" },
  { mode: "dark", Icon: Moon, label: "Dark theme" },
];

export function ThemeToggle({ mode, onChange, cycle = false }: Props) {
  if (cycle) {
    const idx = OPTIONS.findIndex((o) => o.mode === mode);
    const current = OPTIONS[idx === -1 ? 0 : idx];
    const next = OPTIONS[(idx + 1) % OPTIONS.length];
    const Icon = current.Icon;
    return (
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={`Theme: ${current.label}. Tap to switch to ${next.label}.`}
        title={`Theme: ${current.label}`}
        data-testid={`theme-cycle-${current.mode}`}
        onPress={() => onChange(next.mode)}
      >
        <Icon size={14} aria-hidden />
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Theme">
      {OPTIONS.map(({ mode: m, Icon, label }) => (
        <Button
          key={m}
          isIconOnly
          size="sm"
          variant={mode === m ? "primary" : "ghost"}
          aria-label={label}
          aria-pressed={mode === m}
          data-testid={`theme-${m}`}
          onPress={() => onChange(m)}
        >
          <Icon size={14} aria-hidden />
        </Button>
      ))}
    </div>
  );
}
