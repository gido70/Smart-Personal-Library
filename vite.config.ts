import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// PDF.js loads JPEG 2000/JBIG2 and colour decoders at runtime. Vite's worker
// import alone does not bundle them. Ship the installed version, including
// the JavaScript fallback, on the same origin for Pages and mobile browsers.
const decoderTarget = fileURLToPath(new URL("./public/pdfjs/wasm/", import.meta.url));
mkdirSync(decoderTarget, { recursive: true });
cpSync(fileURLToPath(new URL("./node_modules/pdfjs-dist/wasm/", import.meta.url)), decoderTarget, { recursive: true });

export default defineConfig({
  base: "./",
  plugins: [react(), {
    name: "project-concept-index",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).filter(name => /\.(js|css)$/.test(name));
      const revision = assets.join("|").split("").reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0).toString(16);
      this.emitFile({ type: "asset", fileName: "offline-assets.js", source: `self.SPL_ASSETS=${JSON.stringify(assets)};self.SPL_REV=${JSON.stringify(revision)};` });
      this.emitFile({ type: "asset", fileName: "concept-index.html", source: readFileSync(new URL("./docs/concept-index-v1.1.html", import.meta.url), "utf8") });
    },
  }],
  build: { outDir: "dist" },
});
