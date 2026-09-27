# Device viewport preview

An independent `device-preview.html` page embeds the existing app at phone
(390×844), tablet (820×1180), or desktop (1440×900) viewport sizes. Rotation and
fit/100% controls resize the same iframe without navigating or reloading it.
The link opens a separate tab to preserve the original app's current work.
Nested preview links are hidden. Arabic RTL and English labels are supported.

No cover, audio, offline cache, database, payment, archive or reader logic changes.
Actions in the embedded library are real; the page explicitly says so. This is
a layout preview, not Safari/Samsung emulation or a substitute for device tests.
