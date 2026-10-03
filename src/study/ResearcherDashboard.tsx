import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import "./researcher.css";

// Owner-only study dashboard: invites, participant flow, per-participant approval and the AI switch.
// Every action is also enforced in the database (researcher-only RPCs and RLS); hiding this page is not the protection.

type Row = {
  id: string; code: string; is_test: boolean; status: string; consent_version: string | null; interview_ok: boolean | null;
  book_pages: number | null; book_linked_at: string | null; ai_approved_at: string | null; post_due_at: string | null;
  followup_due_at: string | null; reward_granted_at: string | null; rebind_count: number; created_at: string;
};
type Resp = { participant_id: string; instrument_key: string; instrument_version: string; attention_passed: boolean | null; submitted_at: string; started_at: string | null; answers: Record<string, unknown> };
type InstRow = { key: string; version: string; definition: { sections: { title: string; items?: { code: string; text: string | null; text_en?: string }[] }[] } };
type Settings = { ai_enabled: boolean; max_pages: number; max_process: number; max_asks: number; max_audio_sets: number; max_previews: number };
type Invite = { code: string; invite: string };

const STATUS: Record<string, string> = {
  invited: "مدعو", consented: "وافق", pre_done: "أكمل القبلي", using: "في الاستخدام", post_done: "أكمل البعدي",
  followup_done: "أكمل المتابعة", withdrawn: "انسحب",
};
const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ar", { day: "numeric", month: "short" }) : "—");

export function studyLink(invite?: string) {
  const url = new URL("study.html", window.location.href);
  url.search = invite ? `?code=${encodeURIComponent(invite)}` : "";
  url.hash = "";
  return url.toString();
}

export function inviteMessage(invite: string) {
  return [
    "السلام عليكم ورحمة الله،",
    "أدعوك للمشاركة في دراسة بحثية عن فهم الكتب بمساعدة الذكاء الاصطناعي. تستخدم منصة مع كتاب تملكه لمدة أسبوع، وتجيب عن استبيانين قصيرين وسؤال متابعة.",
    `رابط المشاركة: ${studyLink(invite)}`,
    `رمزك الشخصي: ${invite}`,
    "الرمز خاص بك، فلا تشاركه مع أحد. شكرًا لك.",
  ].join("\n");
}

