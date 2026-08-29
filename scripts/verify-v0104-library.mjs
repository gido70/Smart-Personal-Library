import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("src/App.tsx");
const library = read("src/lib/library.ts");
const edge = read("supabase/functions/spl-ai/index.ts");
const worker = read("public/sw.js");
let failed = 0;
function check(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failed += 1;
}

check("retired one-book paid gate is absent", !/PILOT_BOOK_LIMIT/.test(edge) && !/PAID_PILOT_BOOK_LIMIT_REACHED/.test(edge));
check("per-book delete requires an explicit confirmation dialog", /confirm-delete-dialog/.test(app) && /نعم، احذف الكتاب/.test(app));
check("delete cleans database, PDF and generated audio", /from\("spl_books"\)\.delete/.test(library) && /from\("spl-books"\)\.remove/.test(library) && /from\("spl-audio"\)\.remove/.test(library));
check("categories are persisted in existing metadata", /updateBookCategory/.test(library) && /metadata.*category/.test(library));
check("empty library samples never invoke paid actions", /SAMPLE_BOOKS/.test(app) && /display-only examples/.test(app));
check("Samsung cover path downloads authenticated bytes", /downloadBookFile/.test(app) && /fileBlob\.arrayBuffer/.test(app));
check("notification bell and mobile destination are enabled", /🔔/.test(app) && !/disabled=\{id === "progress"\}/.test(app));
check("service worker cache advances to V0.10.4", /smart-personal-library-v0\.10\.4/.test(worker));

console.log(`\n${failed === 0 ? "ALL V0.10.4 LIBRARY CHECKS PASSED" : `${failed} V0.10.4 CHECK(S) FAILED`}`);
if (failed) process.exit(1);
