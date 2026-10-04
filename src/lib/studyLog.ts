// Usage logging for study participants only (spl_study_events, RLS: own rows, insert only).
// A no-op for the owner and the shared user view. Payloads never contain text the participant typed.
import { participantMode, supabase } from "./supabase";

export type StudyEvent = "session_start" | "session_end" | "view_summary" | "view_map" | "view_chapters" | "view_questions" | "question_answer" | "audio_play" | "audio_progress" | "open_original" | "jump_to_page";

let pid: string | null | undefined;
let pending: Promise<string | null> | null = null;
const sessionId = (() => { try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random()}`; } })();
const recent = new Map<string, number>();

async function participantId(): Promise<string | null> {
  if (pid !== undefined) return pid;
  if (!pending) pending = (async () => { const { data } = await supabase!.rpc("spl_study_my_participant"); pid = (data as string | null) ?? null; return pid; })().catch(() => { pending = null; return null; });
  return pending;
}

export function logStudy(type: StudyEvent, payload: Record<string, unknown> = {}, bookId?: string | null) {
  if (!participantMode || !supabase) return;
  const key = `${type}:${JSON.stringify(payload)}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - 2000) return; // drop accidental double events
  recent.set(key, now);
  void (async () => {
    try {
      const p = await participantId();
      if (!p) return;
      await supabase!.from("spl_study_events").insert({ participant_id: p, book_id: bookId ?? null, session_id: sessionId, event_type: type, payload });
    } catch { /* logging must never break reading */ }
  })();
}

let started = false;
export function startStudySession() {
  if (!participantMode || started) return;
  started = true;
  logStudy("session_start", { w: typeof window !== "undefined" ? window.innerWidth : null });
  try {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") logStudy("session_end", {}); });
  } catch { /* optional */ }
}

export const firstPage = (value: unknown): number | null => {
  const m = String(value ?? "").match(/\d+/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
