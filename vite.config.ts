import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function stripHarfbuzzNodeFsBranch(): Plugin {
  return {
    name: "strip-harfbuzz-node-fs-branch",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.endsWith("/harfbuzzjs/hb.js")) return null;
      return {
        code: code.replace(
          'require("fs")',
          '({readFileSync(){throw new Error("fs is unavailable in browser")}})',
        ),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [stripHarfbuzzNodeFsBranch(), react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1400,
  },
});
