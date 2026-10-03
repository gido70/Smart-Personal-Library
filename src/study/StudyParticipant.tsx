import { useCallback, useEffect, useState } from "react";
import "./study.css";
import Questionnaire from "./Questionnaire";
import ParticipantGuide from "./ParticipantGuide";
import type { Answers, Instrument, Participant } from "./types";
import { studyErrorMessage } from "./formLogic";
import { ensureAnonymousSession, giveConsent, joinStudy, loadInstruments, loadParticipant, submitInstrument, withdrawFromStudy } from "./studyApi";

type Phase = "loading" | "fatal" | "ready";

const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ar", { dateStyle: "full", timeStyle: "short" }) : "");
const PLATFORM = "index.html?participant=1";
const isDue = (iso: string | null) => Boolean(iso && Date.now() >= new Date(iso).getTime());

export default function StudyParticipant() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [fatal, setFatal] = useState("");
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [instruments, setInstruments] = useState<Record<string, Instrument>>({});
  // A link carrying a code while this browser is already enrolled with another code (shared device,
  // replacement code, or the researcher testing): ask before switching instead of silently ignoring it.
  const [urlCode] = useState(() => new URLSearchParams(window.location.search).get("code") ?? "");
  const [switching, setSwitching] = useState(false);

  const refresh = useCallback(async () => {
    const p = await loadParticipant();
    setParticipant(p);
    if (p) setInstruments(await loadInstruments());
  }, []);

  useEffect(() => { if (phase === "ready" && participant && urlCode) setSwitching(true); }, [phase, participant, urlCode]);
  useEffect(() => {
    document.title = "المشاركة في الدراسة — المكتبة الشخصية الذكية";
    (async () => {
      try {
        await ensureAnonymousSession();
        await refresh();
        setPhase("ready");
      } catch (error) {
        setFatal(error instanceof Error && error.message === "SUPABASE_NOT_CONFIGURED" ? "الخادم غير مهيأ." : studyErrorMessage(error instanceof Error ? error.message : undefined));
        setPhase("fatal");
      }
    })();
  }, [refresh]);

  const submit = async (key: string, answers: Answers, startedAt: string) => {
    const result = await submitInstrument(key, answers, startedAt);
    if (!result.ok) throw new Error(studyErrorMessage(result.error));
    await refresh();
  };

  let body: React.ReactNode;
  if (phase === "loading") body = <div className="study-card"><p>جارٍ التحميل…</p></div>;
  else if (phase === "fatal") body = <div className="study-card"><div className="study-error" role="alert">{fatal}</div></div>;
  else if (!participant || switching) body = <JoinScreen onJoined={async () => { setSwitching(false); await refresh(); }} onCancel={participant ? () => { setSwitching(false); window.history.replaceState(null, "", window.location.pathname); } : undefined} current={participant?.code} />;
  else body = <Stage participant={participant} instruments={instruments} onSubmit={submit} onConsented={refresh} />;

  return (
    <div className="study-page" dir="rtl" lang="ar">
      <header className="study-header">
        <h1>المكتبة الشخصية الذكية</h1>
        <p>المشاركة في الدراسة البحثية</p>
      </header>
      <main>{body}{phase === "ready" && <ParticipantGuide />}</main>
      {participant && !switching && <Footer participant={participant} onWithdrawn={refresh} onSwitch={() => setSwitching(true)} />}
    </div>
  );
}

