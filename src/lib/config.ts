// V0.9 private, explicitly-confirmed paid pilot.
// `false` exposes the paid controls in the browser, but is not a financial
// security boundary. The Supabase Edge Function still fails closed unless the
// server secret SPL_PAID_AI_ENABLED=true and the signed-in email exactly matches
// SPL_PILOT_EMAIL. There is no cumulative analysed-book gate; every paid action
// still requires confirmation and the server keeps its daily spending limits.
export const ZERO_COST_MODE = false;
export const PAID_PILOT_MAX_BOOKS = 5;
