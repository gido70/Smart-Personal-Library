import { readFileSync } from "node:fs";
import { ZERO_COST_MODE, PAID_PILOT_MAX_BOOKS } from "../src/lib/config.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("src/App.tsx");
const edge = read("supabase/functions/spl-ai/index.ts");
const migration = read("supabase/migrations/20260826_0003_spl_v09_paid_pilot.sql");
const cost = read("src/lib/openAiCost.ts");
const supabaseClient = read("src/lib/supabase.ts");
const deploy = read(".github/workflows/deploy-pages.yml");
let failed = 0;
function check(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failed += 1;
}

check("paid controls are enabled in V0.9", ZERO_COST_MODE === false);
check("browser communicates an absolute maximum of five books", PAID_PILOT_MAX_BOOKS === 5);
check("server fails closed without explicit paid enablement", /SPL_PAID_AI_ENABLED/.test(edge) && /PAID_AI_DISABLED/.test(edge));
check("server restricts spending to the approved pilot email", /SPL_PILOT_EMAIL/.test(edge) && /PRIVATE_PILOT_EMAIL_REQUIRED/.test(edge));
check("initial server default is one analysed book and never over five", /SPL_PILOT_MAX_BOOKS/.test(edge) && /Math\.min\(5/.test(edge) && /\?\? "1"/.test(edge));
check("question spending has daily and total limits", /DAILY_QUESTION_LIMIT_REACHED/.test(edge) && /PILOT_QUESTION_LIMIT_REACHED/.test(edge));
check("analysis and question output are capped server-side", /max_output_tokens: 12_000/.test(edge) && /max_output_tokens: 2_500/.test(edge));
check("PDF token cost uses low detail", /type: "input_file"[\s\S]{0,100}detail: "low"/.test(edge));
check("professional audio is reused instead of charged twice", /existingAudio\?\.length/.test(edge) && /reused: true/.test(edge));
check("only approved professional voices are accepted", /body\.voice === "cedar" \? "cedar" : "marin"/.test(edge));
check("every paid browser action has an explicit confirmation state", /confirming !== "process"/.test(app) && /confirming !== "ask"/.test(app) && /confirming !== "audio"/.test(app));
check("no OpenAI secret is embedded in tracked source", !/sk-[A-Za-z0-9_-]{20,}/.test(`${app}\n${edge}`));
check("client has no live Supabase fallback", !/supabase\.co|eyJhbGci/i.test(supabaseClient));
check("deployment fails closed without Supabase secrets", /Require explicit Supabase configuration/.test(deploy) && /VITE_SUPABASE_URL is missing/.test(deploy) && /VITE_SUPABASE_PUBLISHABLE_KEY is missing/.test(deploy));
check("usage migration is additive and protected by RLS", /^begin;/m.test(migration) && /^commit;/m.test(migration) && /enable row level security/.test(migration));
check("per-book text cost uses logged tokens and documented Terra rates", /"gpt-5\.6-terra"/.test(cost) && /input: 2, output: 12/.test(cost) && /272_000/.test(cost));
check("audio is not mislabeled as an exact billed cost", /Audio is deliberately excluded/.test(cost) && /audioCharacters/.test(cost));

console.log(`\n${failed === 0 ? "ALL PAID PILOT CHECKS PASSED" : `${failed} PAID PILOT CHECK(S) FAILED`}`);
if (failed) process.exit(1);
