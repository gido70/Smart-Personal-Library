// AI scoring with human review (protocol v1.0). Researcher-only. Reference = the participant's book file;
// the platform summary is passed only to decide error code P. Writes suggestions to spl_study_ai_scores.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const PROTOCOL = "1.0";
const ITEMS: Record<string, string[]> = { post: ["UND_IDEA1", "UND_IDEA2", "UND_IDEA3", "UND_THESIS", "UND_APPLY"], followup: ["FU_IDEA1", "FU_IDEA2"] };
const RUBRIC = `You score open comprehension answers of an Arabic reading study. Reference: ONLY the attached book file. Protocol v${PROTOCOL}.
Ideas (UND_IDEA*, FU_IDEA*): 2 = correct and central idea of the book; 1 = correct but secondary, or so generic it fits any book on the topic; 0 = not in the book, empty, or a repeat of an earlier idea.
Thesis (UND_THESIS): 2 = captures the main argument accurately; 1 = close, or names the topic without the argument; 0 = wrong or unrelated.
Application (UND_APPLY): 2 = specific situation linked to an actual idea of the book; 1 = generic situation or weak link; 0 = unrelated or based on an idea not in the book.
error_code: "E" if the answer contradicts the book; "P" if it contradicts the book AND matches the PLATFORM SUMMARY below (error carried from the platform); otherwise null.
Do not reward eloquence or length; ignore spelling; judge meaning. If you cannot verify against the book, set confidence "low" and do not guess.
For each item give rationale (max 2 sentences, Arabic), evidence_page (physical PDF page or null) and evidence_quote (max 25 words copied from the book, or null), confidence high|medium|low.`;
const schema = { type: "json_schema", name: "study_scores", strict: true, schema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["item_code", "score", "error_code", "rationale", "evidence_page", "evidence_quote", "confidence"], properties: { item_code: { type: "string" }, score: { type: "integer", enum: [0, 1, 2] }, error_code: { type: ["string", "null"], enum: ["E", "P", null] }, rationale: { type: "string" }, evidence_page: { type: ["string", "null"] }, evidence_quote: { type: ["string", "null"] }, confidence: { type: "string", enum: ["high", "medium", "low"] } } } } } } };
async function openAI(path: string, init: RequestInit) {
  const key = Deno.env.get("OPENAI_API_KEY"); if (!key) throw new Error("OPENAI_API_KEY_MISSING");
  const r = await fetch(`https://api.openai.com/v1/${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`OPENAI_${r.status}:${(await r.text()).slice(0, 300)}`);
  return r;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await asUser.auth.getUser(); if (!u.user) return json({ error: "UNAUTHENTICATED" }, 401);
    const { data: isR } = await asUser.rpc("spl_study_is_researcher"); if (!isR) return json({ error: "NOT_RESEARCHER" }, 403);
    const { participantId, instrument } = await req.json();
    if (!ITEMS[instrument] || typeof participantId !== "string") return json({ error: "BAD_REQUEST" }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: p } = await db.from("spl_study_participants").select("id,book_id").eq("id", participantId).single();
    if (!p?.book_id) return json({ error: "NO_BOOK" }, 409);
    const { data: resp } = await db.from("spl_study_responses").select("answers").eq("participant_id", participantId).eq("instrument_key", instrument).maybeSingle();
    if (!resp) return json({ error: "NO_RESPONSE" }, 409);
    const { data: book } = await db.from("spl_books").select("id,storage_path,file_name,file_size,openai_file_id").eq("id", p.book_id).single();
    const { data: ana } = await db.from("spl_analyses").select("content").eq("book_id", p.book_id).eq("kind", "overview").order("created_at", { ascending: false }).limit(1).maybeSingle();
    let fileId = book?.openai_file_id as string | null;
    if (!fileId) {
      if (Number(book?.file_size) > 45_000_000) return json({ error: "BOOK_TOO_LARGE_FOR_SCORING" }, 413);
      const { data: f, error } = await db.storage.from("spl-books").download(book!.storage_path);
      if (error || !f) throw error ?? new Error("BOOK_DOWNLOAD_FAILED");
      const form = new FormData(); form.append("purpose", "user_data"); form.append("file", f, book!.file_name ?? "book.pdf");
      fileId = (await (await openAI("files", { method: "POST", body: form })).json()).id;
      await db.from("spl_books").update({ openai_file_id: fileId }).eq("id", book!.id);
    }
    const ans = resp.answers as Record<string, unknown>;
    const answerText = ITEMS[instrument].map((c) => `${c}: ${String(ans[c] ?? "").slice(0, 2000)}`).join("\n");
    const summary = JSON.stringify(ana?.content?.overview ?? {}).slice(0, 20000);
    const model = Deno.env.get("OPENAI_SCORING_MODEL") ?? Deno.env.get("OPENAI_TEXT_MODEL") ?? "gpt-5.6-terra";
    const r = await openAI("responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, max_output_tokens: 4000, input: [{ role: "user", content: [{ type: "input_file", file_id: fileId }, { type: "input_text", text: `${RUBRIC}\n\nPLATFORM SUMMARY (for code P only):\n${summary}\n\nANSWERS:\n${answerText}\n\nReturn one entry per item code listed in ANSWERS.` }] }], text: { format: schema } }) });
    const out = await r.json();
    const text = out.output?.flatMap((i: { content?: { text?: string }[] }) => i.content ?? []).map((c: { text?: string }) => c.text ?? "").join("") ?? "";
    const items = (JSON.parse(text).items ?? []).filter((x: { item_code: string }) => ITEMS[instrument].includes(x.item_code));
    const rows = items.map((x: Record<string, unknown>) => ({ participant_id: participantId, instrument_key: instrument, item_code: x.item_code, score: x.score, error_code: x.error_code, confidence: x.confidence, rationale: String(x.rationale ?? "").slice(0, 1500), evidence_page: x.evidence_page, evidence_quote: x.evidence_quote ? String(x.evidence_quote).slice(0, 400) : null, model, protocol_version: PROTOCOL, created_at: new Date().toISOString() }));
    if (rows.length) { const { error } = await db.from("spl_study_ai_scores").upsert(rows, { onConflict: "participant_id,instrument_key,item_code,protocol_version" }); if (error) throw error; }
    await db.from("spl_study_ai_runs").insert({ participant_id: participantId, instrument_key: instrument, model, input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null, researcher_id: u.user.id });
    return json({ ok: true, items: rows, usage: out.usage ?? null });
  } catch (e) { console.error(e); return json({ error: e instanceof Error ? e.message.slice(0, 200) : "UNKNOWN" }, 500); }
});
