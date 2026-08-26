import { ChangeEvent, useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type PdfViewport = { width: number; height: number };
type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; canvas: HTMLCanvasElement }) => { promise: Promise<void> };
};
type PdfDocument = { numPages: number; getPage: (page: number) => Promise<PdfPage> };
type Theme = "linen" | "paper" | "library" | "night";
type Direction = "auto" | "rtl" | "ltr";
type Speed = "slow" | "normal" | "fast";
type Compatibility = "untested" | "passed" | "failed";

const speedMs: Record<Speed, number> = { slow: 920, normal: 650, fast: 390 };

export default function Reader({ rtl }: { rtl: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [document, setDocument] = useState<PdfDocument | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileKey, setFileKey] = useState("");
  const [viewMode, setViewMode] = useState<"native" | "book">("native");
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.15);
  const [theme, setTheme] = useState<Theme>("linen");
  const [direction, setDirection] = useState<Direction>("auto");
  const [speed, setSpeed] = useState<Speed>("normal");
  const [sound, setSound] = useState(true);
  const [turning, setTurning] = useState<"out-next" | "out-prev" | "in-next" | "in-prev" | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [compatibility, setCompatibility] = useState<Compatibility>("untested");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [ambientUrl, setAmbientUrl] = useState("");
  const [ambientName, setAmbientName] = useState("");
  const [ambientOn, setAmbientOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechLanguage, setSpeechLanguage] = useState<"auto" | "ar-SA" | "en-US">("auto");
  const [speechRate, setSpeechRate] = useState(1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const effectiveRtl = direction === "auto" ? rtl : direction === "rtl";

  useEffect(() => {
    if (!document || !canvasRef.current || viewMode !== "book") return;
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
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = "auto";
      await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
      if (fileKey) localStorage.setItem(`${fileKey}:page`, String(page));
    };
    render().catch(() => setError(rtl ? "تعذر رسم هذه الصفحة؛ استخدم العرض المطابق للأصل." : "This page could not be rendered; use Original view."));
    return () => { cancelled = true; };
  }, [document, page, scale, fileKey, rtl, viewMode]);

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
  useEffect(() => () => { if (ambientUrl) URL.revokeObjectURL(ambientUrl); }, [ambientUrl]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  useEffect(() => { window.speechSynthesis?.cancel(); setSpeaking(false); }, [page]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    const retry = window.setTimeout(loadVoices, 500);
    return () => { window.clearTimeout(retry); window.speechSynthesis.removeEventListener("voiceschanged", loadVoices); };
  }, []);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!document || viewMode !== "book" || compatibility !== "passed") return;
      if (event.key === "ArrowRight") turn(effectiveRtl ? -1 : 1);
      if (event.key === "ArrowLeft") turn(effectiveRtl ? 1 : -1);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [document, effectiveRtl, viewMode, page, compatibility, turning, speed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (ambientOn && ambientUrl) audio.play().catch(() => setAmbientOn(false));
    else audio.pause();
  }, [ambientOn, ambientUrl]);

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const localUrl = URL.createObjectURL(selected);
    const key = `spl-reader:${selected.name}:${selected.size}`;
    const saved = Number(localStorage.getItem(`${key}:page`) || "1");
    const savedMarks = JSON.parse(localStorage.getItem(`${key}:marks`) || "[]") as number[];
    setLoading(true); setError(""); setDocument(null); setCompatibility("untested");
    setFileUrl(localUrl); setFileName(selected.name); setFileKey(key); setBookmarks(savedMarks);
    setViewMode("native"); setPage(Math.max(saved, 1));
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const bytes = new Uint8Array(await selected.arrayBuffer());
      const loaded = await pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false }).promise as unknown as PdfDocument;
      setDocument(loaded);
      setPage(Math.min(Math.max(saved, 1), loaded.numPages));
    } catch {
      setError(rtl ? "العرض المطابق للأصل متاح، لكن محرك الكتاب لم يتمكن من تحليل هذا الملف." : "Original view is available, but Book mode could not parse this file.");
    } finally { setLoading(false); }
  };

  const pageSound = () => {
    if (!sound) return;
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const audio = new AudioCtor();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(130, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(310, audio.currentTime + .12);
    gain.gain.setValueAtTime(.028, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .16);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .16);
  };

  const turn = (delta: number) => {
    if (!document || turning || compatibility !== "passed") return;
    const target = Math.min(Math.max(page + delta, 1), document.numPages);
    if (target === page) return;
    const kind = delta > 0 ? "next" : "prev";
    const duration = speedMs[speed];
    setTurning(`out-${kind}`);
    pageSound();
    window.setTimeout(() => { setPage(target); setTurning(`in-${kind}`); }, duration * .48);
    window.setTimeout(() => setTurning(""), duration);
  };

  const chooseBookMode = () => {
    if (!document) return;
    if (compatibility === "failed") {
      setError(rtl ? "هذا الملف لم يجتز اختبار سلامة العربية؛ استمر بالعرض المطابق للأصل." : "This file did not pass the fidelity check; continue in Original view.");
      return;
    }
    setError(""); setViewMode("book");
  };

  const approveCompatibility = () => { setCompatibility("passed"); setError(""); };
  const rejectCompatibility = () => {
    setCompatibility("failed"); setViewMode("native");
    setError(rtl ? "تم إيقاف محرك الكتاب لهذا الملف حتى لا نعتمد نصًا عربيًا مشوهًا." : "Book mode was disabled for this file to avoid distorted text.");
  };

  const toggleBookmark = () => {
    const next = bookmarks.includes(page) ? bookmarks.filter(item => item !== page) : [...bookmarks, page].sort((a, b) => a - b);
    setBookmarks(next);
    if (fileKey) localStorage.setItem(`${fileKey}:marks`, JSON.stringify(next));
  };

  const chooseAmbient = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (ambientUrl) URL.revokeObjectURL(ambientUrl);
    setAmbientUrl(URL.createObjectURL(selected)); setAmbientName(selected.name); setAmbientOn(true);
  };

  const speakPage = async () => {
    if (!document || !("speechSynthesis" in window)) {
      setError(rtl ? "هذا المتصفح لا يدعم صوت الجهاز." : "This browser does not support device speech.");
      return;
    }
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    if (viewMode !== "book") {
      setError(rtl ? "للقراءة المتزامنة انتقل إلى «وضع الكتاب»؛ عارض المتصفح الأصلي لا يشارك رقم الصفحة المفتوحة مع التطبيق." : "For synchronized speech, switch to Book mode. The browser's native PDF viewer does not expose its current page to the app.");
      return;
    }
    try {
      const pdfPage = await document.getPage(page);
      const content = await pdfPage.getTextContent();
      const pageText = content.items.map(item => item.str ?? "").join(" ").replace(/\s+/g, " ").trim();
      const readableLetters = pageText.match(/[\p{L}]/gu) ?? [];
      if (readableLetters.length < 10) {
        setError(rtl ? "هذه الصفحة فارغة أو لا تحتوي نصًا كافيًا للقراءة. انتقل إلى صفحة فيها محتوى؛ وإذا كانت الصفحة مصوّرة فستحتاج OCR." : "This page is blank or has too little readable text. Move to a content page; scanned pages require OCR.");
        return;
      }
      setError("");
      const utterance = new SpeechSynthesisUtterance(pageText);
      const arabicLetters = (pageText.match(/[\u0600-\u06ff]/g) ?? []).length;
      const latinLetters = (pageText.match(/[A-Za-z]/g) ?? []).length;
      const detectedLanguage: "ar-SA" | "en-US" = arabicLetters >= latinLetters ? "ar-SA" : "en-US";
      const requestedLanguage = speechLanguage === "auto" ? detectedLanguage : speechLanguage;
      utterance.lang = requestedLanguage; utterance.rate = speechRate;
      const availableVoices = voices.length ? voices : window.speechSynthesis.getVoices();
      const matchingVoice = availableVoices.find(voice => voice.lang.toLowerCase().startsWith(requestedLanguage.slice(0,2).toLowerCase()));
      if (matchingVoice) utterance.voice = matchingVoice;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => {
        setSpeaking(false);
        setError(rtl
          ? "تعذر على محرك المتصفح التلقائي نطق هذه اللغة. جرّب فتح المكتبة في Microsoft Edge؛ وإذا استمر التعذر نحتاج محرك صوت مستقلًا."
          : "The browser's automatic voice engine could not speak this language. Try Microsoft Edge; if it still fails, a separate voice engine is required.");
      };
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance); setSpeaking(true);
    } catch {
      setError(rtl ? "تعذر استخراج نص هذه الصفحة للصوت المجاني." : "Could not extract this page for free device speech.");
    }
  };

  const close = () => {
    window.speechSynthesis?.cancel(); setSpeaking(false);
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    if (ambientUrl) URL.revokeObjectURL(ambientUrl);
    setFileUrl(""); setDocument(null); setFileName(""); setFileKey(""); setPage(1); setError("");
    setCompatibility("untested"); setBookmarks([]); setAmbientUrl(""); setAmbientName(""); setAmbientOn(false);
  };

  return <div className="page source-reader-page">
    <header className="page-title"><div><span>{rtl ? "القارئ والصوت المجاني — V0.6.3" : "Free reader & device voice — V0.6.3"}</span><h2>{rtl ? "قارئ الكتب متعدد اللغات" : "Multilingual book reader"}</h2><p>{rtl ? "اعرض الكتاب واقرأ صفحته بصوت جهازك بلا OpenAI وبلا تكلفة API." : "View your book and hear each page through your device voice—no OpenAI call or API charge."}</p></div>{fileUrl && <button className="secondary" onClick={close}>{rtl ? "إغلاق الكتاب" : "Close book"}</button>}</header>

    {!fileUrl ? <section className="reader-empty panel">
      <div className="reader-emblem">◫</div><span className="eyebrow">{rtl ? "قراءة خاصة على جهازك" : "Private on-device reading"}</span>
      <h3>{rtl ? "اختر كتاب PDF لعرضه كما هو" : "Choose a PDF to view as authored"}</h3>
      <p>{rtl ? "يفتح المتصفح الملف في ذاكرة جهازك فقط. لا رفع، لا تخزين سحابي، ولا مشاركة." : "Your browser opens the file in device memory only. No upload, cloud storage, or sharing."}</p>
      <label className="reader-file"><input type="file" accept="application/pdf,.pdf" onChange={openFile}/><b>{loading ? (rtl ? "جارٍ فتح الكتاب…" : "Opening book…") : (rtl ? "اختر PDF من جهازك" : "Choose PDF from device")}</b><span>{rtl ? "الملف يبقى لديك" : "The file remains yours"}</span></label>
      {error && <div className="reader-error">{error}</div>}
      <div className="reader-safety"><b>✓ {rtl ? "مجاني وخاص" : "Free and private"}</b><span>{rtl ? "صوت الجهاز يقرأ النص الأصلي فقط؛ لا يلخص ولا يترجم ولا يرسل الكتاب إلى خدمة خارجية." : "Device speech reads the original text only; it does not summarize, translate, or send the book to an external service."}</span></div>
    </section> : <section className={`reader-shell theme-${theme}`} dir={effectiveRtl ? "rtl" : "ltr"}>
      <header className="reader-toolbar">
        <button className="reader-icon" onClick={() => setNavigatorOpen(!navigatorOpen)} title={rtl ? "التنقل والعلامات" : "Navigation and bookmarks"}>☰</button>
        <div className="reader-file-name"><i>▤</i><div><strong>{fileName}</strong><span>{rtl ? "ملف محلي — لم يُرفع" : "Local file — not uploaded"}</span></div></div>
        <div className="reader-modes" role="group" aria-label={rtl ? "طريقة العرض" : "View mode"}>
          <button className={viewMode === "native" ? "active" : ""} onClick={() => setViewMode("native")}>✓ {rtl ? "مطابق للأصل" : "Original"}</button>
          <button className={viewMode === "book" ? "active" : ""} disabled={!document} onClick={chooseBookMode}>{rtl ? "وضع الكتاب" : "Book mode"}</button>
        </div>
        <div className="reader-tools">
          {viewMode === "book" && <><button onClick={() => setScale(Math.max(.65, scale - .15))} title={rtl ? "تصغير" : "Zoom out"}>−</button><span>{Math.round(scale * 100)}%</span><button onClick={() => setScale(Math.min(2.1, scale + .15))} title={rtl ? "تكبير" : "Zoom in"}>＋</button><button className={bookmarks.includes(page) ? "selected" : ""} onClick={toggleBookmark} title={rtl ? "علامة الصفحة" : "Bookmark"}>⌑</button></>}
          <button onClick={() => setSettingsOpen(!settingsOpen)} title={rtl ? "إعدادات القارئ" : "Reader settings"}>⚙</button>
          <button onClick={() => stageRef.current?.requestFullscreen()} title={rtl ? "ملء الشاشة" : "Full screen"}>⛶</button>
        </div>
      </header>

      {settingsOpen && <aside className="reader-options">
        <div><b>{rtl ? "بيئة القراءة" : "Reading scene"}</b><div className="option-row themes">{(["linen","paper","library","night"] as Theme[]).map(item => <button key={item} className={theme === item ? "active" : ""} onClick={() => setTheme(item)}>{rtl ? ({linen:"هادئة",paper:"ورق",library:"مكتبة",night:"ليل"} as Record<Theme,string>)[item] : item}</button>)}</div></div>
        <div><b>{rtl ? "اتجاه الكتاب" : "Book direction"}</b><div className="option-row">{(["auto","rtl","ltr"] as Direction[]).map(item => <button key={item} className={direction === item ? "active" : ""} onClick={() => setDirection(item)}>{item === "auto" ? (rtl ? "تلقائي" : "Auto") : item.toUpperCase()}</button>)}</div></div>
        <div><b>{rtl ? "سرعة التقليب" : "Turn speed"}</b><div className="option-row">{(["slow","normal","fast"] as Speed[]).map(item => <button key={item} className={speed === item ? "active" : ""} onClick={() => setSpeed(item)}>{rtl ? ({slow:"هادئ",normal:"طبيعي",fast:"سريع"} as Record<Speed,string>)[item] : item}</button>)}</div></div>
        <div><b>{rtl ? "صوت الجهاز — مجاني" : "Device voice — free"}</b><div className="option-row"><select value={speechLanguage} onChange={e=>setSpeechLanguage(e.target.value as "auto"|"ar-SA"|"en-US")}><option value="auto">{rtl?"تلقائي حسب نص الصفحة":"Auto-detect page"}</option><option value="ar-SA">العربية</option><option value="en-US">English</option></select><select value={speechRate} onChange={e=>setSpeechRate(Number(e.target.value))}><option value="0.8">0.8×</option><option value="1">1×</option><option value="1.2">1.2×</option></select><button className={speaking?"active":""} disabled={!document||viewMode!=="book"} onClick={speakPage}>{speaking?(rtl?"■ إيقاف":"■ Stop"):(rtl?"▶ اقرأ الصفحة الحالية":"▶ Read current page")}</button></div><small>{viewMode!=="book"?(rtl?"انتقل إلى وضع الكتاب أولًا حتى يتزامن الصوت مع رقم الصفحة.":"Switch to Book mode first so speech follows the current page."):(rtl?`${voices.length} صوتًا متاحًا على الجهاز؛ لا يستهلك رصيد API.`:`${voices.length} device voices available; no API credit is used.`)}</small></div>
        <div><b>{rtl ? "مؤثرات القراءة" : "Reading sounds"}</b><div className="option-row"><button className={sound ? "active" : ""} onClick={() => setSound(!sound)}>{rtl ? "صوت الورق" : "Page sound"}</button><label className="audio-picker"><input type="file" accept="audio/*" onChange={chooseAmbient}/>{rtl ? "اختر صوتًا خلفيًا" : "Choose ambience"}</label>{ambientUrl && <button className={ambientOn ? "active" : ""} onClick={() => setAmbientOn(!ambientOn)}>{ambientOn ? "❚❚" : "▶"} {ambientName.slice(0,18)}</button>}</div></div>
        <audio ref={audioRef} src={ambientUrl} loop />
      </aside>}

      {navigatorOpen && document && <aside className="reader-navigator"><header><b>{rtl ? "التنقل في الكتاب" : "Book navigation"}</b><button onClick={() => setNavigatorOpen(false)}>×</button></header><div className="jump-grid">{Array.from({length: document.numPages}, (_, index) => index + 1).map(number => <button key={number} className={`${number === page ? "current" : ""} ${bookmarks.includes(number) ? "marked" : ""}`} onClick={() => { setPage(number); setNavigatorOpen(false); }}>{number}</button>)}</div><p>{rtl ? `علاماتك: ${bookmarks.length ? bookmarks.join("، ") : "لا توجد بعد"}` : `Bookmarks: ${bookmarks.length ? bookmarks.join(", ") : "none yet"}`}</p></aside>}

      {viewMode === "native" ? <div className="native-reader-stage" ref={stageRef}>
        <div className="fidelity-note">✓ {rtl ? "العرض الأصلي مرجع بصري فقط. للصوت المتزامن استخدم وضع الكتاب." : "Original view is the visual reference only. Use Book mode for synchronized speech."}<button onClick={chooseBookMode}>{rtl?"انتقل إلى وضع الكتاب والصوت":"Switch to Book mode & speech"}</button></div>
        <iframe title={fileName} src={`${fileUrl}#view=FitH&toolbar=1&navpanes=0`} />
      </div> : document ? <><div className="reader-stage" ref={stageRef} style={{"--turn-duration": `${speedMs[speed]}ms`} as React.CSSProperties}>
        <button className="page-arrow previous" onClick={() => turn(-1)} disabled={page === 1 || compatibility !== "passed"} aria-label={rtl ? "الصفحة السابقة" : "Previous page"}>‹</button>
        <div className="book-bed"><div className={`paper-page ${turning}`}><canvas ref={canvasRef}/><span className="page-number">{page}</span><span className="paper-shine"/></div></div>
        <button className="page-arrow next" onClick={() => turn(1)} disabled={page === document.numPages || compatibility !== "passed"} aria-label={rtl ? "الصفحة التالية" : "Next page"}>›</button>
        {compatibility === "untested" && <div className="compatibility-gate"><span>{rtl ? "اختبار سلامة النص" : "Text fidelity check"}</span><h3>{rtl ? "هل هذه الصفحة مطابقة للنص في العرض الأصلي؟" : "Does this page match the Original view?"}</h3><p>{rtl ? "افحص اتصال الحروف، ترتيب الكلمات، الأرقام، والخطوط اللاتينية. لن يعمل التقليب قبل إجابتك." : "Check character rendering, word order, numbers, and mixed-language text. Page turning stays locked until you confirm."}</p><div><button className="approve" onClick={approveCompatibility}>✓ {rtl ? "نعم، الصفحة صحيحة" : "Yes, it matches"}</button><button className="reject" onClick={rejectCompatibility}>× {rtl ? "لا، يوجد تشويه" : "No, text is distorted"}</button></div></div>}
      </div>
      <footer className="reader-footer"><button onClick={() => turn(-1)} disabled={page === 1 || compatibility !== "passed"}>{rtl ? "السابق" : "Previous"}</button><div><input type="range" min="1" max={document.numPages} value={page} disabled={compatibility !== "passed"} onChange={e => setPage(Number(e.target.value))}/><span>{rtl ? `الصفحة ${page} من ${document.numPages}` : `Page ${page} of ${document.numPages}`}</span></div><button className="speak-current" onClick={speakPage} disabled={compatibility!=="passed"}>{speaking?(rtl?"■ إيقاف":"■ Stop"):(rtl?"▶ استمع لهذه الصفحة":"▶ Listen to this page")}</button><button onClick={() => turn(1)} disabled={page === document.numPages || compatibility !== "passed"}>{rtl ? "التالي" : "Next"}</button></footer></> : null}
      {error && <div className="reader-error inline">{error}</div>}
      <div className="local-proof">◆ {rtl ? "يُحفظ رقم الصفحة والعلامات فقط على هذا الجهاز؛ ملف الكتاب والصوت الخلفي غير محفوظين في المنصة." : "Only page position and bookmarks are stored on this device; book and ambience files are not stored."}</div>
    </section>}

    <section className="milestone-board panel"><div><span>{rtl ? "يعمل الآن" : "Working now"}</span><strong>{rtl ? "العرض الأصلي + صوت الجهاز" : "Original view + device voice"}</strong><p>{rtl ? "قراءة مجانية بالعربية أو الإنجليزية بحسب أصوات الجهاز." : "Free Arabic or English speech using installed device voices."}</p></div><div><span>{rtl ? "حاجز جودة" : "Quality gate"}</span><strong>{rtl ? "اختبار بصري قبل التقليب" : "Visual check before turning"}</strong><p>{rtl ? "الفشل يعيد الملف للأصل ولا يعتمد التشويه." : "Failure returns to Original view and rejects distorted text."}</p></div><div><span>{rtl ? "حدود المجاني" : "Free-mode limits"}</span><strong>{rtl ? "النص الأصلي فقط" : "Original text only"}</strong><p>{rtl ? "الترجمة والتلخيص والصوت الاحترافي خدمات AI اختيارية منفصلة." : "Translation, summaries, and professional voice are separate optional AI services."}</p></div></section>
  </div>;
}
