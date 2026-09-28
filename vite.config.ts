import { patchPageFlipLifecycle } from "./scripts/pageFlipLifecyclePatch";
import { execFileSync } from "node:child_process";
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
    name: "page-flip-lifecycle",
    enforce: "pre",
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/page-flip/dist/js/page-flip.module.js")) return patchPageFlipLifecycle(code);
    },
  }, {
    name: "project-concept-index",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).filter(name => /\.(js|css)$/.test(name));
      const revision = assets.join("|").split("").reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0).toString(16);
      this.emitFile({ type: "asset", fileName: "offline-assets.js", source: `self.SPL_ASSETS=${JSON.stringify(assets)};self.SPL_REV=${JSON.stringify(revision)};` });
      const commit = process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      if (!/^[a-f0-9]{40,64}$/i.test(commit)) throw new Error("Invalid index build revision");
      const builtAt = new Date().toISOString();
      const stamp = `<div id="index-build-stamp" class="callout" style="margin:16px 0"><span lang="ar" dir="rtl">نسخة البناء المشتركة للتطبيق والإندكس</span> / <span lang="en" dir="ltr">App + index build</span>: <a href="https://github.com/gido70/Smart-Personal-Library/commit/${commit}" target="_blank" rel="noopener noreferrer"><code>${commit.slice(0, 8)}</code></a> · <time dir="ltr">${builtAt}</time></div>`;
      const indexSource = readFileSync(new URL("./docs/concept-index-v1.1.html", import.meta.url), "utf8");
      if (!indexSource.includes("<!-- INDEX_BUILD_STAMP -->")) throw new Error("Index build stamp placeholder missing");
      this.emitFile({ type: "asset", fileName: "concept-index.html", source: indexSource.replace("<!-- INDEX_BUILD_STAMP -->", stamp) });
      this.emitFile({ type: "asset", fileName: "release.json", source: JSON.stringify({ commit, builtAt, index: "concept-index.html" }) });
    },
  }],
  build: { outDir: "dist" },
});
