import { readFileSync } from "node:fs";
import { ZERO_COST_MODE, PAID_PILOT_MAX_BOOKS } from "../src/lib/config.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("src/AppV11.tsx");
const main = read("src/main.tsx");
const edge = read("supabase/functions/spl-ai/index.ts");
const migration = read("supabase/migrations/20260826_0003_spl_v09_paid_pilot.sql");
const v011Migration = read("supabase/migrations/20260827_0004_spl_v011_book_journey.sql");
const reminderEdge = read("supabase/functions/spl-reminders/index.ts");
const cost = read("src/lib/openAiCost.ts");
let failed = 0;
function check(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failed += 1;
}

check("private paid controls are available in V0.11", ZERO_COST_MODE === false);
check("V0.11 is the default user interface", /legacy \? <App \/> : <AppV11 \/>/.test(main));
check("browser communicates an absolute maximum of five books", PAID_PILOT_MAX_BOOKS === 5);
check("server fails closed without explicit paid enablement", /SPL_PAID_AI_ENABLED/.test(edge) && /PAID_AI_DISABLED/.test(edge));
check("server restricts spending to the approved pilot email", /SPL_PILOT_EMAIL/.test(edge) && /PRIVATE_PILOT_EMAIL_REQUIRED/.test(edge));
check("initial server default is one analysed book and never over five", /SPL_PILOT_MAX_BOOKS/.test(edge) && /Math\.min\(5/.test(edge) && /\?\? "1"/.test(edge));
check("question spending has daily and total limits", /DAILY_QUESTION_LIMIT_REACHED/.test(edge) && /PILOT_QUESTION_LIMIT_REACHED/.test(edge));
check("PDF token cost uses low detail", /type: "input_file"[\s\S]{0,100}detail: "low"/.test(edge));
check("professional audio is reused instead of charged twice", /existingAudio\?\.length/.test(edge) && /reused: true/.test(edge));
check("only approved professional voices are accepted", /body\.voice === "cedar" \? "cedar" : "marin"/.test(edge));
check("every V0.11 paid action has an explicit confirmation state", /confirming === "process"/.test(app) && /confirming === "ask"/.test(app) && /confirming === "audio"/.test(app) && /PaidConfirmation/.test(app));
check("V0.11 only invokes paid AI from confirmed callbacks", (app.match(/onConfirm=\{\(\) => runPaid\(/g) ?? []).length === 3 && (app.match(/invokeBookAI\(/g) ?? []).length === 3);
check("no OpenAI secret is embedded in tracked source", !/sk-[A-Za-z0-9_-]{20,}/.test(`${app}\n${edge}`));
check("usage migration is additive and protected by RLS", /^begin;/m.test(migration) && /^commit;/m.test(migration) && /enable row level security/.test(migration));
check("V0.11 reminders are claimed atomically", /for update skip locked/.test(v011Migration) && /spl_claim_due_book_reminders/.test(reminderEdge));
check("V0.11 migration verifies itself before commit", /V0\.11 verification failed/.test(v011Migration) && /to_regprocedure/.test(v011Migration));
check("per-book text cost uses logged tokens and documented Terra rates", /"gpt-5\.6-terra"/.test(cost) && /input: 2, output: 12/.test(cost) && /272_000/.test(cost));
check("audio is not mislabeled as an exact billed cost", /Audio is deliberately excluded/.test(cost) && /audioCharacters/.test(cost));

console.log(`\n${failed === 0 ? "ALL PAID PILOT CHECKS PASSED" : `${failed} PAID PILOT CHECK(S) FAILED`}`);
if (failed) process.exit(1);
