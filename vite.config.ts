import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// PDF.js loads JPEG 2000/JBIG2 and colour decoders at runtime. Vite's worker
// import alone does not bundle them. Ship the installed version, including
// the JavaScript fallback, on the same origin for Pages and mobile browsers.
const decoderTarget = fileURLToPath(new URL("./public/pdfjs/wasm/", import.meta.url));
mkdirSync(decoderTarget, { recursive: true });
cpSync(fileURLToPath(new URL("./node_modules/pdfjs-dist/wasm/", import.meta.url)), decoderTarget, { recursive: true });

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist" },
});