export default function ResearcherDashboard({ rtl }: { rtl: boolean }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [resps, setResps] = useState<Resp[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [count, setCount] = useState(1);
  const [isTest, setIsTest] = useState(false);
  const [created, setCreated] = useState<Invite[]>([]);
  const [busy, setBusy] = useState("");
  const [insts, setInsts] = useState<InstRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setError("");
    const { data: ok } = await supabase.rpc("spl_study_is_researcher");
    setAllowed(Boolean(ok));
    if (!ok) return;
    const [p, r, ins, s] = await Promise.all([
      supabase.from("spl_study_participants").select("id,code,is_test,status,consent_version,interview_ok,book_pages,book_linked_at,ai_approved_at,post_due_at,followup_due_at,reward_granted_at,rebind_count,created_at").order("code"),
      supabase.from("spl_study_responses").select("participant_id,instrument_key,instrument_version,attention_passed,submitted_at,started_at,answers"),
      supabase.from("spl_study_instruments").select("key,version,definition"),
      supabase.rpc("spl_study_settings", { p_ai_enabled: null }),
    ]);
    if (p.error || r.error || s.error) setError("تعذر تحميل بيانات الدراسة. حدّث الصفحة.");
    setRows((p.data ?? []) as Row[]);
    setResps((r.data ?? []) as Resp[]);
    setInsts((ins.data ?? []) as InstRow[]);
    if (s.data?.ok) setSettings(s.data as Settings);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (allowed === null) return <div className="page rd"><p>جارٍ التحميل…</p></div>;
  if (!allowed) return <div className="page rd"><div className="rd-card">هذه الصفحة للباحث فقط.</div></div>;

  const respOf = (id: string, key: string) => resps.find(x => x.participant_id === id && x.instrument_key === key);
  const real = rows.filter(x => !x.is_test);
  const n = (f: (x: Row) => boolean) => real.filter(f).length;
  const after = (s: string) => ["pre_done", "using", "post_done", "followup_done"].indexOf(s);
  const flow: [string, number][] = [
    ["مدعو", real.length],
    ["وافق", n(x => x.status !== "invited")],
    ["أكمل القبلي", n(x => after(x.status) >= 0)],
    ["ربط كتابه", n(x => Boolean(x.book_linked_at))],
    ["وافقتَ عليه", n(x => Boolean(x.ai_approved_at))],
    ["أكمل البعدي", n(x => after(x.status) >= 2)],
    ["أكمل المتابعة", n(x => x.status === "followup_done")],
    ["انسحب", n(x => x.status === "withdrawn")],
  ];

  const createInvites = async () => {
    if (!supabase) return;
    setBusy("invite"); setError("");
    const { data, error: e } = await supabase.rpc("spl_study_create_invites", { p_count: Math.min(20, Math.max(1, count)), p_test: isTest });
    setBusy("");
    if (e) { setError("تعذر إنشاء الرموز."); return; }
    setCreated((data ?? []) as Invite[]);
    await load();
  };
  const approve = async (code: string) => {
    if (!supabase || !window.confirm(`الموافقة على ${code} تفتح له التحليل المدفوع وتبدأ أيامه السبعة الآن. متابعة؟`)) return;
    setBusy(code);
    const { data } = await supabase.rpc("spl_study_approve", { p_code: code });
    setBusy("");
    if (!data?.ok) setError(`تعذرت الموافقة على ${code}: ${data?.error ?? "خطأ"}`);
    await load();
  };
  const toggleAi = async () => {
    if (!supabase || !settings) return;
    const next = !settings.ai_enabled;
    if (!window.confirm(next ? "فتح التحليل المدفوع لكل المشاركين الموافَق عليهم؟ (على حسابك)" : "إيقاف التحليل المدفوع لكل المشاركين فورًا؟")) return;
    setBusy("ai");
    const { data } = await supabase.rpc("spl_study_settings", { p_ai_enabled: next });
    setBusy("");
    if (data?.ok) setSettings(data as Settings); else setError("تعذر تغيير المفتاح.");
  };
  const removeTest = async (row: Row) => {
    if (!supabase || !row.is_test) return;
    if (!window.confirm(`حذف المشارك التجريبي ${row.code} وكل إجاباته وسجلاته نهائيًا؟`)) return;
    setBusy(row.id);
    const { error: e } = await supabase.from("spl_study_participants").delete().eq("id", row.id).eq("is_test", true);
    setBusy("");
    if (e) setError("تعذر الحذف."); else { setOpen(null); await load(); }
  };
  const labelOf = (key: string, version: string, code: string) => {
    const def = insts.find(i => i.key === key && i.version === version)?.definition;
    const base = code.replace(/_OTHER$/, "");
    for (const sec of def?.sections ?? []) for (const it of sec.items ?? []) if (it.code === base) return (it.text ?? it.text_en ?? code) + (code.endsWith("_OTHER") ? " (أخرى)" : "");
    return code;
  };
  const fmt = (v: unknown) => Array.isArray(v) ? v.join("، ") : v === null || v === undefined ? "—" : String(v);
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); } catch { window.prompt("انسخ النص:", text); } };

  return (
    <div className="page rd" dir={rtl ? "rtl" : "ltr"}>
      <div className="rd-head">
        <h2>لوحة الدراسة — المرحلة (أ)</h2>
        <p>من هنا تدعو المشاركين، وتتابع مراحلهم، وتوافق على كتبهم، وتتحكم في التكلفة.</p>
        <div className="rd-actions">
          <a className="secondary" href={studyLink()} target="_blank" rel="noopener noreferrer">فتح صفحة المشارك</a>
          <button className="secondary" onClick={() => void load()}>تحديث</button>
        </div>
      </div>
      {error && <div className="rd-error" role="alert">{error}</div>}

      <details className="rd-card rd-guide">
        <summary>دليل الباحث</summary>
        <h4>قبل البدء</h4>
        <ol>
          <li>جرّب المسار كاملًا بمشارك <b>تجريبي</b> (علّم «تجريبي» عند إنشاء الرمز). التجريبيون لا يدخلون التحليل ولا مخطط التدفق.</li>
          <li>تأكد أن الاستبيانات المعروضة هي النسخة المعتمدة (تبويب «تصور الأدوات» في الإندكس).</li>
          <li>لا تعدّل الأدوات ولا دليل المشارك بعد دعوة أول مشارك حقيقي؛ أي تعديل يُسجَّل نسخةً جديدة في الإندكس.</li>
        </ol>
        <h4>دعوة مشارك</h4>
        <ol>
          <li>أنشئ رمزًا لكل شخص، وانسخ «رسالة الدعوة» وأرسلها له وحده. الرمز يظهر مرة واحدة؛ إن ضاع فأنشئ رمزًا جديدًا.</li>
          <li>لا ترسل الرموز في مجموعة: من يملك الرمز يدخل باسم صاحبه.</li>
        </ol>
        <h4>الموافقة والتكلفة</h4>
        <ol>
          <li>افتح «مفتاح التحليل المدفوع» مرة واحدة عند بدء الدراسة، وأغلقه فورًا إن لاحظت صرفًا غير متوقع.</li>
          <li>حين يظهر «موافقة» بجانب مشارك، راجع عدد صفحات كتابه ثم وافق. وافق خلال ٢٤ ساعة: الانتظار الطويل يرفع الانسحاب، ولا يُنقص أيامه السبعة لأنها تبدأ من موافقتك.</li>
        </ol>
        <h4>قراءة الجدول</h4>
        <ul>
          <li>↻ بجانب الرمز: أعاد المشارك إدخال رمزه من جهاز آخر. تكرارها كثيرًا قد يعني أن الرمز تسرّب.</li>
          <li>⚠️ انتباه: رسب في بند الانتباه؛ يحصل على الحافز وتُستبعد بياناته من التحليل.</li>
          <li>مخطط التدفق هو نفسه ما تضعه في فصل النتائج (عدد المدعوين، ومن أكمل كل مرحلة، ومن انسحب).</li>
        </ul>
        <h4>ما ليس هنا بعد</h4>
        <p className="rd-muted">قراءة كتاب المشارك ومخرجاته للتصحيح، وتصدير البيانات للتحليل: في التحديث القادم.</p>
      </details>
      <section className="rd-card">
        <h3>كيف تسير المشاركة</h3>
        <ol className="rd-steps">
          <li><b>تنشئ رمزًا</b> لكل مشارك هنا، وترسل له الرسالة الجاهزة (واتساب أو بريد).</li>
          <li><b>يفتح الرابط</b> ويكتب رمزه، فيوافق ويجيب عن القبلي.</li>
          <li><b>يرفع كتابه</b> (حتى {settings?.max_pages ?? 400} صفحة)، فيظهر هنا «ربط كتابه».</li>
          <li><b>توافق عليه</b> بزر «موافقة»، فيُفتح له التحليل وتبدأ أيامه السبعة.</li>
          <li>بعد ٧ أيام يُفتح <b>البعدي</b> (ويُمنح الحافز عند إرساله)، ثم <b>المتابعة</b> بعد ١٤ يومًا.</li>
        </ol>
      </section>

      <section className="rd-card">
        <h3>مخطط تدفق المشاركين (دون التجريبيين)</h3>
        <div className="rd-flow">{flow.map(([k, v], i) => <div key={k} className={i === flow.length - 1 ? "rd-out" : ""}><strong>{v}</strong><span>{k}</span></div>)}</div>
      </section>

      <section className="rd-card">
        <h3>التكلفة: مفتاح التحليل المدفوع</h3>
        {settings ? (
          <>
            <p>الحالة: <b className={settings.ai_enabled ? "rd-on" : "rd-off"}>{settings.ai_enabled ? "مفتوح" : "مغلق"}</b>. يحتاج المشارك إلى هذا المفتاح مفتوحًا <b>و</b>موافقتك عليه.</p>
            <p className="rd-muted">حدود كل مشارك: {settings.max_process} تحليل · {settings.max_asks} سؤالًا · {settings.max_audio_sets} مجموعة صوت · {settings.max_previews} معاينات · حتى {settings.max_pages} صفحة.</p>
            <button className={settings.ai_enabled ? "secondary" : "primary"} disabled={busy === "ai"} onClick={() => void toggleAi()}>{settings.ai_enabled ? "إيقاف للجميع" : "فتح المفتاح"}</button>
          </>
        ) : <p>—</p>}
      </section>

      <section className="rd-card">
        <h3>دعوة مشاركين</h3>
        <div className="rd-inline">
          <label>العدد <input type="number" min={1} max={20} value={count} onChange={e => setCount(Number(e.target.value) || 1)} /></label>
          <label><input type="checkbox" checked={isTest} onChange={e => setIsTest(e.target.checked)} /> تجريبي (T-…، لا يدخل التحليل)</label>
          <button className="primary" disabled={busy === "invite"} onClick={() => void createInvites()}>{busy === "invite" ? "…" : "إنشاء الرموز"}</button>
        </div>
        {created.length > 0 && (
          <div className="rd-created">
            <p className="rd-warn">انسخ الرموز الآن: تظهر <b>مرة واحدة</b> فقط، ولا تُحفظ إلا بصمتها.</p>
            {created.map(c => (
              <div key={c.code} className="rd-invite">
                <span><b>{c.code}</b> · <code dir="ltr">{c.invite}</code></span>
                <button className="secondary" onClick={() => void copy(inviteMessage(c.invite))}>نسخ رسالة الدعوة</button>
                <button className="secondary" onClick={() => void copy(studyLink(c.invite))}>نسخ الرابط فقط</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rd-card">
        <h3>المشاركون ({rows.length})</h3>
        <div className="rd-table"><table>
          <thead><tr><th>الرمز</th><th>المرحلة</th><th>الموافقة</th><th>القبلي</th><th>الكتاب</th><th>موافقتك</th><th>البعدي يُفتح</th><th>البعدي</th><th>الحافز</th><th>المتابعة</th><th></th></tr></thead>
          <tbody>{rows.map(r => {
            const pre = respOf(r.id, "pre"), post = respOf(r.id, "post"), fu = respOf(r.id, "followup");
            const att = (x?: Resp) => !x ? "—" : `${d(x.submitted_at)} ${x.attention_passed === false ? "⚠️ انتباه" : x.attention_passed ? "✓" : ""}`;
            return [
              <tr key={r.id} className={r.is_test ? "rd-test" : ""}>
                <td><b dir="ltr">{r.code}</b>{r.rebind_count > 0 && <small title="أعاد إدخال الرمز من جهاز آخر"> ↻{r.rebind_count}</small>}</td>
                <td>{STATUS[r.status] ?? r.status}</td>
                <td>{r.consent_version ?? "—"}{r.interview_ok ? " · مقابلة ✓" : ""}</td>
                <td>{att(pre)}</td>
                <td>{r.book_linked_at ? `${r.book_pages} ص · ${d(r.book_linked_at)}` : "—"}</td>
                <td>{r.ai_approved_at ? d(r.ai_approved_at) : r.book_linked_at && r.status === "using" ? <button className="primary" disabled={busy === r.code} onClick={() => void approve(r.code)}>موافقة</button> : "—"}</td>
                <td>{d(r.post_due_at)}</td>
                <td>{att(post)}</td>
                <td>{r.reward_granted_at ? `✓ ${d(r.reward_granted_at)}` : "—"}</td>
                <td>{att(fu)}</td>
                <td className="rd-rowact">
                  {(pre || post || fu) && <button className="secondary" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "إخفاء" : "الإجابات"}</button>}
                  {r.is_test && <button className="secondary rd-del" disabled={busy === r.id} onClick={() => void removeTest(r)}>حذف</button>}
                </td>
              </tr>,
              open === r.id ? (
                <tr key={r.id + "-a"} className="rd-answers"><td colSpan={11}>
                  {[pre, post, fu].filter(Boolean).map(x => (
                    <details key={x!.instrument_key} open>
                      <summary>{x!.instrument_key === "pre" ? "القبلي" : x!.instrument_key === "post" ? "البعدي" : "المتابعة"} · نسخة {x!.instrument_version}{x!.started_at ? ` · ${Math.round((new Date(x!.submitted_at).getTime() - new Date(x!.started_at).getTime()) / 60000)} دقيقة` : ""}</summary>
                      <table><tbody>{Object.entries(x!.answers).map(([k, v]) => <tr key={k}><td dir="ltr">{k}</td><td>{labelOf(x!.instrument_key, x!.instrument_version, k)}</td><td><b>{fmt(v)}</b></td></tr>)}</tbody></table>
                    </details>
                  ))}
                </td></tr>
              ) : null,
            ];
          })}</tbody>
        </table></div>
        <p className="rd-muted">⚠️ انتباه = رسب في بند الانتباه: يحصل على الحافز، وتُستبعد بياناته من التحليل. السطر الباهت مشارك تجريبي: لا يدخل التحليل ولا مخطط التدفق، ويمكن حذفه بزر «حذف».</p>
      </section>
    </div>
  );
}
