import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Rubric scoring for open comprehension answers (0–2, error codes E = distortion, P = error carried from the platform).
// Reference = the book itself; the platform summary is shown only to detect P errors. Read-only material.
const ITEMS: Record<"post" | "followup", [string, string][]> = {
  post: [["UND_IDEA1", "الفكرة ١"], ["UND_IDEA2", "الفكرة ٢"], ["UND_IDEA3", "الفكرة ٣"], ["UND_THESIS", "الرسالة"], ["UND_APPLY", "التطبيق"]],
  followup: [["FU_IDEA1", "فكرة المتابعة ١"], ["FU_IDEA2", "فكرة المتابعة ٢"]],
};
type Score = { item_code: string; instrument_key: string; score: number | null; error_code: "E" | "P" | null; note: string | null };
type Material = { ok: boolean; error?: string; title?: string; storage_path?: string; pages?: number; analysis?: { overview?: { summary?: string; key_ideas?: unknown[]; return_to_source?: { page?: unknown; reason?: string }[] } } };

export default function ScoringPanel({ participantId, code, answers, onClose }: { participantId: string; code: string; answers: { post?: Record<string, unknown>; followup?: Record<string, unknown> }; onClose: () => void }) {
  const [mat, setMat] = useState<Material | null>(null);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [saving, setSaving] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      const [{ data: m }, { data: s }] = await Promise.all([
        supabase!.rpc("spl_study_scoring_material", { p_participant: participantId }),
        supabase!.from("spl_study_scores").select("item_code,instrument_key,score,error_code,note").eq("participant_id", participantId),
      ]);
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
              {ITEMS[k].map(([c, label]) => { const key = `${k}:${c}`; const s = scores[key]; return (
                <div className="rd-score-item" key={key}>
                  <b>{label}</b>
                  <p className="rd-answer">{String(answers[k]?.[c] ?? "—")}</p>
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
