import { useState } from "react";

// Formative evaluation form (design iteration feedback). Not study data; answers go to the researcher's
// Study dashboard and are used to improve the platform before the study version is frozen.
const SCALE: [string, string][] = [
  ["FB_READ", "كان الخط واضحًا ومريحًا للقراءة."],
  ["FB_CARDS", "ساعدني تقسيم الخلاصة إلى بطاقات على متابعة القراءة."],
  ["FB_AUDIO", "كان الاستماع إلى الصوت مفيدًا."],
  ["FB_RETURN", "شجعني العرض على الرجوع إلى الكتاب الأصلي."],
];
const LABELS = ["لا أوافق بشدة", "لا أوافق", "محايد", "أوافق", "أوافق بشدة"];

export default function FormativeFeedback({ token, bookId, preview = false }: { token: string; bookId?: string; preview?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, number | "na" | string>>({});
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const set = (k: string, v: number | "na" | string) => setAnswers((a) => ({ ...a, [k]: v }));
  const device = typeof window !== "undefined" && window.innerWidth < 760 ? "هاتف" : window.innerWidth < 1100 ? "جهاز لوحي" : "كمبيوتر";
  const send = async () => {
    if (!consent) { setMsg("فضلًا أشّر على الموافقة أولًا."); return; }
    setState("sending"); setMsg("");
    try {
      const res = await fetch(import.meta.env.VITE_SUPABASE_URL + "/functions/v1/spl-design-feedback", { method: "POST", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, consent, answers, device, bookId }) });
      if (!res.ok) throw new Error(String(res.status));
      setState("done");
    } catch (e) {
      setState("error");
      setMsg(String(e).includes("429") ? "وصلت ملاحظات كثيرة من هذا الجهاز اليوم. شكرًا لك." : "تعذر الإرسال. حاول مرة أخرى.");
    }
  };
  if (state === "done") return <section className="panel formative-feedback"><h3>شكرًا لك ✅</h3><p>وصلت ملاحظاتك إلى الباحث، وستُستخدم لتحسين المنصة.</p></section>;
  return (
    <section className="panel formative-feedback">
      {preview && <p className="ff-preview">معاينة لك وحدك: هكذا يرى زملاؤك هذا النموذج في رابطهم. الإرسال يعمل من رابطهم فقط، وتصلك إجاباتهم في «لوحة الدراسة».</p>}
      <span className="eyebrow">رأيك في التصميم</span>
      <h3>ساعدنا في تحسين المنصة</h3>
      <p className="ff-note">نجرّب المنصة مع عدد قليل من القراء قبل الدراسة. ملاحظاتك لتطوير التصميم فقط، ولا تُنشر باسمك. أقل من دقيقتين.</p>
      {SCALE.map(([k, q]) => (
        <fieldset key={k} className="ff-item">
          <legend>{q}</legend>
          <div className="ff-scale">
            {LABELS.map((l, i) => <label key={l} className={answers[k] === i + 1 ? "on" : ""}><input type="radio" name={k} checked={answers[k] === i + 1} onChange={() => set(k, i + 1)} /><span>{i + 1}</span><small>{l}</small></label>)}
            {k === "FB_AUDIO" && <label className={answers[k] === "na" ? "on" : ""}><input type="radio" name={k} checked={answers[k] === "na"} onChange={() => set(k, "na")} /><span>—</span><small>لم أستمع</small></label>}
          </div>
        </fieldset>
      ))}
      <label className="ff-text">ما أكثر ما أعجبك؟ (اختياري)<textarea value={String(answers.FB_BEST ?? "")} onChange={(e) => set("FB_BEST", e.target.value)} maxLength={1500} /></label>
      <label className="ff-text">ما الذي تقترح تغييره؟ (اختياري)<textarea value={String(answers.FB_SUGGEST ?? "")} onChange={(e) => set("FB_SUGGEST", e.target.value)} maxLength={1500} /></label>
      <label className="ff-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> أوافق أن تُستخدم ملاحظاتي لتطوير المنصة، دون ذكر اسمي.</label>
      {msg && <p role="alert" className="ff-msg">{msg}</p>}
      <button type="button" className="primary" disabled={preview || state === "sending"} onClick={() => void send()}>{state === "sending" ? "جارٍ الإرسال…" : "إرسال الملاحظات"}</button>
    </section>
  );
}
