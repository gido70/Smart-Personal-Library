# Offline listening preview — 2026-09-26

Base: badbabd (PR44). Branch: feat/offline-audio-library. No production merge permitted before real device acceptance.

## Scope
Separate audio-only IndexedDB store; one atomic complete snapshot per owner/book/language/voice. Existing export/download handlers, PDF originals, archive compaction and paid generation are unchanged. Archive keeps paid summaries/audio indefinitely under existing account storage, while PDF originals free an active slot; identical-file restoration uses the existing hash path.

Saved data: title, author, small JPEG cover, ordered parts, file revision, Blob audio, saved time, trip ordering/current book and playback position. Account isolation is enforced in store operations; explicit sign-out removes the last-account offline entry. Local access after closing the app is intended for the last signed-in account on the same device, not a new authentication method. Copies are not encrypted against other people with access to this browser profile.

Preparation checks server file ID/lastModified/size/etag and checks again before committing; unchanged completed copies are reused. A failed transfer or quota error preserves the previous complete copy. Local deletion has no cloud delete path. Recording replacement is surfaced as an update notice.

App shell uses generated versioned precache with all JS/CSS needed on cold start. Refresh does not unregister the worker or wipe caches. Private Supabase responses are never cached by the service worker. MP3 blobs remain in separate IndexedDB. The audio player uses local Blob URLs when available, otherwise a fresh signed URL per part; one player moves across parts and trip books. Media Session handlers are best effort, not hardware certification.

## Cloud sync boundary
Client outbox and sync adapter implemented. Proposed additive SQL is docs/offline-listening-schema-proposal.sql; NOT applied. No existing table or RLS policy altered. Dedicated owner-scoped table and security-invoker RPC apply newer timestamps only. Until approved and deployed, UI reports local position saved / cloud sync pending. Multi-device end-to-end sync is NOT verified. Client device-clock skew can prevent sync; retained dirty entries are not discarded.

## Verification
TypeScript/build and regression suite; IndexedDB-compatible tests for owner isolation, all-or-nothing replacement, no duplicate fetching, changed-file detection, trip/position persistence, local-only deletion and part/book sequencing. Browser automation failed at daemon startup twice in this environment. No real phone, no airplane-mode cold launch, no locked-screen playback certification. No paid API calls.

## Required device acceptance (iPhone + Samsung separately)
Record OS/browser/version, preview URL and build. Prepare two real books online; confirm all parts and covers. Reorder trip; airplane mode; fully close/reopen; play all parts and cross-book transition; lock screen and switch apps. Reconnect and confirm cloud position only after sync migration approval. Delete local copy and confirm cloud originals/outputs survive. Test quota/failed preparation/update prompt. Verify old download controls unchanged. Test cover speed and author index separately. Do not infer device success from mocks.

## Open findings carried forward
Production author differs from retained printed-catalogue evidence: stored أحمد بن سالم بامهام vs باهمام، أحمد سالم عمر. Classification 610 saved. Small cover exists; Samsung/iPhone speed unverified. Notifications and PDF first pages need hardware/user-flow checks. Version file still 0.10.5-candidate, not a verified V0.11 label.
