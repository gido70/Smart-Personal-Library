# Claude Independent Review — Smart Personal Library V0.11

Review repository `gido70/Smart-Personal-Library`, branch `docs/wajeez-reference-and-v011-prep`, against `main`.

## Role
Act as an independent senior reviewer. Do not redesign the product and do not make changes. Identify defects, regressions, security/privacy risks, misleading UI states, cost risks, mobile/PWA problems, and scaling weaknesses.

## Required checks
1. Compare the branch to `main` and confirm no unrelated regression.
2. Review `src/AppV11.tsx`, `src/v011.css`, `src/main.tsx` for responsive Arabic RTL and English LTR behavior.
3. Review reuse of the existing saved-book reader and Supabase reading progress. Verify “continue where you stopped” is based on stored data, not cosmetic state.
4. Review `src/lib/reminders.ts`, `public/sw.js`, `supabase/migrations/20260827_0004_spl_v011_book_journey.sql`, and `supabase/functions/spl-reminders/index.ts` for Web Push correctness, RLS, subscription privacy, stale endpoint handling, replay/authorization risk, and iOS Home Screen constraints.
5. Review the existing `supabase/functions/spl-ai/index.ts` financial boundaries. Confirm paid AI is fail-closed, existing analysis/audio is reused, pilot limits remain enforced, and no OpenAI key is exposed to the browser.
6. Review Arabic TTS handling. Treat voice quality as BLOCKED until a real-device pronunciation acceptance test is performed; code generation success alone is not acceptance.
7. Check the new dependency versions and any security advisories.
8. Check that `VERSION`, `package.json`, and `PROJECT-STATUS.md` now agree.
9. Check the Wajeez reference documents are used for UX inspiration only and do not copy protected branding/content/assets.
10. Check scalability for dozens/hundreds of books: search/filter navigation, unnecessary per-book queries, large bundle impact, and state consistency.

## Constraints
- Do not execute SQL.
- Do not enable paid OpenAI.
- Do not merge to `main`.
- Do not request or expose secrets.
- Do not assume Push is active until migration, VAPID keys, dispatcher deployment/scheduling, and real-device tests are complete.

## Output format
Return only:
- `BLOCKER` findings
- `MAJOR` findings
- `MINOR` findings
- `PASS` checks
- `GO / NO-GO` for a non-production preview
- `GO / NO-GO` for applying the V0.11 Supabase migration
- exact files/lines or symbols for every finding

Be adversarial: try to prove the build is not ready rather than confirming it.
