import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Rubric scoring for open comprehension answers (0–2, error codes E = distortion, P = error carried from the platform).
// Reference = the book itself; the platform summary is shown only to detect P errors. Read-only material.
const ITEMS: Record<"post" | "followup", [string, string][]> = {
  post: [["UND_IDEA1", "الفكرة ١"], ["UND_IDEA2", "الفكرة ٢"], ["UND_IDEA3", "الفكرة ٣"], ["UND_THESIS", "الرسالة"], ["UND_APPLY", "التطبيق"]],
  followup: [["FU_IDEA1", "فكرة المتابعة ١"], ["FU_IDEA2", "فكرة المتابعة ٢"]],
};
type Score = { item_code: string; instrument_key: string; score: number | null; error_code: "E" | "P" | null; note: string | null };
type Ai = { item_code: string; instrument_key: string; score: number; error_code: "E" | "P" | null; confidence: "high" | "medium" | "low"; rationale: string; evidence_page: string | null; evidence_quote: string | null };
// Protocol v1.0 review rule: every item with an error code or non-high confidence, plus a fixed ~20% random sample.
export const inSample = (pid: string, item: string) => [...(pid + item)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5 === 0;
type Material = { ok: boolean; error?: string; title?: string; storage_path?: string; pages?: number; analysis?: { overview?: { summary?: string; key_ideas?: unknown[]; return_to_source?: { page?: unknown; reason?: string }[] } } };

export default function ScoringPanel({ participantId, code, answers, onClose }: { participantId: string; code: string; answers: { post?: Record<string, unknown>; followup?: Record<string, unknown> }; onClose: () => void }) {
  const [mat, setMat] = useState<Material | null>(null);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [saving, setSaving] = useState("");
  const [msg, setMsg] = useState("");
  const [ai, setAi] = useState<Record<string, Ai>>({});
  const [running, setRunning] = useState("");
  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      const [{ data: m }, { data: s }, { data: a }] = await Promise.all([
        supabase!.rpc("spl_study_scoring_material", { p_participant: participantId }),
        supabase!.from("spl_study_scores").select("item_code,instrument_key,score,error_code,note").eq("participant_id", participantId),
        supabase!.from("spl_study_ai_scores").select("item_code,instrument_key,score,error_code,confidence,rationale,evidence_page,evidence_quote").eq("participant_id", participantId).eq("protocol_version", "1.0"),
      ]);
      const am: Record<string, Ai> = {}; ((a ?? []) as Ai[]).forEach((x) => { am[`${x.instrument_key}:${x.item_code}`] = x; }); setAi(am);
      setMat((m ?? { ok: false }) as Material);
      const map: Record<string, Score> = {};
      ((s ?? []) as Score[]).forEach((x) => { map[`${x.instrument_key}:${x.item_code}`] = x; });
      setScores(map);
    })();
  }, [participantId]);
  const openBook = async () => {
    if (!supabase || !mat?.storage_path) return;
    const { data, error } = await supabase.storage.from("spl-books").createSignedUrl(mat.storage_path, 600);
    if (error || !data?.signedUrl) { setMsg("تعذر فتح الكتاب."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const update = (key: string, patch: Partial<Score>) => setScores((m) => ({ ...m, [key]: { ...(m[key] ?? { item_code: key.split(":")[1], instrument_key: key.split(":")[0], score: null, error_code: null, note: null }), ...patch } }));
  const save = async (key: string) => {
    if (!supabase) return;
    const s = scores[key]; if (!s) return;
    setSaving(key); setMsg("");
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("spl_study_scores").upsert({ participant_id: participantId, instrument_key: s.instrument_key, item_code: s.item_code, score: s.score, error_code: s.error_code, note: s.note || null, rater_id: u.user?.id, updated_at: new Date().toISOString() }, { onConflict: "participant_id,instrument_key,item_code,rater_id" });
    setSaving("");
    setMsg(error ? "تعذر الحفظ." : "حُفظ ✓");
  };
  const runAi = async (k: "post" | "followup") => {
    if (!supabase || !window.confirm("يرسل الكتاب والإجابات إلى الذكاء الاصطناعي لاقتراح الدرجات (تكلفة من رصيدك، تقديرًا بضعة سنتات). متابعة؟")) return;
    setRunning(k); setMsg("");
    const { data, error } = await supabase.functions.invoke("spl-study-score", { body: { participantId, instrument: k } });
    setRunning("");
    if (error || !data?.ok) { setMsg(`تعذر التصحيح الآلي: ${data?.error ?? error?.message ?? ""}`); return; }
    const am = { ...ai }; (data.items as Ai[]).forEach((x) => { am[`${x.instrument_key}:${x.item_code}`] = x; }); setAi(am);
    setMsg("وصلت اقتراحات الآلة. راجع المعلَّمة بـ «للمراجعة» أولًا.");
  };
  const total = (k: "post" | "followup") => ITEMS[k].reduce((a, [c]) => a + (scores[`${k}:${c}`]?.score ?? 0), 0);
  const ov = mat?.analysis?.overview;
  return (
    <section className="rd-card rd-scoring">
      <div className="rd-actions" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>تصحيح إجابات {code}</h3>
        <button className="secondary" onClick={onClose}>إغلاق</button>
      </div>
      <p className="rd-muted">المرجع هو <b>الكتاب نفسه</b>: ٢ فكرة جوهرية صحيحة، ١ ثانوية أو عامة، ٠ غير موجودة. رمز <b>E</b> تحريف لما في الكتاب، ورمز <b>P</b> خطأ موجود في خلاصة المنصة لا في الكتاب. الخلاصة أدناه لكشف P فقط.</p>
      {mat && !mat.ok && <p className="rd-error">لا يوجد كتاب مربوط لهذا المشارك بعد.</p>}
      {mat?.ok && <div className="rd-actions"><button className="secondary" onClick={() => void openBook()}>📖 افتح الكتاب ({mat.title}{mat.pages ? ` · ${mat.pages} ص` : ""})</button></div>}
      <div className="rd-score-grid">
        <div>
          {(["post", "followup"] as const).filter((k) => answers[k]).map((k) => (
            <div key={k}>
              <h4>{k === "post" ? "البعدي" : "المتابعة"} — المجموع: {total(k)} من {ITEMS[k].length * 2}</h4>
              <div className="rd-actions"><button className="primary" disabled={running === k || !mat?.ok} onClick={() => void runAi(k)}>{running === k ? "جارٍ التصحيح الآلي…" : "✦ اقترح الدرجات بالذكاء الاصطناعي"}</button></div>
              {ITEMS[k].map(([c, label]) => { const key = `${k}:${c}`; const s = scores[key]; return (
                <div className="rd-score-item" key={key}>
                  <b>{label}</b>
                  <p className="rd-answer">{String(answers[k]?.[c] ?? "—")}</p>
                  {ai[key] && (() => { const x = ai[key]; const review = !!x.error_code || x.confidence !== "high" || inSample(participantId, c); return (
                    <div className={`rd-ai ${review ? "review" : ""}`}>
                      <div><b>اقتراح الآلة: {x.score}</b>{x.error_code && <> · رمز {x.error_code}</>} · الثقة: {x.confidence === "high" ? "عالية" : x.confidence === "medium" ? "متوسطة" : "منخفضة"}{review && <span className="rd-flag">للمراجعة</span>}</div>
                      <div>{x.rationale}</div>
                      {(x.evidence_page || x.evidence_quote) && <div className="rd-evidence">{x.evidence_page && <>ص {x.evidence_page}: </>}{x.evidence_quote && <q>{x.evidence_quote}</q>}</div>}
                      <button className="secondary" onClick={() => update(key, { score: x.score, error_code: x.error_code })}>اعتمد الاقتراح</button>
                    </div>); })()}
                  <div className="rd-actions">
                    {[0, 1, 2].map((n) => <button key={n} className={s?.score === n ? "primary" : "secondary"} onClick={() => update(key, { score: n })}>{n}</button>)}
                    {(["E", "P"] as const).map((e) => <button key={e} className={s?.error_code === e ? "primary" : "secondary"} onClick={() => update(key, { error_code: s?.error_code === e ? null : e })}>{e}</button>)}
                  </div>
                  <input className="rd-note" placeholder="ملاحظة (اختياري)" value={s?.note ?? ""} onChange={(e) => update(key, { note: e.target.value })} />
                  <button className="secondary" disabled={saving === key || !s} onClick={() => void save(key)}>{saving === key ? "…" : "حفظ"}</button>
                </div>
              ); })}
            </div>
          ))}
          {msg && <p className="rd-muted">{msg}</p>}
        </div>
        <aside className="rd-summary">
          <h4>خلاصة المنصة لهذا الكتاب (لكشف P)</h4>
          {ov ? <>
            <p style={{ whiteSpace: "pre-wrap" }}>{ov.summary ?? "—"}</p>
            {!!ov.key_ideas?.length && <><b>الأفكار المحورية</b><ol>{ov.key_ideas.map((x, i) => <li key={i}>{typeof x === "string" ? x : JSON.stringify(x)}</li>)}</ol></>}
          </> : <p className="rd-muted">لا توجد خلاصة محفوظة بعد.</p>}
        </aside>
      </div>
    </section>
  );
}
