import { createClient } from "@supabase/supabase-js";

const fallbackUrl = "https://nmbbahzzogspuuvpsxud.supabase.co";
const fallbackPublishableKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tYmJhaHp6b2dzcHV1dnBzeHVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MTY1MTYsImV4cCI6MjA5MzA5MjUxNn0.6yZNxZ_2ONQ-wyQSJtdvYpdJAxZfB-7C00ezEepUiqY";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || fallbackUrl;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || fallbackPublishableKey;

export const supabaseConfigured = Boolean(url && key);

export const supabase = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export async function ensurePilotSession() {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  const { data: created, error } = await supabase.auth.signInAnonymously();
  if (error || !created.session) throw error ?? new Error("SESSION_NOT_CREATED");
  return created.session;
}

// ---------------------------------------------------------------------------
// Permanent-account upgrade (CLAUDE-REVIEW-PROMPT.md §و): anonymous Auth is
// browser/device-bound, so the library is lost if the user clears site data
// or opens the app on another device/browser. Supabase's own
// anonymous-to-permanent upgrade (auth.updateUser({ email })) is used
// instead of creating a second, separate account: it keeps the SAME
// auth.uid() for the already-signed-in anonymous user, so every existing
// spl_books/spl_analyses/... row (all scoped to that uid by RLS) becomes
// reachable from the permanent account with no data migration and no
// ownership transfer at all. The user must click the confirmation link
// Supabase emails to the new address before the upgrade takes effect —
// until then this session is still anonymous.
//
// This requires "Confirm email" to be enabled and SMTP configured on the
// Supabase project; this sandbox has no way to receive that email and
// confirm the flow end-to-end, so real delivery is BLOCKED/UNTESTED here —
// see KNOWN-LIMITATIONS.md. The code path itself (calling updateUser and
// surfacing its result/error) is exercised by a unit-style check only.
export async function isCurrentSessionAnonymous(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getUser();
  return Boolean((data.user as { is_anonymous?: boolean } | null)?.is_anonymous);
}

export async function upgradeAnonymousSessionToEmail(email: string) {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw new Error("INVALID_EMAIL");
  const { data, error } = await supabase.auth.updateUser(
    { email: trimmed },
    { emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
  );
  if (error) throw error;
  return data;
}

/** Sign in to an already-created permanent library account from another device. */
export async function sendExistingAccountMagicLink(email: string) {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw new Error("INVALID_EMAIL");
  const { data, error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
    },
  });
  if (error) throw error;
  return data;
}

export async function signOutLibraryAccount() {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
