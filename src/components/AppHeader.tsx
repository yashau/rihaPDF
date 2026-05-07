import { AppFileInputs } from "@/components/AppHeader/AppFileInputs";
import { DesktopHeader } from "@/components/AppHeader/DesktopHeader";
import { MobileHeader } from "@/components/AppHeader/MobileHeader";
import type { AppHeaderProps } from "@/components/AppHeader/types";

export { AppFileInputs };

export function AppHeader(props: AppHeaderProps) {
  return props.isMobile ? <MobileHeader {...props} /> : <DesktopHeader {...props} />;
}
