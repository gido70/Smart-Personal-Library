// V0.7 Zero-Cost Functional Pilot switch.
//
// When true (the state this build ships in), every code path that would call the
// `spl-ai` Supabase Edge Function — and therefore OpenAI — is disabled at the UI
// level: the buttons render as visibly locked ("قريبًا" / paid, not callable) and
// their onClick handlers are never wired to `invokeBookAI`. This is checked by
// scripts/verify-zero-cost.mjs (a plain static-source scan, no network) as part of
// the delivered test evidence — see TEST-RESULTS.md, test #12.
//
// Flip to false only once a real OPENAI_API_KEY is configured server-side in the
// spl-ai function AND you intend to actually spend API credit.
export const ZERO_COST_MODE = true;
