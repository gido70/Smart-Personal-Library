import { useEffect, useMemo, useRef, useState } from "react";
import type { Answers, AnswerValue, Instrument, Item, Section } from "./types";
import { NA, OTHER, cleanAnswers, isVisible, resolveOptions, validateSection } from "./formLogic";

const COUNTRIES = ["الإمارات", "السعودية", "مصر", "السودان", "الأردن", "الكويت", "قطر", "البحرين", "عُمان", "اليمن", "العراق", "سوريا", "لبنان", "فلسطين", "ليبيا", "تونس", "الجزائر", "المغرب", "موريتانيا", "الصومال", "جيبوتي", "جزر القمر", "تركيا", "دولة أخرى"];

type Draft = { answers: Answers; page: number; startedAt: string; timing: Record<string, number> };

function loadDraft(storageKey: string): Draft | null {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export default function Questionnaire({ instrument, draftKey, onSubmit }: {
  instrument: Instrument;
  draftKey: string;
  onSubmit: (answers: Answers, startedAt: string) => Promise<void>;
}) {
  const sections = instrument.sections;
  const initial = useMemo(() => loadDraft(draftKey), [draftKey]);
  const [answers, setAnswers] = useState<Answers>(initial?.answers ?? {});
  const [page, setPage] = useState(Math.min(initial?.page ?? 0, sections.length - 1));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const startedAt = useRef(initial?.startedAt ?? new Date().toISOString());
  const timing = useRef<Record<string, number>>(initial?.timing ?? {});
  const pageShownAt = useRef(Date.now());
  const topRef = useRef<HTMLDivElement>(null);
  const section = sections[page];
  const isLast = page === sections.length - 1;

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ answers, page, startedAt: startedAt.current, timing: timing.current } satisfies Draft));
    } catch { /* storage may be unavailable; answers stay in memory */ }
  }, [answers, page, draftKey]);

  useEffect(() => {
    pageShownAt.current = Date.now();
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [page]);

  const set = (code: string, value: AnswerValue) => {
    setAnswers(prev => ({ ...prev, [code]: value }));
    setErrors(prev => {
      if (!prev[code]) return prev;
      const next = { ...prev };
      delete next[code];
      return next;
    });
  };

  const recordTiming = () => {
    if (section.timed) timing.current[section.id] = (timing.current[section.id] ?? 0) + (Date.now() - pageShownAt.current);
  };

  const next = async () => {
    const found = validateSection(section, answers);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`q-${Object.keys(found)[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    recordTiming();
    if (!isLast) {
      setPage(page + 1);
      return;
    }
    setBusy(true);
    setSubmitError("");
    try {
      const payload: Answers = { ...cleanAnswers(sections, answers), _meta: JSON.stringify({ version: instrument.version, timing_ms: timing.current }) };
      await onSubmit(payload, startedAt.current);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="study-card" ref={topRef}>
      <div className="study-progress" aria-label={`القسم ${page + 1} من ${sections.length}`}>
        <div style={{ width: `${((page + 1) / sections.length) * 100}%` }} />
      </div>
      <p className="study-muted">{instrument.title} · القسم {page + 1} من {sections.length}{instrument.minutes ? ` · نحو ${instrument.minutes} دقائق` : ""}</p>
      {page === 0 && instrument.instructions && <div className="study-note">{instrument.instructions}</div>}
      <h2>{section.title}</h2>
      {section.pending ? (
        <div className="study-note">هذا القسم قيد الإعداد ولن يُطرح عليك الآن. اضغط «التالي» للمتابعة.</div>
      ) : (
        (section.items ?? []).filter(item => isVisible(item, answers)).map(item => (
          <Question key={item.code} item={item} section={section} answers={answers} error={errors[item.code]} onChange={set} />
        ))
      )}
      {submitError && <div className="study-error" role="alert">{submitError}</div>}
      <div className="study-actions">
        {page > 0 && <button type="button" className="study-secondary" disabled={busy} onClick={() => { recordTiming(); setPage(page - 1); }}>السابق</button>}
        <button type="button" className="study-primary" disabled={busy} onClick={() => void next()}>{busy ? "جارٍ الإرسال…" : isLast ? "إرسال الإجابات" : "التالي"}</button>
      </div>
      {isLast && <p className="study-muted">بعد الإرسال لا يمكن تعديل الإجابات.</p>}
      <p className="study-muted study-small">تُحفظ إجاباتك على هذا الجهاز تلقائيًا حتى الإرسال.</p>
    </div>
  );
}

function Question({ item, section, answers, error, onChange }: {
  item: Item; section: Section; answers: Answers; error?: string; onChange: (code: string, value: AnswerValue) => void;
}) {
  const value = answers[item.code];
  const label = item.text ?? item.text_en ?? item.code;
  const options = resolveOptions(item, section, answers);
  const showOther = item.other && (Array.isArray(value) ? value.includes(OTHER) : value === OTHER);
  const name = `q-${item.code}`;
  return (
    <fieldset className={`study-q${error ? " has-error" : ""}`} id={name}>
      <legend>{label}{!item.required && <span className="study-optional"> (اختياري)</span>}</legend>
      {item.type === "single" && (
        <div className="study-options">
          {options.map(option => (
            <label key={option} className={value === option ? "selected" : ""}>
              <input type="radio" name={name} checked={value === option} onChange={() => onChange(item.code, option)} />
              <span>{option}</span>
            </label>
          ))}
        </div>
      )}
      {item.type === "multi" && (
        <div className="study-options">
          {options.map(option => {
            const list = Array.isArray(value) ? value : [];
            const checked = list.includes(option);
            return (
              <label key={option} className={checked ? "selected" : ""}>
                <input type="checkbox" checked={checked} onChange={() => onChange(item.code, checked ? list.filter(v => v !== option) : [...list, option])} />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      )}
      {item.type === "likert" && item.scale && (
        <div className="study-likert" role="radiogroup">
          <div className="study-likert-row" style={{ gridTemplateColumns: `repeat(${item.scale.max - item.scale.min + 1}, minmax(0, 1fr))` }}>
            {Array.from({ length: item.scale.max - item.scale.min + 1 }, (_, i) => item.scale!.min + i).map((n, i) => {
              const caption = item.scale!.labels[i] ?? "";
              return (
                <label key={n} className={value === n ? "selected" : ""} title={caption || String(n)}>
                  <input type="radio" name={name} checked={value === n} onChange={() => onChange(item.code, n)} />
                  <span className="study-likert-num">{n}</span>
                  {caption && <span className="study-likert-cap">{caption}</span>}
                </label>
              );
            })}
          </div>
          {item.na && (
            <label className={`study-na${value === NA ? " selected" : ""}`}>
              <input type="radio" name={name} checked={value === NA} onChange={() => onChange(item.code, NA)} />
              <span>{item.na}</span>
            </label>
          )}
        </div>
      )}
      {item.type === "text" && (
        <textarea rows={3} value={typeof value === "string" ? value : ""} onChange={event => onChange(item.code, event.target.value)} />
      )}
      {item.type === "number" && (
        <input type="number" inputMode="numeric" min={item.min} max={item.max} value={value === null || value === undefined ? "" : String(value)}
          onChange={event => onChange(item.code, event.target.value === "" ? null : Number(event.target.value))} />
      )}
      {item.type === "country" && (
        <select value={typeof value === "string" ? value : ""} onChange={event => onChange(item.code, event.target.value)}>
          <option value="">اختر…</option>
          {COUNTRIES.map(country => <option key={country} value={country}>{country}</option>)}
        </select>
      )}
      {item.type === "rank" && (
        <div className="study-rank">
          {Array.from({ length: Math.min(item.pick ?? 3, options.length) }, (_, i) => {
            const list = Array.isArray(value) ? [...value] : [];
            return (
              <label key={i}>
                <span>{["الأول", "الثاني", "الثالث", "الرابع", "الخامس"][i]}</span>
                <select value={list[i] ?? ""} onChange={event => { list[i] = event.target.value; onChange(item.code, list); }}>
                  <option value="">اختر…</option>
                  {options.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}
      {showOther && (
        <input type="text" className="study-other" placeholder="حدّد" value={typeof answers[`${item.code}_OTHER`] === "string" ? (answers[`${item.code}_OTHER`] as string) : ""}
          onChange={event => onChange(`${item.code}_OTHER`, event.target.value)} />
      )}
      {error && <p className="study-field-error" role="alert">{error}</p>}
    </fieldset>
  );
}
