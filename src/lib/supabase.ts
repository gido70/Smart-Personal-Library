import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();

export const supabaseConfigured = Boolean(url && key);

export const supabase = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export async function ensurePilotSession() {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data } = await supabase.auth.getSession();
  if (!data.session || (data.session.user as { is_anonymous?: boolean }).is_anonymous) {
    throw new Error("AUTH_REQUIRED");
  }
  return data.session;
}

export async function signInLibraryAccount(email: string, password: string) {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw new Error("INVALID_EMAIL");
  if (password.length < 6) throw new Error("PASSWORD_TOO_SHORT");
  const { data, error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
  if (error || !data.session) throw error ?? new Error("LOGIN_FAILED");
  return data.session;
}

export async function signUpLibraryAccount(email: string, password: string) {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw new Error("INVALID_EMAIL");
  if (password.length < 8) throw new Error("PASSWORD_TOO_SHORT");
  const { data, error } = await supabase.auth.signUp({
    email: trimmed,
    password,
    options: { emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
  });
  if (error) throw error;
  return data;
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
