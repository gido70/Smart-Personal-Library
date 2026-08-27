# V0.11 Self Review Checkpoints

1. Existing `main` untouched.
2. Legacy V0.10.2 UI remains reachable in preview with `?legacy=1`.
3. New V0.11 UI uses existing Supabase book, analysis, audio, question, and reading-progress data.
4. Paid AI remains explicit and guarded; no automatic paid call was added.
5. Existing saved analysis/audio are reused by the data layer and UI.
6. Reminder schema is additive and RLS-scoped to the authenticated user.
7. Push endpoint subscriptions are stored per user/device.
8. Service Worker never caches Supabase/API responses because it only intercepts same-origin requests.
9. Background push is clearly blocked until VAPID/dispatcher setup is complete.
10. Arabic TTS remains unaccepted until device-level pronunciation testing.
