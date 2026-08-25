import { createClient } from "@supabase/supabase-js";

const fallbackUrl = "https://nmbbahzzogspuuvpsxud.supabase.co";
const fallbackPublishableKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tYmJhaHp6b2dzcHV1dnBzeHVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MTY1MTYsImV4cCI6MjA5MzA5MjUxNn0.6yZNxZ_2ONQ-wyQSJtdvYpdJAxZfB-7C00ezEepUiqY";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || fallbackUrl;
const key =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  fallbackPublishableKey;

export const supabaseConfigured = Boolean(url && key);

export const supabase = supabaseConfigured
  ? createClient(url, key, {
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
