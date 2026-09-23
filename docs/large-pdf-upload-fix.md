# Large PDF upload preparation repair — 2026-09-23

Branch: `fix/large-pdf-upload-hang-v2`. Base: `43e986a`.

## Scope

- `src/lib/uploadPreparation.ts`: read once, hash before worker transfer, bounded
  PDF metadata inspection (25 seconds), cleanup on success/error/timeout. Only a
  metadata timeout falls back to absent page metadata; parser errors still fail.
- `src/lib/library.ts`: integrate preparation, stage callbacks, bounded session
  checks; restoration errors cannot fall through into duplicate-book creation.
- `src/App.tsx`: stage label through state/call/props; no false byte percentage
  or success tick on errors.
- `scripts/test-upload-preparation.mjs`, `package.json`: functional regression test.

150 MiB limit, no page-count limit, six active books, archive/paid artifacts,
storage ownership and RLS unchanged. No new dependency, paid API, or schema change.
The prior database size correction is already applied and tracked in PR #38.

## Verification

Build and existing npm test suite passed. New functional checks exercise a
transferred/detached buffer, single read, SHA-256, stage order, 700-page metadata,
parser errors, cleanup and forced parse/metadata timeouts. A real 101,000,336-byte
synthetic PDF passed pdf.js parsing, hashing and cleanup in Node.

These results do not establish the cause of the user's iPhone hang or prove a
live authenticated upload. Deployment/preview is tracked in the pull request.
Next: verify preview and publish, then test the actual PDF on the user's device;
the visible stage will identify any remaining transport/auth/storage issue.
