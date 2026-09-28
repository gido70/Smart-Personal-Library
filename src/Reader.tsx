import PdfScrollReader from "./PdfScrollReader";
import PdfFlipBook, { type FlipControls } from "./PdfFlipBook";
import { pdfImageOptions } from "./lib/pdfAssets";
import { readerNetworkOptions } from "./lib/readerLoading";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createBookSignedUrl, getReadingProgress, saveReadingProgress } from "./lib/library";


type PdfViewport = { width: number; height: number };
type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  getTextContent: (options?: { disableNormalization?: boolean }) => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; canvas: HTMLCanvasElement }) => { promise: Promise<void>; cancel: () => void };
};
type PdfDocument = { numPages: number; getPage: (page: number) => Promise<PdfPage> };
type Theme = "linen" | "paper" | "library" | "night";
type Direction = "auto" | "rtl" | "ltr";
type Speed = "slow" | "normal" | "fast";
type PageLayout = "single" | "spread";


/** A book already saved in Supabase — passed in by App.tsx when the reader is
 * opened from the library, as opposed to the standalone "pick a local file" entry
 * point. The two paths are never mixed in one button (V0.7 requirement §4.5). */
export type SavedBookRef = { id: string; title: string; storagePath: string; initialPage?: number; sourceLanguage?: "ar" | "en" | "mixed" | "unknown" };

const speedMs: Record<Speed, number> = { slow: 750, normal: 500, fast: 300 };

