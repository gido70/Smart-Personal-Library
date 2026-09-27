# Visual polish and in-app back trail

Scoped presentation CSS: emerald/cream with restrained gold, teal and muted
accent colours; card depth and shadows without additional image requests;
clearer touch feedback, safe-area mobile navigation, dark theme, keyboard focus
and reduced-motion support. No new fonts, image libraries or animation engines.

Quick actions are directly below the header. In-app Back restores visited views,
book context and vertical window scroll, for up to 40 entries in this session.
Changing account or signing out clears this trail. Existing browser history is
not intercepted. Child-local unsaved form state and horizontal shelf scroll are
not persisted by this feature; reader progress retains its existing mechanism.

Book-cover loading, PDFs, storage, payments, audio and offline cache are unchanged.
Tests cover sequential navigation, scroll and account isolation. Build and CI
regression gates are required before publishing. This is not a real-device or
authenticated visual certification.
