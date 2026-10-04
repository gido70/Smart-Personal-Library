import { useEffect, useRef, useState } from "react";
import "./continuous-audio.css";
// Study usage events are emitted as a DOM event and recorded by lib/studyLog (participants only),
// so this component stays free of data dependencies.
const logStudy = (type: string, payload: Record<string, unknown>) => { try { window.dispatchEvent(new CustomEvent("spl-study-event", { detail: { type, payload } })); } catch { /* no window in tests */ } };

/** Uses one player for the saved parts; never generates or purchases audio. */
export default function ContinuousAudio({ urls, rtl }: { urls: string[]; rtl: boolean }) {
  const player = useRef<HTMLAudioElement>(null);
  const part = useRef(0);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const listened = useRef(0);
  const lastTick = useRef<number | null>(null);
  const signature = JSON.stringify(urls);
  useEffect(() => {
    const audio = player.current;
    if (!audio) return;
    audio.pause();
    part.current = 0;
    setIndex(0);
    setPlaying(false);
    setError("");
    audio.src = JSON.parse(signature)[0] ?? "";
    return () => { audio.pause(); };
  }, [signature]);

  const play = async () => {
    const audio = player.current;
    if (!audio) return;
    setError("");
    try { await audio.play(); }
    catch { setPlaying(false); setError(rtl ? "تعذّر بدء التشغيل. اضغط تشغيل للمتابعة من الجزء الحالي." : "Playback could not start. Press play to resume this part."); }
  };
  const next = () => {
    const audio = player.current;
    if (!audio || part.current + 1 >= urls.length) { setPlaying(false); return; }
    part.current += 1;
    setIndex(part.current);
    audio.src = urls[part.current];
    void play();
  };
  const toggle = () => {
    const audio = player.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    if (audio.ended && part.current === urls.length - 1) { part.current = 0; setIndex(0); audio.src = urls[0]; }
    void play();
  };
  return <section className="continuous-audio" aria-label={rtl ? "استماع متواصل" : "Continuous listening"}>
    {playing && <div className="ca-mini" role="region" aria-label={rtl ? "مشغل مصغّر" : "Mini player"}>
      <button type="button" onClick={toggle} aria-label={rtl ? "إيقاف مؤقت" : "Pause"}>⏸</button>
      <span>{rtl ? `استماع متواصل · الجزء ${index + 1} من ${urls.length}` : `Listening · part ${index + 1} of ${urls.length}`}</span>
      <button type="button" onClick={() => player.current?.scrollIntoView({ behavior: "smooth", block: "center" })} aria-label={rtl ? "اذهب إلى المشغل" : "Go to player"}>↑</button>
    </div>}
    <strong>{rtl ? "🚗 استماع متواصل" : "🚗 Continuous listening"}</strong>
    <p>{rtl ? "تشغيل الأجزاء المحفوظة بالترتيب تلقائيًا. ابدأ قبل القيادة." : "Play saved parts automatically in order. Start before driving."}</p>
    <button className="primary" onClick={toggle}>{playing ? (rtl ? "⏸ إيقاف مؤقت" : "⏸ Pause") : (rtl ? "▶ تشغيل متواصل" : "▶ Play continuously")}</button>
    <span aria-live="polite">{rtl ? `الجزء ${index + 1} من ${urls.length}` : `Part ${index + 1} of ${urls.length}`}</span>
    <audio ref={player} controls preload="metadata" onEnded={next}
      onPlay={(event) => {
        document.querySelectorAll("audio").forEach((other) => { if (other !== event.currentTarget) other.pause(); });
        setPlaying(true); setError("");
        lastTick.current = Date.now();
        logStudy("audio_play", { part: part.current + 1, of: urls.length });
      }} onPause={() => { setPlaying(false); if (lastTick.current) { listened.current += (Date.now() - lastTick.current) / 1000; lastTick.current = null; } if (listened.current >= 5) { logStudy("audio_progress", { seconds: Math.round(listened.current) }); listened.current = 0; } }}
      onTimeUpdate={() => { if (lastTick.current && Date.now() - lastTick.current > 60000) { listened.current += (Date.now() - lastTick.current) / 1000; lastTick.current = Date.now(); logStudy("audio_progress", { seconds: Math.round(listened.current) }); listened.current = 0; } }}
      onError={() => { setPlaying(false); setError(rtl ? "تعذّر تحميل هذا الجزء. أعد فتح الكتاب لتحديث روابط التسجيلات المحفوظة." : "This part could not load. Reopen the book to refresh saved audio links."); }} />
    {error && <p role="alert">{error}</p>}
  </section>;
}