export default function Reader({
  rtl,
  savedBook,
  onExitSavedBook,
  onHome,
  onLibrary,
}: {
  rtl: boolean;
  savedBook?: SavedBookRef | null;
  onExitSavedBook?: () => void;
  onHome?: () => void;
  onLibrary?: () => void;
}) {
  const flipControls = useRef<FlipControls | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PdfDocument | null>(null);

  // Two distinct, never-mixed sources: a temporary local file the browser never
  // uploads anywhere, or a book already saved in the user's library (opened via
  // a short-lived Signed URL, no file picker involved).
  const [source, setSource] = useState<"none" | "local" | "saved">("none");
  const [fileUrl, setFileUrl] = useState(""); // local (object URL)
  const [remoteUrl, setRemoteUrl] = useState(""); // saved (Supabase Signed URL)
  const [remoteUrlExpiresAt, setRemoteUrlExpiresAt] = useState(0);
  const [fileName, setFileName] = useState("");
  const [fileKey, setFileKey] = useState(""); // localStorage key, local reads only
  const [savedBookError, setSavedBookError] = useState("");

  const [viewMode, setViewMode] = useState<"native" | "book">("native");
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [stageWidth, setStageWidth] = useState(600);
  const [stageHeight, setStageHeight] = useState(600);
  const [rendering, setRendering] = useState(false);
  const [progressError, setProgressError] = useState(false);
  const shellRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [theme, setTheme] = useState<Theme>("linen");
  const [direction, setDirection] = useState<Direction>("auto");
  const [speed, setSpeed] = useState<Speed>("normal");
  const [pageLayout, setPageLayout] = useState<PageLayout>("single");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [savedProgressReady, setSavedProgressReady] = useState(false);
  const progressSaveTimer = useRef<number | null>(null);
  const progressQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingProgress = useRef<{ id: string; page: number; bookmarks: number[] } | null>(null);
  const flushProgress = () => {
    const pending = pendingProgress.current;
    if (!pending) return;
    pendingProgress.current = null;
    progressQueue.current = progressQueue.current.catch(() => undefined).then(() =>
      saveReadingProgress(pending.id, pending.page, pending.bookmarks),
    ).then(() => setProgressError(false)).catch(() => {
      if (!pendingProgress.current) pendingProgress.current = pending;
      setProgressError(true);
    });
  };
  const flushProgressRef = useRef(flushProgress);
  flushProgressRef.current = flushProgress;

  const bookRtl = source === "saved" && savedBook?.sourceLanguage === "en" ? false
    : source === "saved" && savedBook?.sourceLanguage === "ar" ? true : rtl;
  const effectiveRtl = direction === "auto" ? bookRtl : direction === "rtl";
  const activeUrl = source === "saved" ? remoteUrl : fileUrl;

  // --- open a saved library book (Signed URL, no file picker) ---------------
  useEffect(() => {
    if (!savedBook) return;
    let cancelled = false;
    const openSavedBook = async () => {
      setLoading(true);
      setError("");
      setSavedBookError("");
      setDocument(null);
      setSavedProgressReady(false);
      setSource("saved");
      setFileUrl("");
      setFileName(savedBook.title);
      setFileKey("");
      setViewMode("native");
      setPage(1);
      setBookmarks([]);
      try {
        const [signed, progress, pdfjs] = await Promise.all([
          createBookSignedUrl(savedBook.storagePath),
          getReadingProgress(savedBook.id).catch(() => null),
          import("pdfjs-dist"),
        ]);
        if (cancelled) return;
        setRemoteUrl(signed.url);
        setRemoteUrlExpiresAt(signed.expiresAt);
        let restoredPage = Math.max(1, savedBook.initialPage ?? 1);
        let restoredMarks: number[] = [];
        if (progress) {
          if (savedBook.initialPage == null) restoredPage = Math.max(1, progress.page);
          restoredMarks = progress.bookmarks;
        }
        if (cancelled) return;
        setBookmarks(restoredMarks);
        setPage(restoredPage);
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const loaded = (await pdfjs.getDocument({ ...pdfImageOptions(), ...readerNetworkOptions, url: signed.url, disableFontFace: true, useSystemFonts: false }).promise) as unknown as PdfDocument;
        if (cancelled) return;
        setDocument(loaded);
        setViewMode("book");
        setPage(Math.min(Math.max(restoredPage, 1), loaded.numPages));
        setSavedProgressReady(true);
      } catch (openError) {
        if (cancelled) return;
        setSavedBookError(
          rtl
            ? "تعذر فتح هذا الكتاب من مكتبتك. قد يكون الرابط الموقَّع منتهي الصلاحية أو الاتصال غير متاح."
            : "Could not open this book from your library. The signed link may have expired, or the connection failed.",
        );
        console.error("SPL: failed to open saved book", openError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void openSavedBook();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedBook?.id]);

  const retrySavedBook = async () => {
    if (!savedBook) return;
    setLoading(true);
    setSavedBookError("");
    try {
      const signed = await createBookSignedUrl(savedBook.storagePath);
      setRemoteUrl(signed.url);
      setRemoteUrlExpiresAt(signed.expiresAt);
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const loaded = (await pdfjs.getDocument({ ...pdfImageOptions(), ...readerNetworkOptions, url: signed.url, disableFontFace: true, useSystemFonts: false }).promise) as unknown as PdfDocument;
      setDocument(loaded);
        setViewMode("book");
      setPage((current) => Math.min(Math.max(current, 1), loaded.numPages));
      setSavedProgressReady(true);
    } catch (retryError) {
      setSavedBookError(
        rtl ? "ما زال تعذّر فتح الكتاب. تحقق من الاتصال ثم أعد المحاولة." : "Still could not open the book. Check your connection and try again.",
      );
      console.error("SPL: retry failed", retryError);
    } finally {
      setLoading(false);
    }
  };

  // Fit the actual reader width, including embedded device previews and rotation.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || viewMode !== "book") return;
    const resize = new ResizeObserver(([entry]) => {setStageWidth(entry.contentRect.width);setStageHeight(entry.contentRect.height);});
    resize.observe(stage);
    return () => resize.disconnect();
  }, [viewMode, document]);

  // Debounce normal turns, flush on reader exit/hidden tab, serialize writes.
  useEffect(() => {
    if (source === "local" && fileKey) {
      try { localStorage.setItem(`${fileKey}:page`, String(page)); } catch { /* Storage may be disabled. */ }
    }
    if (source !== "saved" || !savedBook || !savedProgressReady) return;
    pendingProgress.current = { id: savedBook.id, page, bookmarks: [...bookmarks] };
    progressSaveTimer.current = window.setTimeout(() => flushProgressRef.current(), 600);
    return () => { if (progressSaveTimer.current) window.clearTimeout(progressSaveTimer.current); };
  }, [source, savedBook?.id, savedProgressReady, page, bookmarks, fileKey]);

  useEffect(() => {
    const flush = () => flushProgressRef.current();
    const hidden = () => { if (window.document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", flush);
    window.document.addEventListener("visibilitychange", hidden);
    return () => {
      flush(); window.removeEventListener("pagehide", flush); window.removeEventListener("online", flush);
      window.document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!document || viewMode !== "book") return;
      if ((event.target as HTMLElement)?.closest("input, select, textarea, button, [contenteditable=true]")) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") event.preventDefault();
      if (event.key === "ArrowRight") turn(effectiveRtl ? 1 : -1);
      if (event.key === "ArrowLeft") turn(effectiveRtl ? -1 : 1);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [document, effectiveRtl, viewMode, page, speed, rendering, pageLayout]);

  // --- temporary local read (file picker, never uploaded) --------------------
  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const localUrl = URL.createObjectURL(selected);
    const key = `spl-reader:${selected.name}:${selected.size}`;
    const saved = Number(localStorage.getItem(`${key}:page`) || "1");
    let savedMarks: number[] = [];
    try { const stored = JSON.parse(localStorage.getItem(`${key}:marks`) || "[]"); if (Array.isArray(stored)) savedMarks = stored.filter(n => Number.isInteger(n) && n > 0); } catch { /* Ignore damaged local bookmarks. */ }
    setSource("local");
    setLoading(true); setError(""); setDocument(null);
    setFileUrl(localUrl); setFileName(selected.name); setFileKey(key); setBookmarks(savedMarks);
    setViewMode("native"); setPage(Math.max(saved, 1));
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const bytes = new Uint8Array(await selected.arrayBuffer());
      const loaded = await pdfjs.getDocument({ ...pdfImageOptions(), data: bytes, disableFontFace: true, useSystemFonts: false }).promise as unknown as PdfDocument;
      setDocument(loaded);
        setViewMode("book");
      setPage(Math.min(Math.max(saved, 1), loaded.numPages));
    } catch {
      setError(rtl ? "العرض المطابق للأصل متاح، لكن محرك الكتاب لم يتمكن من تحليل هذا الملف." : "Original view is available, but Book mode could not parse this file.");
    } finally { setLoading(false); }
  };

  const turn = (delta: number) => {
    if (viewMode === "native" && document) setPage(current => Math.min(document.numPages, Math.max(1,current+delta)));
    else flipControls.current?.turn(delta);
  };

  const chooseBookMode = () => {
    if (!document) return;
    setError(""); setViewMode("book");
  };

  const toggleBookmark = () => {
    const next = bookmarks.includes(page) ? bookmarks.filter(item => item !== page) : [...bookmarks, page].sort((a, b) => a - b);
    setBookmarks(next);
    if (source === "local" && fileKey) localStorage.setItem(`${fileKey}:marks`, JSON.stringify(next));
    // "saved" source persists via the debounced Supabase effect above.
  };

  const close = () => {
    flushProgress();
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFileUrl(""); setRemoteUrl(""); setRemoteUrlExpiresAt(0); setSavedBookError("");
    setDocument(null); setFileName(""); setFileKey(""); setPage(1); setError("");
    setBookmarks([]);
    setSavedProgressReady(false);
    setSource("none");
    onExitSavedBook?.();
  };

  const isSaved = source === "saved";
  const leaveReader = (destination: "back" | "library" | "home") => {
    flushProgress();
    if (destination === "home") onHome?.();
    else if (destination === "library") onLibrary?.();
    else close();
  };

  return <div className={`page source-reader-page${activeUrl ? " has-book" : ""}`}>
    <nav className="reader-return-bar" aria-label={rtl ? "العودة من القارئ" : "Leave reader"}>
      <button onClick={() => leaveReader("home")}>⌂ <span>{rtl ? "الرئيسية" : "Home"}</span></button>
      <button onClick={() => leaveReader("library")}>▥ <span>{rtl ? "المكتبة" : "Library"}</span></button>
      <button onClick={() => leaveReader("back")}>↩ <span>{rtl ? "صفحة الكتاب" : "Book page"}</span></button>
    </nav>
    <header className="page-title"><div><span>{rtl ? "قارئ الكتاب الأصلي" : "Original book reader"}</span><h2>{isSaved ? (rtl ? "كتاب من مكتبتك" : "A book from your library") : (rtl ? "قارئ الكتب متعدد اللغات" : "Multilingual book reader")}</h2><p>{rtl ? "اقرأ، كبّر الصفحة، ثم تابع من موضع توقفك." : "Read, zoom, and continue from your reading position."}</p></div>{activeUrl && <button className="secondary" onClick={close}>{isSaved ? (rtl ? "العودة إلى الكتاب" : "Back to the book") : (rtl ? "إغلاق الكتاب" : "Close book")}</button>}</header>

    {savedBook && !activeUrl ? <section className="reader-empty panel">
      <div className="reader-emblem">◫</div><span className="eyebrow">{rtl ? "فتح من مكتبتك" : "Opening from your library"}</span>
      <h3>{loading ? (rtl ? "جارٍ فتح كتابك من مكتبتك…" : "Opening your book from the library…") : (rtl ? "تعذّر الفتح" : "Could not open")}</h3>
      {savedBookError && <div className="reader-error">{savedBookError}</div>}
      {savedBookError && <button className="secondary" onClick={retrySavedBook}>{rtl ? "إعادة المحاولة (تجديد الرابط)" : "Retry (renew link)"}</button>}
    </section> : !activeUrl ? <section className="reader-empty panel">
      <div className="reader-emblem">◫</div><span className="eyebrow">{rtl ? "قراءة محلية مؤقتة — لا رفع" : "Temporary local read — not uploaded"}</span>
      <h3>{rtl ? "اختر كتاب PDF لعرضه كما هو" : "Choose a PDF to view as authored"}</h3>
      <p>{rtl ? "يفتح المتصفح الملف في ذاكرة جهازك فقط لهذه الجلسة. لا رفع، لا تخزين سحابي، ولا مشاركة. لفتح كتاب محفوظ في مكتبتك بلا اختيار ملف، افتحه من صفحة الكتاب في مكتبتي." : "Your browser opens the file in device memory only, for this session. No upload, cloud storage, or sharing. To open a book already saved in your library without picking a file, open it from that book's page in My library."}</p>
      <label className="reader-file"><input type="file" accept="application/pdf,.pdf" onChange={openFile}/><b>{loading ? (rtl ? "جارٍ فتح الكتاب…" : "Opening book…") : (rtl ? "اختر PDF من جهازك" : "Choose PDF from device")}</b><span>{rtl ? "الملف يبقى لديك" : "The file remains yours"}</span></label>
      {error && <div className="reader-error">{error}</div>}
      <div className="reader-safety"><b>✓ {rtl ? "مجاني وخاص" : "Free and private"}</b><span>{rtl ? "يفتح القارئ صفحات الكتاب كما هي دون تلخيص أو ترجمة." : "The reader displays the original pages without summarizing or translating."}</span></div>
    </section> : <section ref={shellRef} className={`reader-shell theme-${theme}`} dir={effectiveRtl ? "rtl" : "ltr"}>
      <header className="reader-toolbar">
        <button className="reader-icon" onClick={() => setNavigatorOpen(!navigatorOpen)} title={rtl ? "التنقل والعلامات" : "Navigation and bookmarks"}>☰ {rtl ? "الصفحات والعلامات" : "Pages & bookmarks"}</button>
        <div className="reader-file-name"><i>▤</i><div><strong>{fileName}</strong><span>{isSaved ? (rtl ? "من مكتبتك — محفوظ في مساحتك الخاصة" : "From your library — saved in your private space") : (rtl ? "ملف محلي — لم يُرفع" : "Local file — not uploaded")}</span></div></div>
        <div className="reader-modes" role="group" aria-label={rtl ? "طريقة العرض" : "View mode"}>
          <button className={viewMode === "native" ? "active" : ""} onClick={() => setViewMode("native")}>✓ {rtl ? "عرض PDF العادي" : "Standard PDF"}</button>
          <button className={viewMode === "book" ? "active" : ""} disabled={!document} onClick={chooseBookMode}>{rtl ? "تقليب الكتاب الأصلي" : "Flip original book"}</button>
        </div>
        <div className="reader-tools">
          {document && <><button onClick={() => setScale(Math.max(.75, scale - .25))} title={rtl ? "تصغير" : "Zoom out"}>− {rtl ? "تصغير" : "Zoom out"}</button><button onClick={() => setScale(1)} title={rtl ? "ملاءمة الصفحة" : "Fit page"}>{rtl ? "ملاءمة" : "Fit"} · {Math.round(scale * 100)}%</button><button onClick={() => setScale(Math.min(3, scale + .25))} title={rtl ? "تكبير" : "Zoom in"}>＋ {rtl ? "تكبير" : "Zoom in"}</button></>}
          <button onClick={() => setSettingsOpen(!settingsOpen)} title={rtl ? "إعدادات القارئ" : "Reader settings"}>⚙ {rtl ? "الإعدادات" : "Settings"}</button>
          <button onClick={() => { if (window.document.fullscreenElement) void window.document.exitFullscreen(); else if (shellRef.current?.requestFullscreen) void shellRef.current.requestFullscreen().catch(() => setError(rtl ? "ملء الشاشة غير متاح في هذا المتصفح." : "Fullscreen is unavailable in this browser.")); else setError(rtl ? "ملء الشاشة غير متاح في هذا المتصفح." : "Fullscreen is unavailable in this browser."); }} title={rtl ? "ملء الشاشة" : "Full screen"}>⛶ {rtl ? "ملء الشاشة" : "Full screen"}</button>
        </div>
      </header>

      {loading && <p className="reader-help" role="status">{rtl ? "جارٍ فتح الكتاب. قد يستغرق الملف الكبير وقتًا أطول…" : "Opening the book. Large files may take longer…"}</p>}
      {savedBookError && <div className="reader-error" role="alert">{savedBookError}<button onClick={retrySavedBook}>{rtl ? "أعد المحاولة" : "Retry"}</button></div>}
      {viewMode === "book" && <p className="reader-help">{scale > 1 ? (rtl ? "حرّك الصفحة لرؤية الجزء المكبّر. للمتابعة استخدم «التالي» أو أعد «ملاءمة»." : "Scroll to explore the zoomed page. Use Next, or Fit to turn by dragging.") : (rtl ? (effectiveRtl ? "للتالي اسحب زاوية الصفحة من اليسار إلى اليمين، أو اضغط «التالي»." : "للتالي اسحب زاوية الصفحة من اليمين إلى اليسار، أو اضغط «التالي».") : (effectiveRtl ? "Drag a left corner to the right for the next page, or use Next." : "Drag a right corner to the left for the next page, or use Next."))}</p>}
      {settingsOpen && <aside className="reader-options">
        <div><b>{rtl ? "العلامات المرجعية" : "Bookmarks"}</b><div className="option-row"><button className={bookmarks.includes(page) ? "selected" : ""} onClick={toggleBookmark} title={rtl ? "علامة الصفحة" : "Bookmark"}>⌑ {bookmarks.includes(page) ? (rtl ? "إزالة العلامة" : "Remove bookmark") : (rtl ? "حفظ علامة" : "Bookmark")}</button></div></div>
        <div><b>{rtl ? "بيئة القراءة" : "Reading scene"}</b><div className="option-row themes">{(["linen","paper","library","night"] as Theme[]).map(item => <button key={item} className={theme === item ? "active" : ""} onClick={() => setTheme(item)}>{rtl ? ({linen:"هادئة",paper:"ورق",library:"مكتبة",night:"ليل"} as Record<Theme,string>)[item] : item}</button>)}</div></div>
        <div><b>{rtl ? "اتجاه الكتاب" : "Book direction"}</b><div className="option-row">{(["auto","rtl","ltr"] as Direction[]).map(item => <button key={item} className={direction === item ? "active" : ""} onClick={() => setDirection(item)}>{item === "auto" ? (rtl ? "تلقائي" : "Auto") : (item === "rtl" ? (rtl ? "العربية: إلى اليمين" : "Arabic: turn right") : (rtl ? "الإنجليزية: إلى اليسار" : "English: turn left"))}</button>)}</div></div>
        <div><b>{rtl ? "سرعة التقليب" : "Turn speed"}</b><div className="option-row">{(["slow","normal","fast"] as Speed[]).map(item => <button key={item} className={speed === item ? "active" : ""} onClick={() => setSpeed(item)}>{rtl ? ({slow:"هادئ",normal:"طبيعي",fast:"سريع"} as Record<Speed,string>)[item] : item}</button>)}</div></div>
        <div><b>{rtl ? "عرض الصفحات" : "Page layout"}</b><div className="option-row"><button className={pageLayout === "single" ? "active" : ""} onClick={() => { setPageLayout("single"); setScale(1); }}>{rtl ? "صفحة واحدة" : "Single page"}</button><button className={pageLayout === "spread" ? "active" : ""} onClick={() => { setPageLayout("spread"); setScale(1); }}>{rtl ? "صفحتان" : "Two pages"}</button></div><small>{rtl ? "صفحة واحدة أنسب للهاتف الرأسي، وصفحتان للأفقي والتابلت." : "Single page suits portrait phones; two pages suit landscape and tablets."}</small></div>
      </aside>}

      {navigatorOpen && document && <aside className="reader-navigator"><header><b>{rtl ? "التنقل في الكتاب" : "Book navigation"}</b><button onClick={() => setNavigatorOpen(false)}>{rtl ? "إغلاق" : "Close"}</button></header><div className="jump-grid">{Array.from({length: document.numPages}, (_, index) => index + 1).map(number => <button key={number} className={`${number === page ? "current" : ""} ${bookmarks.includes(number) ? "marked" : ""}`} disabled={rendering} onClick={() => { setPage(number); setNavigatorOpen(false); }}>{number}</button>)}</div><p>{rtl ? `علاماتك: ${bookmarks.length ? bookmarks.join("، ") : "لا توجد بعد"}` : `Bookmarks: ${bookmarks.length ? bookmarks.join(", ") : "none yet"}`}</p></aside>}

      {viewMode === "native" ? <>
        <p className="reader-help">{rtl ? "مرّر إلى أسفل لقراءة الصفحات. يمكنك التكبير أو الانتقال إلى صفحة؛ يُحفظ موضعك تلقائيًا." : "Scroll down to read. Zoom or jump to a page; your position saves automatically."}</p>
        <div className="native-reader-stage" ref={stageRef}>
          {document ? <PdfScrollReader pdf={document} page={page} zoom={scale} rtl={rtl} onPage={setPage} onError={() => setError(rtl ? "تعذر رسم الصفحة. أعد فتح الكتاب أو استخدم عارض المتصفح البديل." : "Could not render this page. Reopen the book or use the browser fallback.")}/> : !loading ? <iframe title={fileName} src={`${activeUrl}#page=${page}&view=Fit&toolbar=1&navpanes=0`} /> : null}
        </div>
        {document && <footer className="reader-footer"><button onClick={() => turn(-1)} disabled={page===1}>{rtl?"السابق":"Previous"}</button><div><input type="range" min="1" max={document.numPages} value={page} aria-label={rtl?"انتقل إلى صفحة":"Go to page"} onChange={e=>setPage(Number(e.target.value))}/><span>{rtl?`الصفحة ${page} من ${document.numPages}`:`Page ${page} of ${document.numPages}`}</span></div><button onClick={() => turn(1)} disabled={page===document.numPages}>{rtl?"التالي":"Next"}</button></footer>}
      </> : document ? <><div className={`reader-stage layout-${pageLayout}`} ref={stageRef} style={{"--turn-duration": `${speedMs[speed]}ms`} as React.CSSProperties}>
        <div className="reader-page-scroll" ref={scrollRef}>
          <PdfFlipBook pdf={document} page={page} rtl={effectiveRtl} spread={pageLayout === "spread"} width={stageWidth} height={stageHeight} zoom={scale} duration={speedMs[speed]}
            enabled={true} controls={flipControls} onPage={setPage} onBusy={setRendering} onTurn={() => undefined}
            onError={() => {setRendering(false);setError(rtl ? "تعذر تجهيز الصفحة. جرّب عرض PDF العادي." : "Could not prepare the page. Try Standard PDF.");}} />
        </div>
        {rendering && <span className="reader-loading" role="status">{rtl ? "جارٍ تجهيز الصفحات…" : "Preparing pages…"}</span>}

      </div>
      <footer className="reader-footer"><button onClick={() => turn(-1)} disabled={page === 1 || rendering}>{rtl ? "السابق" : "Previous"}</button><div><input type="range" min="1" max={document.numPages} value={page} aria-label={rtl ? "انتقل إلى صفحة" : "Go to page"} disabled={rendering} onChange={e => setPage(Number(e.target.value))}/><span>{rtl ? `${pageLayout === "spread" ? "الصفحتان" : "الصفحة"} ${page}${pageLayout === "spread" && page < document.numPages ? `–${page+1}` : ""} من ${document.numPages}` : `Page${pageLayout === "spread" ? "s" : ""} ${page}${pageLayout === "spread" && page < document.numPages ? `–${page+1}` : ""} of ${document.numPages}`}</span></div><button onClick={() => turn(1)} disabled={page + (pageLayout === "spread" ? 1 : 0) >= document.numPages || rendering}>{rtl ? "التالي" : "Next"}</button></footer></> : null}
      {error && <div className="reader-error inline">{error}<details><summary>{rtl ? "عارض المتصفح البديل" : "Browser viewer fallback"}</summary><iframe title={fileName} style={{width:"100%",height:"65dvh"}} src={`${activeUrl}#page=${page}&view=Fit`} /></details></div>}
      {progressError && <div className="reader-error" role="status">{rtl ? "لم يُحفظ موضع القراءة في الحساب بعد. تحقق من الاتصال." : "Reading position has not saved to your account yet. Check your connection."}<button onClick={flushProgress}>{rtl ? "أعد الحفظ" : "Retry save"}</button></div>}
      <div className="local-proof">◆ {isSaved ? (rtl ? "يُحفظ رقم الصفحة والعلامات في مكتبتك؛ لا يُعاد رفع ملف الكتاب — هو محفوظ أصلًا في مساحتك الخاصة." : "Page position and bookmarks are saved to your library; the book file itself is not re-uploaded — it is already stored in your private space.") : (rtl ? "يُحفظ رقم الصفحة والعلامات فقط على هذا الجهاز؛ ملف الكتاب غير محفوظ في المنصة." : "Only page position and bookmarks are stored on this device; the book file is not stored.")}</div>
    </section>}

    <section className="milestone-board panel"><div><span>{rtl ? "يعمل الآن" : "Working now"}</span><strong>{rtl ? "صفحات الكتاب الأصلي" : "Original book pages"}</strong><p>{rtl ? "قراءة وتكبير وعلامات مرجعية؛ الصوت المحفوظ متاح في صفحة الكتاب." : "Read, zoom and bookmark. Saved audio is available on the book page."}</p></div><div><span>{rtl ? "خيار عرض آخر" : "Alternative view"}</span><strong>{rtl ? "عرض PDF العادي" : "Standard PDF"}</strong><p>{rtl ? "يمكنك التحويل إلى التمرير الرأسي في أي وقت." : "Switch to vertical scrolling at any time."}</p></div><div><span>{rtl ? "حدود المجاني" : "Free-mode limits"}</span><strong>{rtl ? "النص الأصلي فقط" : "Original text only"}</strong><p>{rtl ? "الترجمة والتلخيص والصوت الاحترافي خدمات AI اختيارية منفصلة." : "Translation, summaries, and professional voice are separate optional AI services."}</p></div></section>
  </div>;
}
