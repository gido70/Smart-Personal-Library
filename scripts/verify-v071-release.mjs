import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("src/App.tsx");
const reader = read("src/Reader.tsx");
const library = read("src/lib/library.ts");
const edge = read("supabase/functions/spl-ai/index.ts");
const migration = read("supabase/migrations/20260826_0002_spl_v07_zero_cost.sql");
const speakPage = reader.slice(reader.indexOf("const speakPage"), reader.indexOf("const close"));

let failed = 0;
function check(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failed += 1;
}

check("saved-reader exit returns to pilot/library", /onExitSavedBook[\s\S]{0,180}setView\(activePilotBook \? "pilot" : "library"\)/.test(app));
check("upload UI accepts PDF only", /accept="application\/pdf,\.pdf"/.test(app) && !/accept="[^"]*epub/.test(app));
check("deduped consent failures are not swallowed", !/could not verify consent on a deduped book/.test(app));
check("analysis reload selects provenance fields", /select\("kind,language,source,content,template_version,created_at"\)/.test(library));
check("speech request is claimed before PDF awaits", speakPage.indexOf("const myGeneration = speechGenerationRef.current") < speakPage.indexOf("await document.getPage(page)"));
check("saved progress waits for hydration", /!savedProgressReady/.test(reader));
check("paid Edge Function fails closed", /SPL_PAID_AI_ENABLED/.test(edge) && /PAID_AI_DISABLED/.test(edge));
check("migration is transactional", /^begin;/m.test(migration) && /^commit;/m.test(migration));
check("migration contains verification block", /V0\.7 verification failed/.test(migration));

console.log(`\n${failed === 0 ? "ALL RELEASE CHECKS PASSED" : `${failed} RELEASE CHECK(S) FAILED`}`);
if (failed) process.exit(1);
