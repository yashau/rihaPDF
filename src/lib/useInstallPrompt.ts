import { useCallback, useEffect, useState } from "react";

type InstallPromptOutcome = {
  outcome: "accepted" | "dismissed";
  platform?: string;
};

type BeforeInstallPromptEvent = Event & {
  platforms?: string[];
  prompt: () => Promise<InstallPromptOutcome>;
};

function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function useInstallPrompt(): {
  canInstall: boolean;
  promptInstall: () => Promise<void>;
} {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandaloneDisplay());

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setInstalled(false);
    };
    const onAppInstalled = () => {
      setPromptEvent(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!promptEvent) return;
    const event = promptEvent;
    setPromptEvent(null);
    const result = await event.prompt();
    if (result.outcome === "accepted") {
      setInstalled(true);
    }
  }, [promptEvent]);

  return {
    canInstall: promptEvent !== null && !installed,
    promptInstall,
  };
}