function JoinScreen({ onJoined, onCancel, current }: { onJoined: () => Promise<void>; onCancel?: () => void; current?: string }) {
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get("code") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const join = async () => {
    const trimmed = code.replace(/[\s-]/g, "").toUpperCase();
    if (trimmed.length < 6) { setError("اكتب الرمز كاملًا كما وصلك."); return; }
    setBusy(true); setError("");
    try {
      const result = await joinStudy(trimmed);
      if (!result.ok) { setError(studyErrorMessage(result.error)); return; }
      if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
      await onJoined();
    } catch (e) {
      setError(studyErrorMessage(e instanceof Error ? e.message : undefined));
    } finally { setBusy(false); }
  };
  return (
    <div className="study-card">
      <h2>{current ? "الدخول برمز آخر" : "أهلًا بك"}</h2>
      {current && <div className="study-note">هذا المتصفح مسجّل حاليًا بالرمز <strong dir="ltr">{current}</strong>. إن دخلت برمز آخر، تعود إلى {current} لاحقًا بإدخال رمز دعوته نفسه.</div>}
      <p>اكتب رمز المشاركة الذي وصلك من الباحث. الرمز شخصي، فلا تشاركه مع أحد.</p>
      <label className="study-field">
        <span>رمز المشاركة</span>
        <input dir="ltr" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code}
          onChange={event => setCode(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void join(); }} placeholder="مثال: K7M3QX9P2A" />
      </label>
      {error && <div className="study-error" role="alert">{error}</div>}
      <div className="study-actions"><button type="button" className="study-primary" disabled={busy} onClick={() => void join()}>{busy ? "جارٍ التحقق…" : "دخول"}</button>{onCancel && <button type="button" className="study-secondary" onClick={onCancel}>البقاء على {current}</button>}</div>
      <p className="study-muted study-small">إن غيّرت جهازك أو متصفحك، أدخل الرمز نفسه لتكمل من حيث توقفت.</p>
    </div>
  );
}

function ConsentScreen({ instrument, onDone }: { instrument: Instrument; onDone: () => Promise<void> }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const required = (instrument.checks ?? []).filter(c => c.required);
  const ready = required.every(c => checked[c.code]);
  const agree = async () => {
    if (!ready) { setError("يلزم تأكيد البنود الإلزامية الثلاثة للمتابعة."); return; }
    setBusy(true); setError("");
    try {
      const result = await giveConsent(instrument.version, Boolean(checked.CONSENT_INTERVIEW));
      if (!result.ok) { setError(studyErrorMessage(result.error)); return; }
      await onDone();
    } catch (e) { setError(studyErrorMessage(e instanceof Error ? e.message : undefined)); }
    finally { setBusy(false); }
  };
  return (
    <div className="study-card">
      <h2>{instrument.title}</h2>
      {instrument.sections.flatMap(s => s.blocks ?? []).map(([head, text]) => (
        <div key={head} className="study-block"><h3>{head}</h3><p>{text}</p></div>
      ))}
      <div className="study-checks">
        {(instrument.checks ?? []).map(c => (
          <label key={c.code} className={checked[c.code] ? "selected" : ""}>
            <input type="checkbox" checked={Boolean(checked[c.code])} onChange={() => setChecked(prev => ({ ...prev, [c.code]: !prev[c.code] }))} />
            <span>{c.text}</span>
          </label>
        ))}
      </div>
      {error && <div className="study-error" role="alert">{error}</div>}
      <div className="study-actions"><button type="button" className="study-primary" disabled={busy || !ready} onClick={() => void agree()}>{busy ? "جارٍ الحفظ…" : "أوافق وأبدأ"}</button></div>
      <p className="study-muted study-small">نسخة نص الموافقة: {instrument.version}</p>
    </div>
  );
}

