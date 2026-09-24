import { useEffect, useRef, useState } from "react";
import "./continuous-audio.css";

/** Uses one player for the saved parts; never generates or purchases audio. */
export default function ContinuousAudio({ urls, rtl }: { urls: string[]; rtl: boolean }) {
  const player = useRef<HTMLAudioElement>(null);
  const part = useRef(0);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
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
  return <section className="continuous-audio" aria-label={rtl ? "استماع متواصل" : "Continuous listening"}>
    <strong>{rtl ? "🚗 استماع متواصل" : "🚗 Continuous listening"}</strong>
    <p>{rtl ? "تشغيل الأجزاء المحفوظة بالترتيب تلقائيًا. ابدأ قبل القيادة." : "Play saved parts automatically in order. Start before driving."}</p>
    <button className="primary" onClick={() => {
      const audio = player.current;
      if (!audio) return;
      if (!audio.paused) { audio.pause(); return; }
      if (audio.ended && part.current === urls.length - 1) {
        part.current = 0; setIndex(0); audio.src = urls[0];
      }
      void play();
    }}>{playing ? (rtl ? "⏸ إيقاف مؤقت" : "⏸ Pause") : (rtl ? "▶ تشغيل متواصل" : "▶ Play continuously")}</button>
    <span aria-live="polite">{rtl ? `الجزء ${index + 1} من ${urls.length}` : `Part ${index + 1} of ${urls.length}`}</span>
    <audio ref={player} controls preload="metadata" onEnded={next}
      onPlay={(event) => {
        document.querySelectorAll("audio").forEach((other) => { if (other !== event.currentTarget) other.pause(); });
        setPlaying(true); setError("");
      }} onPause={() => setPlaying(false)}
      onError={() => { setPlaying(false); setError(rtl ? "تعذّر تحميل هذا الجزء. أعد فتح الكتاب لتحديث روابط التسجيلات المحفوظة." : "This part could not load. Reopen the book to refresh saved audio links."); }} />
    {error && <p role="alert">{error}</p>}
  </section>;
}
