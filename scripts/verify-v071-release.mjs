import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const legacyApp = read("src/App.tsx");
const app = read("src/AppV11.tsx");
const main = read("src/main.tsx");
const reader = read("src/Reader.tsx");
const library = read("src/lib/library.ts");
const supabaseClient = read("src/lib/supabase.ts");
const v011ReviewCss = read("src/v011-review-fixes.css");
const edge = read("supabase/functions/spl-ai/index.ts");
const migration = read("supabase/migrations/20260826_0002_spl_v07_zero_cost.sql");
const speakPage = reader.slice(reader.indexOf("const speakPage"), reader.indexOf("const close"));

let failed = 0;
function check(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failed += 1;
}

check("V0.11 is selected by default", /legacy \? <App \/> : <AppV11 \/>/.test(main));
check("legacy saved-reader exit remains intact", /onExitSavedBook[\s\S]{0,180}setView\(activePilotBook \? "pilot" : "library"\)/.test(legacyApp));
check("upload UI accepts PDF only", /accept="application\/pdf,\.pdf"/.test(app) && !/accept="[^"]*epub/.test(app));
check("V0.11 paid actions require confirmation", /PaidConfirmation/.test(app) && (app.match(/onConfirm=\{\(\) => runPaid\(/g) ?? []).length === 3);
check("review builds never fall back to a live Supabase project", !/fallbackUrl|fallbackPublishableKey|nmbbahzzogspuuvpsxud/.test(supabaseClient));
check("V0.11 overlays use logical RTL/LTR positioning", /inset-inline-end/.test(v011ReviewCss) && /inset-block-end/.test(v011ReviewCss));
check("analysis reload selects provenance fields", /select\("kind,language,source,content,template_version,created_at"\)/.test(library));
check("speech request is claimed before PDF awaits", speakPage.indexOf("const myGeneration = speechGenerationRef.current") < speakPage.indexOf("await document.getPage(page)"));
check("saved progress waits for hydration", /!savedProgressReady/.test(reader));
check("paid Edge Function fails closed", /SPL_PAID_AI_ENABLED/.test(edge) && /PAID_AI_DISABLED/.test(edge));
check("migration is transactional", /^begin;/m.test(migration) && /^commit;/m.test(migration));
check("migration contains verification block", /V0\.7 verification failed/.test(migration));

console.log(`\n${failed === 0 ? "ALL RELEASE CHECKS PASSED" : `${failed} RELEASE CHECK(S) FAILED`}`);
if (failed) process.exit(1);
