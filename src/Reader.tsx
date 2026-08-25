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
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileKey, setFileKey] = useState("");
  const [viewMode, setViewMode] = useState<"native" | "enhanced">("native");
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.15);
  const [tone, setTone] = useState<"paper" | "night">("paper");
  const [sound, setSound] = useState(false);
  const [turning, setTurning] = useState<"next" | "prev" | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!document || !canvasRef.current || viewMode !== "enhanced") return;
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
  }, [document, page, scale, fileKey, rtl, viewMode]);

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!document || viewMode !== "enhanced") return;
      if (event.key === "ArrowRight") turn(rtl ? -1 : 1);
      if (event.key === "ArrowLeft") turn(rtl ? 1 : -1);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [document, rtl, viewMode, page]);

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const localUrl = URL.createObjectURL(selected);
    const key = `spl-local-reader:${selected.name}:${selected.size}`;
    const saved = Number(localStorage.getItem(key) || "1");
    setLoading(true); setError(""); setDocument(null);
    setFileUrl(localUrl); setFileName(selected.name); setFileKey(key);
    setViewMode("native"); setPage(Math.max(saved, 1));
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const bytes = await selected.arrayBuffer();
      const loaded = await pdfjs.getDocument({ data: bytes }).promise as unknown as PdfDocument;
      setDocument(loaded);
      setPage(Math.min(Math.max(saved, 1), loaded.numPages));
    } catch {
      setError(rtl ? "العرض المطابق للأصل متاح، لكن وضع التقليب التجريبي لم يتمكن من تحليل هذا الملف." : "Original-fidelity view is available, but experimental page-turn mode could not parse this file.");
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

  const close = () => { if (fileUrl) URL.revokeObjectURL(fileUrl); setFileUrl(""); setDocument(null); setFileName(""); setFileKey(""); setPage(1); setError(""); };

  return <div className="page source-reader-page">
    <header className="page-title"><div><span>{rtl ? "إصلاح توافق العربية — V0.3.1" : "Arabic compatibility fix — V0.3.1"}</span><h2>{rtl ? "قارئ الأصل الذكي" : "Smart Source Reader"}</h2><p>{rtl ? "العرض المطابق للأصل هو الوضع الافتراضي لحماية الخطوط العربية وتنسيق الكتاب." : "Original-fidelity view is now the default to preserve Arabic fonts and book layout."}</p></div>{fileUrl && <button className="secondary" onClick={close}>{rtl ? "إغلاق الكتاب" : "Close book"}</button>}</header>

    {!fileUrl ? <section className="reader-empty panel">
      <div className="reader-emblem">◫</div>
      <span className="eyebrow">{rtl ? "قراءة خاصة على جهازك" : "Private on-device reading"}</span>
      <h3>{rtl ? "اختر كتاب PDF لعرضه كما هو" : "Choose a PDF to view as originally authored"}</h3>
      <p>{rtl ? "يفتح المتصفح الملف في ذاكرة جهازك فقط. لا رفع، لا تخزين سحابي، ولا مشاركة." : "Your browser opens the file in device memory only. No upload, cloud storage, or sharing."}</p>
      <label className="reader-file"><input type="file" accept="application/pdf,.pdf" onChange={openFile}/><b>{loading ? (rtl ? "جارٍ فتح الكتاب…" : "Opening book…") : (rtl ? "اختر PDF من جهازك" : "Choose PDF from device")}</b><span>{rtl ? "الملف يبقى لديك" : "The file remains yours"}</span></label>
      {error && <div className="reader-error">{error}</div>}
      <div className="reader-safety"><b>✓ {rtl ? "الأولوية: سلامة النص العربي" : "Priority: Arabic text fidelity"}</b><span>{rtl ? "عرض مطابق للأصل افتراضيًا • تقليب الصفحات وضع تجريبي اختياري" : "Original-fidelity view by default • optional experimental page turning"}</span></div>
    </section> : <section className={`reader-shell ${tone}`}>
      <header className="reader-toolbar">
        <div className="reader-file-name"><i>▤</i><div><strong>{fileName}</strong><span>{rtl ? "ملف محلي — لم يُرفع" : "Local file — not uploaded"}</span></div></div>
        <div className="reader-modes" role="group" aria-label={rtl ? "طريقة العرض" : "View mode"}>
          <button className={viewMode === "native" ? "active" : ""} onClick={() => setViewMode("native")}>✓ {rtl ? "مطابق للأصل" : "Original"}</button>
          <button className={viewMode === "enhanced" ? "active" : ""} disabled={!document} onClick={() => setViewMode("enhanced")}>{rtl ? "تقليب تجريبي" : "Page turn beta"}</button>
        </div>
        <div className="reader-tools">
          {viewMode === "enhanced" && <><button onClick={() => setScale(Math.max(.65, scale - .15))} title={rtl ? "تصغير" : "Zoom out"}>−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(Math.min(2.1, scale + .15))} title={rtl ? "تكبير" : "Zoom in"}>＋</button>
          <button onClick={() => setTone(tone === "paper" ? "night" : "paper")} title={rtl ? "لون القراءة" : "Reading tone"}>{tone === "paper" ? "◐" : "☀"}</button>
          <button className={sound ? "selected" : ""} onClick={() => setSound(!sound)} title={rtl ? "صوت التقليب" : "Page sound"}>♪</button></>}
          <button onClick={() => stageRef.current?.requestFullscreen()} title={rtl ? "ملء الشاشة" : "Full screen"}>⛶</button>
        </div>
      </header>
      {viewMode === "native" ? <div className="native-reader-stage" ref={stageRef}>
        <div className="fidelity-note">✓ {rtl ? "هذا العرض يستخدم محرك المتصفح الأصلي للمحافظة على الخطوط العربية والتشكيل وترتيب الحروف." : "This view uses the browser’s native PDF engine to preserve fonts, shaping, and layout."}</div>
        <iframe title={fileName} src={`${fileUrl}#view=FitH&toolbar=1&navpanes=0`} />
      </div> : document ? <><div className="reader-stage" ref={stageRef}>
        <button className="page-arrow previous" onClick={() => turn(-1)} disabled={page === 1} aria-label={rtl ? "الصفحة السابقة" : "Previous page"}>‹</button>
        <div className={`paper-page ${turning}`}><canvas ref={canvasRef}/><span className="page-number">{page}</span></div>
        <button className="page-arrow next" onClick={() => turn(1)} disabled={page === document.numPages} aria-label={rtl ? "الصفحة التالية" : "Next page"}>›</button>
      </div>
      <footer className="reader-footer"><button onClick={() => turn(-1)} disabled={page === 1}>{rtl ? "السابق" : "Previous"}</button><div><input type="range" min="1" max={document.numPages} value={page} onChange={e => setPage(Number(e.target.value))}/><span>{rtl ? `الصفحة ${page} من ${document.numPages}` : `Page ${page} of ${document.numPages}`}</span></div><button onClick={() => turn(1)} disabled={page === document.numPages}>{rtl ? "التالي" : "Next"}</button></footer></> : null}
      {error && <div className="reader-error inline">{error}</div>}
      <div className="local-proof">◆ {rtl ? "يُحفظ رقم الصفحة فقط في هذا الجهاز؛ ملف الكتاب غير محفوظ في المنصة." : "Only the page number is stored on this device; the book file is not stored by the platform."}</div>
    </section>}

    <section className="milestone-board panel"><div><span>{rtl ? "يعمل الآن" : "Working now"}</span><strong>{rtl ? "توافق PDF العربي V0.3.1" : "Arabic PDF compatibility V0.3.1"}</strong><p>{rtl ? "العرض المطابق للأصل أصبح الوضع الأساسي." : "Original-fidelity rendering is now the primary mode."}</p></div><div><span>{rtl ? "قيد الاختبار" : "Under test"}</span><strong>{rtl ? "ملفك العربي نفسه" : "Your Arabic PDF"}</strong><p>{rtl ? "لا ننتقل قبل التأكد من ظهوره صحيحًا." : "We will not move on until it renders correctly."}</p></div><div><span>{rtl ? "لاحقًا" : "Later"}</span><strong>{rtl ? "التحليل الحقيقي والصوت" : "Real analysis and audio"}</strong><p>{rtl ? "موقوف حتى اجتياز اختبار سلامة العرض." : "Paused until display fidelity passes."}</p></div></section>
  </div>;
}
