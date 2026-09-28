# Project and index stay together

For every platform change (features, fixes, UI, storage, configuration, tests or deployment):

1. Update `docs/concept-index-v1.1.html` in the same branch/PR. This is the only source for the guide's `concept-index.html`; do not maintain a second edited copy.
2. Explain the change in its relevant section and in the dated change register. Record what was actually tested and what remains unverified. Preserve legal text unless a legal revision is explicitly requested.
3. Keep Arabic RTL and the corresponding English content aligned. Personal experience is narrated in the author's first person, with no invented work durations or third-party attribution.
4. Run the index synchronization gate, relevant tests and production build. Never merge with a failing gate. Documentation presence is not proof of documentation accuracy; review the wording.
5. Verify the deployment result. The index and application are built and deployed as one Pages artifact; the index build stamp identifies that source commit.
6. Do not claim an Edge Function or database migration is live merely because code merged. Record those deployments and their verification separately in the index.

Preserve existing covers, offline audio, paid outputs, archive and downloads. Changes to this process require an accompanying index update too.
