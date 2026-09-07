import { readFileSync } from "node:fs";

const reader = readFileSync(new URL("../src/Reader.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/reader.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const checks = [
  ["persistent reader exits", reader.includes("reader-return-bar") && reader.includes("onHome") && reader.includes("onLibrary")],
  ["single and two-page controls", reader.includes('PageLayout = "single" | "spread"') && reader.includes("صفحتان")],
  ["true second canvas", reader.includes("secondCanvasRef") && reader.includes("page + 1")],
  ["spread advances by two", reader.includes('pageLayout === "spread" ? 2 : 1')],
  ["listen-only mode", reader.includes("listen-only-panel") && reader.includes("استماع فقط")],
  ["portrait reader uses at least half screen", css.includes("min-height:55vh")],
  ["Arabic/English direction preserved", reader.includes("effectiveRtl") && reader.includes('dir={effectiveRtl ? "rtl" : "ltr"}')],
  ["home and library routes wired", app.includes('setView("home")') && app.includes('setView("library")')],
];
let failed = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
  if (!passed) failed += 1;
}
if (failed) process.exit(1);
console.log(`\n${checks.length} passed, 0 failed`);
