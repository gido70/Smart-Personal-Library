// Formative feedback from the shared user view. Validates the shared-view session with the existing
// spl_supervisor_access RPC (read-only use) and stores the answers. Does not touch paid functions.
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "https://gido70.github.io", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const SCALE = ["FB_READ", "FB_CARDS", "FB_AUDIO", "FB_RETURN"];
const TEXT = ["FB_BEST", "FB_SUGGEST"];
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 6000) return reply({ error: "INVALID_REQUEST" }, 400);
    const input = JSON.parse(raw);
    if (typeof input.token !== "string" || !/^[a-f0-9]{64}$/.test(input.token)) return reply({ error: "ACCESS_DENIED" }, 403);
    if (input.consent !== true) return reply({ error: "CONSENT_REQUIRED" }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const hashHex = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.token))), (x) => x.toString(16).padStart(2, "0")).join("");
    const { data: access, error: accessError } = await db.rpc("spl_supervisor_access", { p_action: "session", p_hash: hashHex });
    if (accessError) throw accessError;
    if (!access?.ok) return reply({ error: "ACCESS_DENIED" }, 403);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await db.from("spl_design_feedback").select("id", { count: "exact", head: true }).eq("session_hash", hashHex).gte("created_at", since);
    if ((count ?? 0) >= 5) return reply({ error: "TOO_MANY" }, 429);
    const a = input.answers ?? {};
    const answers: Record<string, unknown> = {};
    for (const k of SCALE) { const v = a[k]; if (v === "na" || (Number.isInteger(v) && v >= 1 && v <= 5)) answers[k] = v; }
    for (const k of TEXT) { if (typeof a[k] === "string" && a[k].trim()) answers[k] = a[k].trim().slice(0, 1500); }
    if (Object.keys(answers).length === 0) return reply({ error: "EMPTY" }, 400);
    const device = typeof input.device === "string" ? input.device.slice(0, 40) : null;
    const bookId = typeof input.bookId === "string" && /^[0-9a-f-]{36}$/.test(input.bookId) ? input.bookId : null;
    const { error } = await db.from("spl_design_feedback").insert({ source: "shared", book_id: bookId, session_hash: hashHex, consent: true, answers, device, form_version: "1.0" });
    if (error) throw error;
    return reply({ ok: true });
  } catch { return reply({ error: "UNAVAILABLE" }, 503); }
});
