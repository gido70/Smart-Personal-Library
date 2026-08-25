import { ChangeEvent, useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type PdfViewport = { width: number; height: number };
type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; canvas: HTMLCanvasElement }) => { promise: Promise<void> };
};
type PdfDocument = { numPages: number; getPage: (page: number) => Promise<PdfPage> };

export default function Reader({ rtl }: { rtl: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PdfDocument | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileKey, setFileKey] = useState("");
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.15);
  const [tone, setTone] = useState<"paper" | "night">("paper");
  const [sound, setSound] = useState(false);
  const [turning, setTurning] = useState<"next" | "prev" | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let cancelled = false;
    const render = async () => {
      const pdfPage = await document.getPage(page);
      if (cancelled || !canvasRef.current) return;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
      if (fileKey) localStorage.setItem(fileKey, String(page));
    };
    render().catch(() => setError(rtl ? "تعذر عرض هذه الصفحة." : "This page could not be rendered."));
    return () => { cancelled = true; };
  }, [document, page, scale, fileKey, rtl]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!document) return;
      if (event.key === "ArrowRight") turn(rtl ? -1 : 1);
      if (event.key === "ArrowLeft") turn(rtl ? 1 : -1);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setLoading(true); setError(""); setDocument(null);
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const bytes = await selected.arrayBuffer();
      const loaded = await pdfjs.getDocument({ data: bytes }).promise as unknown as PdfDocument;
      const key = `spl-local-reader:${selected.name}:${selected.size}`;
      const saved = Number(localStorage.getItem(key) || "1");
      setFileName(selected.name);
      setFileKey(key);
      setDocument(loaded);
      setPage(Math.min(Math.max(saved, 1), loaded.numPages));
    } catch {
      setError(rtl ? "لم نتمكن من فتح الملف. تأكد أنه PDF صالح وغير مقفل بكلمة مرور." : "The file could not be opened. Make sure it is a valid, unlocked PDF.");
    } finally { setLoading(false); }
  };

  const pageSound = () => {
    if (!sound) return;
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const audio = new AudioCtor();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "triangle"; oscillator.frequency.setValueAtTime(185, audio.currentTime);
    gain.gain.setValueAtTime(.025, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .09);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .09);
  };

  const turn = (delta: number) => {
    if (!document) return;
    const target = Math.min(Math.max(page + delta, 1), document.numPages);
    if (target === page) return;
    setTurning(delta > 0 ? "next" : "prev");
    pageSound();
    window.setTimeout(() => { setPage(target); setTurning(""); }, 170);
  };

  const close = () => { setDocument(null); setFileName(""); setFileKey(""); setPage(1); setError(""); };

  return <div className="page source-reader-page">
    <header className="page-title"><div><span>{rtl ? "المرحلة الحالية — V0.3" : "Current milestone — V0.3"}</span><h2>{rtl ? "قارئ الأصل الذكي" : "Smart Source Reader"}</h2><p>{rtl ? "افتح كتابك من جهازك واقرأه محليًا؛ لا يخرج الملف من هاتفك أو حاسوبك." : "Open a book from your device and read it locally; the file never leaves your phone or computer."}</p></div>{document && <button className="secondary" onClick={close}>{rtl ? "إغلاق الكتاب" : "Close book"}</button>}</header>

    {!document ? <section className="reader-empty panel">
      <div className="reader-emblem">◫</div>
      <span className="eyebrow">{rtl ? "قراءة خاصة على جهازك" : "Private on-device reading"}</span>
      <h3>{rtl ? "اختر كتاب PDF لتجربة التقليب" : "Choose a PDF to try page turning"}</h3>
      <p>{rtl ? "يفتح المتصفح الملف في ذاكرة جهازك فقط. لا رفع، لا تخزين سحابي، ولا مشاركة." : "Your browser opens the file in device memory only. No upload, cloud storage, or sharing."}</p>
      <label className="reader-file"><input type="file" accept="application/pdf,.pdf" onChange={openFile}/><b>{loading ? (rtl ? "جارٍ فتح الكتاب…" : "Opening book…") : (rtl ? "اختر PDF من جهازك" : "Choose PDF from device")}</b><span>{rtl ? "الملف يبقى لديك" : "The file remains yours"}</span></label>
      {error && <div className="reader-error">{error}</div>}
      <div className="reader-safety"><b>✓ {rtl ? "اختبار هذه المرحلة" : "This milestone tests"}</b><span>{rtl ? "فتح محلي • تقليب الصفحات • التكبير • الوضع الليلي • حفظ آخر صفحة" : "Local open • page turning • zoom • night mode • last-page memory"}</span></div>
    </section> : <section className={`reader-shell ${tone}`}>
      <header className="reader-toolbar">
        <div className="reader-file-name"><i>▤</i><div><strong>{fileName}</strong><span>{rtl ? "ملف محلي — لم يُرفع" : "Local file — not uploaded"}</span></div></div>
        <div className="reader-tools">
          <button onClick={() => setScale(Math.max(.65, scale - .15))} title={rtl ? "تصغير" : "Zoom out"}>−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(Math.min(2.1, scale + .15))} title={rtl ? "تكبير" : "Zoom in"}>＋</button>
          <button onClick={() => setTone(tone === "paper" ? "night" : "paper")} title={rtl ? "لون القراءة" : "Reading tone"}>{tone === "paper" ? "◐" : "☀"}</button>
          <button className={sound ? "selected" : ""} onClick={() => setSound(!sound)} title={rtl ? "صوت التقليب" : "Page sound"}>♪</button>
          <button onClick={() => stageRef.current?.requestFullscreen()} title={rtl ? "ملء الشاشة" : "Full screen"}>⛶</button>
        </div>
      </header>
      <div className="reader-stage" ref={stageRef}>
        <button className="page-arrow previous" onClick={() => turn(-1)} disabled={page === 1} aria-label={rtl ? "الصفحة السابقة" : "Previous page"}>‹</button>
        <div className={`paper-page ${turning}`}><canvas ref={canvasRef}/><span className="page-number">{page}</span></div>
        <button className="page-arrow next" onClick={() => turn(1)} disabled={page === document.numPages} aria-label={rtl ? "الصفحة التالية" : "Next page"}>›</button>
      </div>
      <footer className="reader-footer"><button onClick={() => turn(-1)} disabled={page === 1}>{rtl ? "السابق" : "Previous"}</button><div><input type="range" min="1" max={document.numPages} value={page} onChange={e => setPage(Number(e.target.value))}/><span>{rtl ? `الصفحة ${page} من ${document.numPages}` : `Page ${page} of ${document.numPages}`}</span></div><button onClick={() => turn(1)} disabled={page === document.numPages}>{rtl ? "التالي" : "Next"}</button></footer>
      <div className="local-proof">◆ {rtl ? "يُحفظ رقم الصفحة فقط في هذا الجهاز؛ ملف الكتاب غير محفوظ في المنصة." : "Only the page number is stored on this device; the book file is not stored by the platform."}</div>
    </section>}

    <section className="milestone-board panel"><div><span>{rtl ? "يعمل الآن" : "Working now"}</span><strong>{rtl ? "قارئ PDF محلي V0.3" : "Local PDF reader V0.3"}</strong><p>{rtl ? "هذه هي الجزئية المطلوب فحصها في هذه الجولة." : "This is the only capability under test in this round."}</p></div><div><span>{rtl ? "الجولة التالية" : "Next round"}</span><strong>{rtl ? "التنبيهات والمتابعة" : "Reminders and follow-up"}</strong><p>{rtl ? "لا ننتقل إليها إلا بعد تسجيل نتيجة اختبار القارئ." : "We move to it only after recording the reader test result."}</p></div><div><span>{rtl ? "لاحقًا" : "Later"}</span><strong>{rtl ? "التحليل الحقيقي والصوت" : "Real analysis and audio"}</strong><p>{rtl ? "ما يزال نموذجًا بصريًا ولم يدخل اختبار التنفيذ بعد." : "Still a visual concept; not yet in implementation testing."}</p></div></section>
  </div>;
}