function Stage({ participant, instruments, onSubmit, onConsented }: {
  participant: Participant;
  instruments: Record<string, Instrument>;
  onSubmit: (key: string, answers: Answers, startedAt: string) => Promise<void>;
  onConsented: () => Promise<void>;
}) {
  const draft = (key: string) => `spl-study-draft:${participant.code}:${key}:${instruments[key]?.version ?? "0"}`;
  const missing = (key: string) => <div className="study-card"><div className="study-error">الاستبيان غير متاح الآن ({key}). تواصل مع الباحث.</div></div>;
  switch (participant.status) {
    case "invited":
      return instruments.consent ? <ConsentScreen instrument={instruments.consent} onDone={onConsented} /> : missing("consent");
    case "consented":
      return instruments.pre ? <Questionnaire instrument={instruments.pre} draftKey={draft("pre")} onSubmit={(a, s) => onSubmit("pre", a, s)} /> : missing("pre");
    case "pre_done":
      return (
        <div className="study-card">
          <h2>شكرًا، اكتمل الاستبيان القبلي ✅</h2>
          <p>الخطوة التالية: رفع كتابك واستخدام المنصة معه لمدة ٧ أيام.</p>
          <p>اضغط الزر لفتح المنصة، ثم «أضف كتابًا» وارفع ملف PDF لكتاب تملكه أردت قراءته ولم تقرأه (حتى ٤٠٠ صفحة). بعد الرفع ينتظر كتابك موافقة الباحث، ومن لحظة الموافقة تبدأ أيامك السبعة.</p>
          <div className="study-actions"><a className="study-primary" href={PLATFORM}>افتح المنصة وارفع كتابك</a></div>
        </div>
      );
    case "using":
      if (isDue(participant.post_due_at)) {
        return instruments.post ? <Questionnaire instrument={instruments.post} draftKey={draft("post")} onSubmit={(a, s) => onSubmit("post", a, s)} /> : missing("post");
      }
      return (
        <div className="study-card">
          <h2>{participant.post_due_at ? "فترة الاستخدام جارية" : "كتابك بانتظار موافقة الباحث"}</h2>
          <p>{participant.post_due_at ? "استخدم المنصة مع كتابك بالقدر الذي تريده." : "يمكنك فتح كتابك وقراءته الآن. يُفتح التحليل بعد موافقة الباحث، ومنها تبدأ أيامك السبعة."}</p>
          {participant.post_due_at && <div className="study-note">يُفتح الاستبيان البعدي في: <strong>{dateFmt(participant.post_due_at)}</strong></div>}
          <div className="study-actions"><a className="study-primary" href={PLATFORM}>افتح المنصة</a></div>
        </div>
      );
    case "post_done":
      if (isDue(participant.followup_due_at)) {
        return instruments.followup ? <Questionnaire instrument={instruments.followup} draftKey={draft("followup")} onSubmit={(a, s) => onSubmit("followup", a, s)} /> : missing("followup");
      }
      return (
        <div className="study-card">
          <h2>شكرًا، اكتمل الاستبيان البعدي ✅</h2>
          <p>الخلاصة والصوت لكتابك لك الآن: نزّلهما من صفحة كتابك في المنصة قبل نهاية الدراسة.</p>
          <div className="study-actions"><a className="study-secondary" href={PLATFORM}>افتح المنصة</a></div>
          <div className="study-note">بقي سؤال متابعة قصير يُفتح في: <strong>{dateFmt(participant.followup_due_at)}</strong></div>
        </div>
      );
    case "followup_done":
      return <div className="study-card"><h2>اكتملت مشاركتك 🌿</h2><p>شكرًا جزيلًا على وقتك ومساهمتك في هذه الدراسة.</p></div>;
    case "withdrawn":
      return <div className="study-card"><h2>انسحبت من الدراسة</h2><p>سُجّل انسحابك. إن أردت حذف بياناتك، تواصل مع الباحث برمزك.</p></div>;
    default:
      return missing(participant.status);
  }
}

function Footer({ participant, onWithdrawn, onSwitch }: { participant: Participant; onWithdrawn: () => Promise<void>; onSwitch: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const canWithdraw = participant.status !== "withdrawn" && participant.status !== "followup_done";
  const withdraw = async () => {
    try {
      const result = await withdrawFromStudy();
      if (!result.ok) { setError(studyErrorMessage(result.error)); return; }
      setConfirming(false);
      await onWithdrawn();
    } catch (e) { setError(studyErrorMessage(e instanceof Error ? e.message : undefined)); }
  };
  return (
    <footer className="study-footer">
      <span>رمزك: <strong dir="ltr">{participant.code}</strong>{participant.is_test ? " · تجريبي" : ""}</span>
      {!confirming && <button type="button" className="study-link study-switch" onClick={onSwitch}>الدخول برمز آخر</button>}
      {canWithdraw && !confirming && <button type="button" className="study-link" onClick={() => setConfirming(true)}>الانسحاب من الدراسة</button>}
      {confirming && (
        <span className="study-confirm">
          هل تريد الانسحاب؟ لن تستطيع العودة بهذا الرمز.
          <button type="button" className="study-danger" onClick={() => void withdraw()}>نعم، أنسحب</button>
          <button type="button" className="study-secondary" onClick={() => setConfirming(false)}>تراجع</button>
        </span>
      )}
      {error && <span className="study-error">{error}</span>}
    </footer>
  );
}
