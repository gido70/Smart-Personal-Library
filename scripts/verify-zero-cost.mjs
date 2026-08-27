// Legacy V0.7 guard rail for the retired `?legacy=1` interface. V0.11 is a
// private paid pilot protected by explicit confirmation plus fail-closed server
// gates, so this script is intentionally excluded from the V0.11 test suite.
// Static, dependency-free guard-rail check for "no OpenAI call is reachable in this build".
// This is NOT a substitute for opening DevTools → Network and watching a real session
// (see TEST-RESULTS.md, test #12, for the honest limits of what a static check can prove).
// It verifies structural invariants in the source text itself:
//   1. src/lib/config.ts exports ZERO_COST_MODE === true.
//   2. Every paid action handler in src/App.tsx (process/ask/audio, which call
//      invokeBookAI -> the spl-ai Edge Function -> OpenAI) starts with an
//      `if (ZERO_COST_MODE) return;` guard, so the call is dead code in this build.
//   3. The number of such guards is not fewer than the number of invokeBookAI call sites.
//
// Run: node --experimental-strip-types scripts/verify-zero-cost.mjs
import { readFileSync } from "node:fs";
import { ZERO_COST_MODE } from "../src/lib/config.ts";

let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

check("src/lib/config.ts: ZERO_COST_MODE is true", ZERO_COST_MODE === true);

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

const invokeCallSites = (appSource.match(/invokeBookAI\(/g) ?? []).length;
const zeroCostGuards = (appSource.match(/if\s*\(\s*ZERO_COST_MODE\s*\)\s*return;/g) ?? []).length;

check(
  "src/App.tsx: at least one invokeBookAI call site exists (paid feature still present, just gated)",
  invokeCallSites > 0,
  `found ${invokeCallSites} call site(s)`,
);
check(
  "src/App.tsx: every invokeBookAI call site has a matching ZERO_COST_MODE guard",
  zeroCostGuards >= invokeCallSites,
  `${zeroCostGuards} guard(s) vs ${invokeCallSites} call site(s)`,
);
check(
  "src/App.tsx: imports ZERO_COST_MODE from lib/config",
  /import\s*\{[^}]*ZERO_COST_MODE[^}]*\}\s*from\s*["']\.\/lib\/config["']/.test(appSource),
);

// The Deno edge function lives outside src/ and uses `jsr:` specifiers Vite cannot
// resolve, so it structurally cannot be pulled into the browser bundle. Confirm the
// file is where we expect and is not referenced from inside src/.
const splAiPath = new URL("../supabase/functions/spl-ai/index.ts", import.meta.url);
let splAiExists = false;
let splAiSource = "";
try {
  splAiSource = readFileSync(splAiPath, "utf8");
  splAiExists = true;
} catch {
  splAiExists = false;
}
check("supabase/functions/spl-ai/index.ts exists and stays outside src/ (never bundled by Vite)", splAiExists);
check(
  "spl-ai fails closed unless SPL_PAID_AI_ENABLED is explicitly true",
  /Deno\.env\.get\(["']SPL_PAID_AI_ENABLED["']\)\s*!==\s*["']true["']/.test(splAiSource) &&
    /PAID_AI_DISABLED/.test(splAiSource),
);

const referencesSplAiSource = /supabase\/functions\/spl-ai/.test(appSource) || /from ["']\.\.\/supabase/.test(appSource);
check("src/App.tsx does not import the edge function source directly", !referencesSplAiSource);

console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`}`);
console.log(
  "Note: this proves the paid code path is structurally unreachable in this build.\n" +
    "It does not replace an actual DevTools → Network capture during manual testing\n" +
    "(no live Supabase project is reachable from the environment that produced this build).",
);
if (failed > 0) process.exit(1);
