// V0.9 private, explicitly-confirmed paid pilot.
// `false` exposes the paid controls in the browser, but is not a financial
// security boundary. The Supabase Edge Function still fails closed unless the
// server secret SPL_PAID_AI_ENABLED=true and the signed-in email exactly matches
// SPL_PILOT_EMAIL. The initial server default permits one analysed book; it can
// later be raised, but never above PAID_PILOT_MAX_BOOKS.
export const ZERO_COST_MODE = false;
export const PAID_PILOT_MAX_BOOKS = 5;
