import type { PendingImage, ToolMode } from "@/domain/toolMode";
import type { ThemeMode } from "@/platform/theme";

export type HeaderCommonProps = {
  tool: ToolMode;
  setTool: (updater: ToolMode | ((prev: ToolMode) => ToolMode)) => void;
  pendingImage: PendingImage | null;
  setPendingImage: (v: PendingImage | null) => void;
  primaryFilename: string | null;
  busy: boolean;
  saveDisabled: boolean;
  totalChangeCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  imageFileInputRef: React.RefObject<HTMLInputElement | null>;
  onAboutOpen: () => void;
  onSignatureOpen: () => void;
  hasSources: boolean;
  toolTip: string | null;
};

export type AppHeaderProps = HeaderCommonProps & {
  isMobile: boolean;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (updater: boolean | ((prev: boolean) => boolean)) => void;
  mobileHeaderRef: React.RefObject<HTMLElement | null>;
  slotsLength: number;
};
