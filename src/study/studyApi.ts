import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Answers, Instrument, Participant } from "./types";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();

// A separate storage key keeps the participant's anonymous session apart from
// the owner's library session on the same origin, so testing the study page in
// the owner's browser can never bind the owner account to a participant.
let client: SupabaseClient | null = null;
export function studyClient(): SupabaseClient {
  if (!url || !key) throw new Error("SUPABASE_NOT_CONFIGURED");
  client ??= createClient(url, key, {
    auth: { storageKey: "spl-study-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

type RpcResult = { ok: boolean; error?: string; code?: string; status?: string };

async function rpc(name: string, params: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await studyClient().rpc(name, params);
  if (error) throw new Error(error.message || "RPC_FAILED");
  return (data ?? { ok: false, error: "EMPTY" }) as RpcResult;
}

// Memoised so concurrent callers (e.g. React StrictMode in development) never
// create two anonymous users for one visit.
let sessionPromise: Promise<void> | null = null;
export function ensureAnonymousSession(): Promise<void> {
  sessionPromise ??= (async () => {
    const supabase = studyClient();
    const { data } = await supabase.auth.getSession();
    if (data.session) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error((error as { code?: string }).code || error.message);
  })().catch(error => { sessionPromise = null; throw error; });
  return sessionPromise;
}

export async function loadParticipant(): Promise<Participant | null> {
  const { data, error } = await studyClient()
    .from("spl_study_participants")
    .select("code,status,is_test,consented_at,use_started_at,post_due_at,followup_due_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Participant | null) ?? null;
}

export async function loadInstruments(): Promise<Record<string, Instrument>> {
  const { data, error } = await studyClient().from("spl_study_instruments").select("key,version,definition").eq("active", true);
  if (error) throw new Error(error.message);
  const out: Record<string, Instrument> = {};
  for (const row of (data ?? []) as { key: string; version: string; definition: Instrument }[]) {
    out[row.key] = { ...row.definition, key: row.key as Instrument["key"], version: row.version };
  }
  return out;
}

export const joinStudy = (invite: string) => rpc("spl_study_join", { p_invite: invite });
export const giveConsent = (version: string, interview: boolean) => rpc("spl_study_consent", { p_version: version, p_interview: interview });
export const submitInstrument = (key: string, answers: Answers, startedAt: string | null) =>
  rpc("spl_study_submit", { p_key: key, p_answers: answers, p_started_at: startedAt });
export const withdrawFromStudy = () => rpc("spl_study_withdraw", {});
