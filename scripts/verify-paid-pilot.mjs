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
check("browser communicates six active-book slots", PAID_PILOT_MAX_BOOKS === 6);
check("server fails closed without explicit paid enablement", /SPL_PAID_AI_ENABLED/.test(edge) && /PAID_AI_DISABLED/.test(edge));
check("server restricts spending to the approved pilot email", /SPL_PILOT_EMAIL/.test(edge) && /PRIVATE_PILOT_EMAIL_REQUIRED/.test(edge));
check("new books are not blocked by the retired one-book pilot gate", !/PILOT_BOOK_LIMIT/.test(edge) && !/PAID_PILOT_BOOK_LIMIT_REACHED/.test(edge));
check("question spending has daily and total limits", /DAILY_QUESTION_LIMIT_REACHED/.test(edge) && /PILOT_QUESTION_LIMIT_REACHED/.test(edge));
check("analysis and question output are capped server-side", /max_output_tokens: 12_000/.test(edge) && /max_output_tokens: 2_500/.test(edge));
check("PDF token cost uses low detail", /type: "input_file"[\s\S]{0,100}detail: "low"/.test(edge));
check("professional audio is reused instead of charged twice", /completedParts\.size >= totalParts/.test(edge) && /reused: true/.test(edge) && /if \(completedParts\.has\(partNo\)\) continue/.test(edge));
check("professional audio reuse is isolated by voice", /eq\("voice", voice\)/.test(edge));
check("only approved professional voices are accepted", /PROFESSIONAL_VOICES = \["marin", "cedar", "coral", "onyx", "nova", "sage"\]/.test(edge) && /professionalVoice\(body\.voice\)/.test(edge));
check("speech uses a pinned improved model and one-narrator instructions", /gpt-4o-mini-tts-2025-12-15/.test(edge) && /صوت راوٍ واحد ثابت/.test(edge) && /ممنوع تبديل الشخصية/.test(edge));
check("new paid audio requires listening to the selected sample through the end", /voice-quality-gate/.test(app) && /heardPreviewVoice !== professionalVoice/.test(app) && /onEnded=\{\(\) => setHeardPreviewVoice\(voice\)\}/.test(app));
check("voice samples are short, cached, and never generated automatically", /action === "audio_preview"/.test(edge) && /voice-previews/.test(edge) && /onClick=\{\(\) => previewVoice\(voice\)\}/.test(app));
check("preview and full audio reject a mismatched returned voice", /VOICE_PREVIEW_MISMATCH/.test(app) && /FULL_AUDIO_VOICE_MISMATCH/.test(app));
check("audio players stop other samples before playback", /keepOnlyThisAudioPlaying/.test(app) && /onPlay=\{\(event\) => keepOnlyThisAudioPlaying/.test(app));
check("speech chunks stay below the API input limit and split overlong sentences", /TTS_CHUNK_MAX_CHARACTERS = 3900/.test(edge) && /splitTextForSpeech/.test(edge) && /lastIndexOf\(" ", room\)/.test(edge));
check("voice preview cache version is invalidated after consistency changes", /voice-previews\/v3-\$\{language\}-\$\{voice\}\.mp3/.test(edge));
check("every paid browser action has an explicit confirmation state", /confirming !== "process"/.test(app) && /confirming !== "ask"/.test(app) && /confirming !== "audio"/.test(app));
check("paid actions send stable request identifiers", /requestId/.test(app) && /idempotency_key/.test(edge));
check("no OpenAI secret is embedded in tracked source", !/sk-[A-Za-z0-9_-]{20,}/.test(`${app}\n${edge}`));
check("client has no live Supabase fallback", !/supabase\.co|eyJhbGci/i.test(supabaseClient));
check("deployment fails closed without Supabase secrets", /Require explicit Supabase configuration/.test(deploy) && /VITE_SUPABASE_URL is missing/.test(deploy) && /VITE_SUPABASE_PUBLISHABLE_KEY is missing/.test(deploy));
check("usage migration is additive and protected by RLS", /^begin;/m.test(migration) && /^commit;/m.test(migration) && /enable row level security/.test(migration));
check("per-book text cost uses logged tokens and documented Terra rates", /"gpt-5\.6-terra"/.test(cost) && /input: 2, output: 12/.test(cost) && /272_000/.test(cost));
check("audio is not mislabeled as an exact billed cost", /Audio is deliberately excluded/.test(cost) && /audioCharacters/.test(cost));

console.log(`\n${failed === 0 ? "ALL PAID PILOT CHECKS PASSED" : `${failed} PAID PILOT CHECK(S) FAILED`}`);
if (failed) process.exit(1);
