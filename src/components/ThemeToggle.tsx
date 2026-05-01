// Top-bar control for picking system / light / dark. Compact 3-button
// segmented group — one click per mode, no menu indirection. The
// currently-selected mode is rendered in the "primary" variant; the
// others are "ghost" so the toolbar stays calm.

import { Button } from "@heroui/react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemeMode } from "../lib/theme";

type Props = {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
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

export function ThemeToggle({ mode, onChange }: Props) {
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
