import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("src/App.tsx");
const library = read("src/lib/library.ts");
const edge = read("supabase/functions/spl-ai/index.ts");
const worker = read("public/sw.js");
const styles = read("src/v0103.css");
const requestMigration = read("supabase/migrations/20260830_0005_spl_v0104_idempotent_ai_requests.sql");
let failed = 0;
function check(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failed += 1;
}

check("retired one-book paid gate is absent", !/PILOT_BOOK_LIMIT/.test(edge) && !/PAID_PILOT_BOOK_LIMIT_REACHED/.test(edge));
check("six active books use safe archive instead of permanent deletion", /MAX_ACTIVE_BOOKS = 6/.test(library) && /archivePilotBook/.test(library) && /نقل الكتاب إلى الأرشيف/.test(app));
check("six-book shelf is three-by-two on desktop and one-column on mobile", /active-book-grid\{grid-template-columns:repeat\(3/.test(styles) && /max-width:760px\)\{\.active-book-grid,\.live-book-grid\{grid-template-columns:1fr/.test(styles));
check("seventh-book entry is blocked before the upload modal", /const openUpload/.test(app) && /activeCount >= MAX_ACTIVE_BOOKS/.test(app) && /onUpload=\{openUpload\}/.test(app));
check("archive preserves paid outputs", /الخلاصة والتحليل والصوت والأسئلة/.test(app) && !/نعم، احذف الكتاب/.test(app));
check("eleven fixed classification gateways are defined", /DEWEY_GATEWAYS/.test(app) && /MODERN_GATEWAY/.test(app) && /بوابات التصنيف الإحدى عشرة/.test(app));
check("classification supports Dewey plus modern topic on one book", /dewey_main/.test(library) && /dewey_branch/.test(library) && /modern_topic/.test(library));
check("empty library samples never invoke paid actions", /SAMPLE_BOOKS/.test(app) && /display-only examples/.test(app));
check("empty library presents six samples", /رحلة في تاريخ العلوم/.test(app) && /مدخل إلى علم النفس/.test(app));
check("Samsung cover path downloads authenticated bytes", /downloadBookFile/.test(app) && /fileBlob\.arrayBuffer/.test(app));
check("notification bell and mobile destination are enabled", /🔔/.test(app) && !/disabled=\{id === "progress"\}/.test(app));
check("service worker cache advances to V0.10.4", /smart-personal-library-v0\.10\.4/.test(worker));
check("upload accepts 30 MB while preserving 500-page cap", /MAX_UPLOAD_BYTES = 30/.test(library) && /TOO_MANY_PAGES_500/.test(library) && /31457280/.test(requestMigration));
check("daily limits and reset time are visible", /getAiLimitsSnapshot/.test(app) && /تتجدد الحدود اليومية/.test(app));
check("interrupted paid task has visible moving progress", /durable-task-banner/.test(app) && /taskStorageKey/.test(app));
check("server-side idempotency receipt is additive and owner-scoped", /spl_ai_requests/.test(requestMigration) && /unique \(user_id, idempotency_key\)/.test(requestMigration) && /enable row level security/.test(requestMigration));

console.log(`\n${failed === 0 ? "ALL V0.10.4 LIBRARY CHECKS PASSED" : `${failed} V0.10.4 CHECK(S) FAILED`}`);
if (failed) process.exit(1);
