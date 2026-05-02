import "./lib/polyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { injectFontFaces } from "./lib/fonts";
import { installErrorOverlay } from "./lib/errorOverlay";

// Opt-in on-page error overlay for debugging on devices without
// devtools (iPhone, etc.). Enable by appending `?debug=1` to the URL.
if (new URLSearchParams(window.location.search).has("debug")) {
  installErrorOverlay();
}
injectFontFaces();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
