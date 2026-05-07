import { AppFileInputs } from "./AppFileInputs";
import { DesktopHeader } from "./DesktopHeader";
import { MobileHeader } from "./MobileHeader";
import type { AppHeaderProps } from "./types";

export { AppFileInputs };

export function AppHeader(props: AppHeaderProps) {
  return props.isMobile ? <MobileHeader {...props} /> : <DesktopHeader {...props} />;
}
