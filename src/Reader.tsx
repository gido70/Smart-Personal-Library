import { ChangeEvent, useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createBookSignedUrl, getReadingProgress, saveReadingProgress } from "./lib/library";
import { extractPdfPageText } from "./lib/textAnalysis";

type PdfViewport = { width: number; height: number };
type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  getTextContent: (options?: { disableNormalization?: boolean }) => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; canvas: HTMLCanvasElement }) => { promise: Promise<void> };
};
type PdfDocument = { numPages: number; getPage: (page: number) => Promise<PdfPage> };
type Theme = "linen" | "paper" | "library" | "night";
type Direction = "auto" | "rtl" | "ltr";
type Speed = "slow" | "normal" | "fast";
type Compatibility = "untested" | "passed" | "failed";

/** A book already saved in Supabase — passed in by App.tsx when the reader is
 * opened from the library, as opposed to the standalone "pick a local file" entry
 * point. The two paths are never mixed in one button (V0.7 requirement §4.5). */
export type SavedBookRef = { id: string; title: string; storagePath: string; initialPage?: number };

const speedMs: Record<Speed, number> = { slow: 920, normal: 650, fast: 390 };

/** Splits page text into short, speech-friendly chunks at sentence boundaries
 * (Arabic and Latin punctuation both recognised), so a single very long
 * SpeechSynthesisUtterance never has to carry a whole page — long utterances
 * are the documented trigger for browsers cutting off or repeating audio. */
function splitIntoSpeechChunks(text: string, maxChunkLength = 220): string[] {
  const sentences = text.split(/(?<=[.!?؟。])\s+/u).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    let remaining = sentence;
    while (remaining.length > maxChunkLength) {
      // A single sentence longer than the cap: break at the nearest space instead of mid-word.
      let cut = remaining.lastIndexOf(" ", maxChunkLength);
      if (cut <= 0) cut = maxChunkLength;
      const piece = remaining.slice(0, cut).trim();
      if (current) { chunks.push(current); current = ""; }
      if (piece) chunks.push(piece);
      remaining = remaining.slice(cut).trim();
    }
    if (current && current.length + remaining.length + 1 > maxChunkLength) {
      chunks.push(current);
      current = remaining;
    } else {
      current = current ? `${current} ${remaining}` : remaining;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

export default function Reader({
  rtl,
  savedBook,
  onExitSavedBook,
}: {
  rtl: boolean;
  savedBook?: SavedBookRef | null;
  onExitSavedBook?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
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
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [speechProgress, setSpeechProgress] = useState<{ index: number; total: number } | null>(null);
  const [savedProgressReady, setSavedProgressReady] = useState(false);
  // Set when the current page has no usable text layer (cover/scanned page):
  // the nearest page forward that DOES have real text, so the UI can offer a
  // one-click jump instead of just failing (CLAUDE-REVIEW-PROMPT.md §د).
  const [suggestedTextPage, setSuggestedTextPage] = useState<number | null>(null);
  const [scanningForText, setScanningForText] = useState(false);

  const speechGenerationRef = useRef(0);
  const speechQueueRef = useRef<string[]>([]);
  const progressSaveTimer = useRef<number | null>(null);

  // --- device speech: chunked queue + generation token ------------------------
  // Declared early (before any effect references it) to avoid a temporal-dead-zone
  // crash: the unmount/page-change cleanup effects below call this on every render.
  const stopSpeech = () => {
    speechGenerationRef.current += 1;
    speechQueueRef.current = [];
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setSpeechProgress(null);
  };
  // Stable ref so effects registered before speakPage is defined (unmount, page-change)
  // always call the latest stopSpeech without a stale-closure/dependency dance.
  const stopSpeechRef = useRef(stopSpeech);
  stopSpeechRef.current = stopSpeech;

  const effectiveRtl = direction === "auto" ? rtl : direction === "rtl";
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
      setCompatibility("untested");
      setSavedProgressReady(false);
      setSource("saved");
      setFileUrl("");
      setFileName(savedBook.title);
      setFileKey("");
      setViewMode("native");
      setPage(1);
      setBookmarks([]);
      try {
        const signed = await createBookSignedUrl(savedBook.storagePath);
        if (cancelled) return;
        setRemoteUrl(signed.url);
        setRemoteUrlExpiresAt(signed.expiresAt);
        let restoredPage = Math.max(1, savedBook.initialPage ?? 1);
        let restoredMarks: number[] = [];
        try {
          const progress = await getReadingProgress(savedBook.id);
          if (progress && savedBook.initialPage == null) {
            restoredPage = Math.max(1, progress.page);
            restoredMarks = progress.bookmarks;
          }
        } catch {
          // Reading progress is a nice-to-have; a failed read must not block opening the book.
        }
        if (cancelled) return;
        setBookmarks(restoredMarks);
        setPage(restoredPage);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const loaded = (await pdfjs.getDocument({ url: signed.url, disableFontFace: true, useSystemFonts: false }).promise) as unknown as PdfDocument;
        if (cancelled) return;
        setDocument(loaded);
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
      const loaded = (await pdfjs.getDocument({ url: signed.url, disableFontFace: true, useSystemFonts: false }).promise) as unknown as PdfDocument;
      setDocument(loaded);
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

  // --- render current page to canvas (Book mode) -----------------------------
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
      if (source === "local" && fileKey) localStorage.setItem(`${fileKey}:page`, String(page));
    };
    render().catch(() => setError(rtl ? "تعذر رسم هذه الصفحة؛ استخدم العرض المطابق للأصل." : "This page could not be rendered; use Original view."));
    return () => {
      cancelled = true;
    };
  }, [document, page, scale, fileKey, rtl, viewMode, source]);

  // --- persist reading progress for a *saved* book to Supabase (debounced) ---
  useEffect(() => {
    if (source !== "saved" || !savedBook || !savedProgressReady) return;
    if (progressSaveTimer.current) window.clearTimeout(progressSaveTimer.current);
    progressSaveTimer.current = window.setTimeout(() => {
      saveReadingProgress(savedBook.id, page, bookmarks).catch((saveError) => {
        console.warn("SPL: could not save reading progress", saveError);
      });
    }, 600);
    return () => {
      if (progressSaveTimer.current) window.clearTimeout(progressSaveTimer.current);
    };
  }, [source, savedBook, savedProgressReady, page, bookmarks]);

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
  useEffect(() => () => { if (ambientUrl) URL.revokeObjectURL(ambientUrl); }, [ambientUrl]);
  useEffect(() => () => stopSpeechRef.current(), []);
  useEffect(() => { stopSpeechRef.current(); setSuggestedTextPage(null); setScanningForText(false); }, [page]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    // Chrome can populate its voice list well after the first render and does
    // not always emit voiceschanged consistently on Windows. A few short,
    // bounded retries make the installed Arabic voice visible without polling
    // forever or requiring the user to reopen the page repeatedly.
    const retries = [250, 750, 1500, 3000].map((delay) => window.setTimeout(loadVoices, delay));
    return () => {
      retries.forEach((retry) => window.clearTimeout(retry));
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
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

  // --- temporary local read (file picker, never uploaded) --------------------
  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const localUrl = URL.createObjectURL(selected);
    const key = `spl-reader:${selected.name}:${selected.size}`;
    const saved = Number(localStorage.getItem(`${key}:page`) || "1");
    const savedMarks = JSON.parse(localStorage.getItem(`${key}:marks`) || "[]") as number[];
    setSource("local");
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
    window.setTimeout(() => audio.close().catch(() => undefined), 300);
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
    if (source === "local" && fileKey) localStorage.setItem(`${fileKey}:marks`, JSON.stringify(next));
    // "saved" source persists via the debounced Supabase effect above.
  };

  const chooseAmbient = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (ambientUrl) URL.revokeObjectURL(ambientUrl);
    setAmbientUrl(URL.createObjectURL(selected)); setAmbientName(selected.name); setAmbientOn(true);
  };

  /**
   * Scans forward (then, if nothing found, backward) up to 25 pages for the
   * nearest page with a real text layer, so a cover/scanned page can offer a
   * one-click jump instead of a dead end. Bails out immediately if `gen` is
   * superseded (page changed / speech stopped) so a slow scan never lands on
   * a page the user has since navigated away from.
   */
  const findNextTextPage = async (fromPage: number, doc: PdfDocument, gen: number): Promise<number | null> => {
    const maxScan = 25;
    const tryPage = async (pageNumber: number): Promise<boolean> => {
      try {
        const candidate = await doc.getPage(pageNumber);
        const content = await candidate.getTextContent();
        const text = extractPdfPageText(content.items);
        return (text.match(/[\p{L}]/gu) ?? []).length >= 10;
      } catch {
        return false;
      }
    };
    for (let offset = 1; offset <= maxScan; offset++) {
      if (gen !== speechGenerationRef.current) return null;
      const forward = fromPage + offset;
      if (forward <= doc.numPages && (await tryPage(forward))) return forward;
    }
    for (let offset = 1; offset <= maxScan; offset++) {
      if (gen !== speechGenerationRef.current) return null;
      const backward = fromPage - offset;
      if (backward >= 1 && (await tryPage(backward))) return backward;
    }
    return null;
  };

  const jumpToSuggestedTextPage = () => {
    if (suggestedTextPage === null) return;
    stopSpeech();
    setError("");
    setSuggestedTextPage(null);
    setViewMode("book");
    setPage(suggestedTextPage);
  };

  const speakPage = async () => {
    if (!document || !("speechSynthesis" in window)) {
      setError(rtl ? "هذا المتصفح لا يدعم صوت الجهاز." : "This browser does not support device speech.");
      return;
    }
    if (speaking) { stopSpeech(); return; }
    if (viewMode !== "book") {
      setError(rtl ? "للقراءة المتزامنة انتقل إلى «وضع الكتاب»؛ عارض المتصفح الأصلي لا يشارك رقم الصفحة المفتوحة مع التطبيق." : "For synchronized speech, switch to Book mode. The browser's native PDF viewer does not expose its current page to the app.");
      return;
    }
    // Claim this request before any async PDF extraction. A page change or a
    // second request invalidates it immediately, so stale text can never speak.
    speechGenerationRef.current += 1;
    const myGeneration = speechGenerationRef.current;
    speechQueueRef.current = [];
    window.speechSynthesis.cancel();
    try {
      const pdfPage = await document.getPage(page);
      if (myGeneration !== speechGenerationRef.current) return;
      let content: { items: Array<{ str?: string; hasEOL?: boolean }> };
      try {
        content = await pdfPage.getTextContent();
      } catch {
        // A second, simpler extraction pass helps Safari/WKWebView with PDFs
        // whose font normalization fails while the rendered page is still valid.
        content = await pdfPage.getTextContent({ disableNormalization: true });
      }
      if (myGeneration !== speechGenerationRef.current) return;
      const pageText = extractPdfPageText(content.items).replace(/\s+/g, " ").trim();
      const readableLetters = pageText.match(/[\p{L}]/gu) ?? [];
      if (readableLetters.length < 10) {
        setError(rtl ? "هذه الصفحة فارغة أو لا تحتوي نصًا كافيًا للقراءة — على الأرجح غلاف أو صفحة مصوّرة، وهذا يحتاج OCR لا نوفره في هذه النسخة المجانية." : "This page is blank or has too little readable text — most likely a cover or a scanned image, which needs OCR that this free tier does not provide.");
        setSuggestedTextPage(null);
        setScanningForText(true);
        void findNextTextPage(page, document, myGeneration)
          .then((found) => { if (myGeneration === speechGenerationRef.current) setSuggestedTextPage(found); })
          .finally(() => { if (myGeneration === speechGenerationRef.current) setScanningForText(false); });
        return;
      }
      setSuggestedTextPage(null);
      const arabicLetters = (pageText.match(/[؀-ۿ]/g) ?? []).length;
      const latinLetters = (pageText.match(/[A-Za-z]/g) ?? []).length;
      const detectedLanguage: "ar-SA" | "en-US" = arabicLetters >= latinLetters ? "ar-SA" : "en-US";
      const requestedLanguage = speechLanguage === "auto" ? detectedLanguage : speechLanguage;
      const availableVoices = voices.length ? voices : window.speechSynthesis.getVoices();
      const languagePrefix = requestedLanguage.slice(0, 2).toLowerCase();
      const selectedVoice = availableVoices.find((voice) => voice.voiceURI === selectedVoiceURI);
      const matchingVoice =
        (selectedVoice?.lang.toLowerCase().startsWith(languagePrefix) ? selectedVoice : null) ??
        availableVoices.find((voice) => voice.lang.toLowerCase().startsWith(languagePrefix));

      // Never let a page detected as Arabic (or explicitly requested as Arabic)
      // fall back to whatever the browser's default voice happens to be — on many
      // systems with no Arabic voice pack installed, that default is an English
      // voice that mispronounces the Arabic text entirely. Refuse instead.
      const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const isGoogleChrome = /(?:Chrome|CriOS)\//.test(navigator.userAgent) &&
        !/(?:Edg|OPR)\//.test(navigator.userAgent);
      // iOS and Google Chrome may omit an installed/online Arabic voice from
      // getVoices(), while still routing an utterance correctly from its lang.
      // The user explicitly targets Chrome, so allow Chrome's own language
      // routing instead of blocking before speechSynthesis gets a chance.
      const allowNativeLanguageVoice = requestedLanguage === "ar-SA" && (isAppleMobile || isGoogleChrome);
      if (!matchingVoice && !allowNativeLanguageVoice) {
        setSpeaking(false);
        setSpeechProgress(null);
        setError(
          requestedLanguage === "ar-SA"
            ? rtl
              ? "لم يعثر Google Chrome على صوت عربي. فعّل العربية في إعدادات اللغة والصوت بالجهاز، أغلق Chrome بالكامل ثم افتحه من جديد."
              : "Google Chrome could not find an Arabic voice. Enable Arabic in your device language and speech settings, fully close Chrome, then reopen it."
            : rtl
              ? "لا يوجد صوت مطابق للغة المطلوبة على هذا الجهاز."
              : "No voice matching the requested language is installed on this device.",
        );
        return;
      }

      setError("");
      const chunks = splitIntoSpeechChunks(pageText);
      if (!chunks.length) return;
      speechQueueRef.current = chunks;
      setSpeaking(true);

      const playChunk = (index: number) => {
        if (myGeneration !== speechGenerationRef.current) return; // superseded by a newer call
        if (index >= speechQueueRef.current.length) {
          setSpeaking(false);
          setSpeechProgress(null);
          return;
        }
        setSpeechProgress({ index: index + 1, total: speechQueueRef.current.length });
        const utterance = new SpeechSynthesisUtterance(speechQueueRef.current[index]);
        utterance.lang = requestedLanguage;
        utterance.rate = speechRate;
        if (matchingVoice) utterance.voice = matchingVoice;
        utterance.onend = () => {
          if (myGeneration !== speechGenerationRef.current) return;
          playChunk(index + 1);
        };
        utterance.onerror = () => {
          if (myGeneration !== speechGenerationRef.current) return;
          setSpeaking(false);
          setSpeechProgress(null);
          setError(
            rtl
              ? "تعذر على Google Chrome تشغيل الصوت المحدد. أغلق Chrome بالكامل بعد تثبيت الصوت العربي ثم افتحه مجددًا، أو استخدم الصوت الاحترافي المستقل في V0.9."
              : "Google Chrome could not play the selected voice. Fully close Chrome after installing Arabic speech, then reopen it, or use V0.9's independent professional voice.",
          );
        };
        window.speechSynthesis.speak(utterance);
      };
      playChunk(0);
    } catch (extractionError) {
      // Logged (not swallowed) so a real engine/compatibility failure is
      // diagnosable from the console instead of only ever showing this one
      // generic message — this is exactly the catch block that was masking
      // the Promise.withResolvers TypeError in V0.7.2 (see lib/polyfills.ts).
      console.error("SPL: speakPage text extraction failed", extractionError);
      setError(rtl ? "تعذر استخراج نص هذه الصفحة للصوت المجاني." : "Could not extract this page for free device speech.");
    }
  };

  const close = () => {
    stopSpeech();
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    if (ambientUrl) URL.revokeObjectURL(ambientUrl);
    setFileUrl(""); setRemoteUrl(""); setRemoteUrlExpiresAt(0); setSavedBookError("");
    setDocument(null); setFileName(""); setFileKey(""); setPage(1); setError("");
    setCompatibility("untested"); setBookmarks([]); setAmbientUrl(""); setAmbientName(""); setAmbientOn(false);
    setSavedProgressReady(false);
    setSuggestedTextPage(null); setScanningForText(false);
    setSource("none");
    onExitSavedBook?.();
  };

  const isSaved = source === "saved";
  const speechStatusLabel = speaking
    ? speechProgress
      ? (rtl ? `■ إيقاف (${speechProgress.index}/${speechProgress.total})` : `■ Stop (${speechProgress.index}/${speechProgress.total})`)
      : (rtl ? "■ إيقاف" : "■ Stop")
    : (rtl ? "▶ اقرأ الصفحة الحالية" : "▶ Read current page");
  const speechFooterLabel = speaking
    ? speechProgress
      ? (rtl ? `■ إيقاف (${speechProgress.index}/${speechProgress.total})` : `■ Stop (${speechProgress.index}/${speechProgress.total})`)
      : (rtl ? "■ إيقاف" : "■ Stop")
    : (rtl ? "▶ استمع لهذه الصفحة" : "▶ Listen to this page");

  return <div className="page source-reader-page">
    <header className="page-title"><div><span>{rtl ? "القارئ والصوت المجاني — V0.7.3-candidate" : "Free reader & device voice — V0.7.3-candidate"}</span><h2>{isSaved ? (rtl ? "كتاب من مكتبتك" : "A book from your library") : (rtl ? "قارئ الكتب متعدد اللغات" : "Multilingual book reader")}</h2><p>{rtl ? "اعرض الكتاب واقرأ صفحته بصوت جهازك بلا OpenAI وبلا تكلفة API." : "View your book and hear each page through your device voice—no OpenAI call or API charge."}</p></div>{activeUrl && <button className="secondary" onClick={close}>{isSaved ? (rtl ? "العودة إلى الكتاب" : "Back to the book") : (rtl ? "إغلاق الكتاب" : "Close book")}</button>}</header>

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
      <div className="reader-safety"><b>✓ {rtl ? "مجاني وخاص" : "Free and private"}</b><span>{rtl ? "صوت الجهاز يقرأ النص الأصلي فقط؛ لا يلخص ولا يترجم ولا يرسل الكتاب إلى خدمة خارجية." : "Device speech reads the original text only; it does not summarize, translate, or send the book to an external service."}</span></div>
    </section> : <section className={`reader-shell theme-${theme}`} dir={effectiveRtl ? "rtl" : "ltr"}>
      <header className="reader-toolbar">
        <button className="reader-icon" onClick={() => setNavigatorOpen(!navigatorOpen)} title={rtl ? "التنقل والعلامات" : "Navigation and bookmarks"}>☰</button>
        <div className="reader-file-name"><i>▤</i><div><strong>{fileName}</strong><span>{isSaved ? (rtl ? "من مكتبتك — محفوظ في مساحتك الخاصة" : "From your library — saved in your private space") : (rtl ? "ملف محلي — لم يُرفع" : "Local file — not uploaded")}</span></div></div>
        <div className="reader-modes" role="group" aria-label={rtl ? "طريقة العرض" : "View mode"}>
          <button className={viewMode === "native" ? "active" : ""} onClick={() => setViewMode("native")}>✓ {rtl ? "مطابق للأصل" : "Original"}</button>
          <button className={viewMode === "book" ? "active" : ""} disabled={!document} onClick={chooseBookMode}>{rtl ? "وضع الكتاب" : "Book mode"}</button>
        </div>
        <div className="reader-tools">
          {viewMode === "book" && <><button onClick={() => setScale(Math.max(.65, scale - .15))} title={rtl ? "تصغير" : "Zoom out"}>−</button><span>{Math.round(scale * 100)}%</span><button onClick={() => setScale(Math.min(2.1, scale + .15))} title={rtl ? "تكبير" : "Zoom in"}>＋</button><button className={bookmarks.includes(page) ? "selected" : ""} onClick={toggleBookmark} title={rtl ? "علامة الصفحة" : "Bookmark"}>⌑</button></>}
          <button onClick={() => setSettingsOpen(!settingsOpen)} title={rtl ? "إعدادات القارئ" : "Reader settings"}>⚙</button>
          <button onClick={() => stageRef.current?.requestFullscreen().catch(() => undefined)} title={rtl ? "ملء الشاشة" : "Full screen"}>⛶</button>
        </div>
      </header>

      {settingsOpen && <aside className="reader-options">
        <div><b>{rtl ? "بيئة القراءة" : "Reading scene"}</b><div className="option-row themes">{(["linen","paper","library","night"] as Theme[]).map(item => <button key={item} className={theme === item ? "active" : ""} onClick={() => setTheme(item)}>{rtl ? ({linen:"هادئة",paper:"ورق",library:"مكتبة",night:"ليل"} as Record<Theme,string>)[item] : item}</button>)}</div></div>
        <div><b>{rtl ? "اتجاه الكتاب" : "Book direction"}</b><div className="option-row">{(["auto","rtl","ltr"] as Direction[]).map(item => <button key={item} className={direction === item ? "active" : ""} onClick={() => setDirection(item)}>{item === "auto" ? (rtl ? "تلقائي" : "Auto") : item.toUpperCase()}</button>)}</div></div>
        <div><b>{rtl ? "سرعة التقليب" : "Turn speed"}</b><div className="option-row">{(["slow","normal","fast"] as Speed[]).map(item => <button key={item} className={speed === item ? "active" : ""} onClick={() => setSpeed(item)}>{rtl ? ({slow:"هادئ",normal:"طبيعي",fast:"سريع"} as Record<Speed,string>)[item] : item}</button>)}</div></div>
        <div><b>{rtl ? "صوت الجهاز — مجاني" : "Device voice — free"}</b><div className="option-row"><select value={speechLanguage} onChange={e=>setSpeechLanguage(e.target.value as "auto"|"ar-SA"|"en-US")}><option value="auto">{rtl?"تلقائي حسب نص الصفحة":"Auto-detect page"}</option><option value="ar-SA">العربية</option><option value="en-US">English</option></select><select value={selectedVoiceURI} onChange={e=>setSelectedVoiceURI(e.target.value)}><option value="">{rtl?"اختيار الصوت تلقائيًا":"Choose voice automatically"}</option>{voices.map((voice)=><option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} — {voice.lang}</option>)}</select><select value={speechRate} onChange={e=>setSpeechRate(Number(e.target.value))}><option value="0.8">0.8×</option><option value="1">1×</option><option value="1.2">1.2×</option></select><button className={speaking?"active":""} disabled={!document||viewMode!=="book"||compatibility!=="passed"} onClick={speakPage}>{speechStatusLabel}</button></div><small>{viewMode!=="book"?(rtl?"انتقل إلى وضع الكتاب أولًا حتى يتزامن الصوت مع رقم الصفحة.":"Switch to Book mode first so speech follows the current page."):(rtl?`${voices.length} صوتًا متاحًا على الجهاز؛ اختر الصوت العربي إن ظهر هنا.`:`${voices.length} device voices available; select an Arabic voice here if listed.`)}</small></div>
        <div><b>{rtl ? "مؤثرات القراءة" : "Reading sounds"}</b><div className="option-row"><button className={sound ? "active" : ""} onClick={() => setSound(!sound)}>{rtl ? "صوت الورق" : "Page sound"}</button><label className="audio-picker"><input type="file" accept="audio/*" onChange={chooseAmbient}/>{rtl ? "اختر صوتًا خلفيًا" : "Choose ambience"}</label>{ambientUrl && <button className={ambientOn ? "active" : ""} onClick={() => setAmbientOn(!ambientOn)}>{ambientOn ? "❚❚" : "▶"} {ambientName.slice(0,18)}</button>}</div></div>
        <audio ref={audioRef} src={ambientUrl} loop />
      </aside>}

      {navigatorOpen && document && <aside className="reader-navigator"><header><b>{rtl ? "التنقل في الكتاب" : "Book navigation"}</b><button onClick={() => setNavigatorOpen(false)}>×</button></header><div className="jump-grid">{Array.from({length: document.numPages}, (_, index) => index + 1).map(number => <button key={number} className={`${number === page ? "current" : ""} ${bookmarks.includes(number) ? "marked" : ""}`} onClick={() => { setPage(number); setNavigatorOpen(false); }}>{number}</button>)}</div><p>{rtl ? `علاماتك: ${bookmarks.length ? bookmarks.join("، ") : "لا توجد بعد"}` : `Bookmarks: ${bookmarks.length ? bookmarks.join(", ") : "none yet"}`}</p></aside>}

      {viewMode === "native" ? <div className="native-reader-stage" ref={stageRef}>
        <div className="fidelity-note">✓ {rtl ? "العرض الأصلي مرجع بصري فقط. للصوت المتزامن استخدم وضع الكتاب." : "Original view is the visual reference only. Use Book mode for synchronized speech."}<button onClick={chooseBookMode}>{rtl?"انتقل إلى وضع الكتاب والصوت":"Switch to Book mode & speech"}</button></div>
        <iframe title={fileName} src={`${activeUrl}#view=FitH&toolbar=1&navpanes=0`} />
      </div> : document ? <><div className="reader-stage" ref={stageRef} style={{"--turn-duration": `${speedMs[speed]}ms`} as React.CSSProperties}>
        <button className="page-arrow previous" onClick={() => turn(-1)} disabled={page === 1 || compatibility !== "passed"} aria-label={rtl ? "الصفحة السابقة" : "Previous page"}>‹</button>
        <div className="book-bed"><div className={`paper-page ${turning}`}><canvas ref={canvasRef}/><span className="page-number">{page}</span><span className="paper-shine"/></div></div>
        <button className="page-arrow next" onClick={() => turn(1)} disabled={page === document.numPages || compatibility !== "passed"} aria-label={rtl ? "الصفحة التالية" : "Next page"}>›</button>
        {compatibility === "untested" && <div className="compatibility-gate"><span>{rtl ? "اختبار سلامة النص" : "Text fidelity check"}</span><h3>{rtl ? "هل هذه الصفحة مطابقة للنص في العرض الأصلي؟" : "Does this page match the Original view?"}</h3><p>{rtl ? "افحص اتصال الحروف، ترتيب الكلمات، الأرقام، والخطوط اللاتينية. لن يعمل التقليب قبل إجابتك." : "Check character rendering, word order, numbers, and mixed-language text. Page turning stays locked until you confirm."}</p><div><button className="approve" onClick={approveCompatibility}>✓ {rtl ? "نعم، الصفحة صحيحة" : "Yes, it matches"}</button><button className="reject" onClick={rejectCompatibility}>× {rtl ? "لا، يوجد تشويه" : "No, text is distorted"}</button></div></div>}
      </div>
      <footer className="reader-footer"><button onClick={() => turn(-1)} disabled={page === 1 || compatibility !== "passed"}>{rtl ? "السابق" : "Previous"}</button><div><input type="range" min="1" max={document.numPages} value={page} disabled={compatibility !== "passed"} onChange={e => setPage(Number(e.target.value))}/><span>{rtl ? `الصفحة ${page} من ${document.numPages}` : `Page ${page} of ${document.numPages}`}</span></div><button className="speak-current" onClick={speakPage} disabled={compatibility!=="passed"}>{speechFooterLabel}</button><button onClick={() => turn(1)} disabled={page === document.numPages || compatibility !== "passed"}>{rtl ? "التالي" : "Next"}</button></footer></> : null}
      {error && <div className="reader-error inline">{error}</div>}
      {scanningForText && <div className="text-page-hint">{rtl ? "جارٍ البحث عن أقرب صفحة نصية…" : "Looking for the nearest text page…"}</div>}
      {suggestedTextPage !== null && (
        <div className="text-page-hint">
          <span>{rtl ? `أقرب صفحة فيها نص: ${suggestedTextPage}` : `Nearest page with text: ${suggestedTextPage}`}</span>
          <button className="secondary" onClick={jumpToSuggestedTextPage}>{rtl ? "انتقل إليها" : "Jump there"}</button>
        </div>
      )}
      <div className="local-proof">◆ {isSaved ? (rtl ? "يُحفظ رقم الصفحة والعلامات في مكتبتك؛ لا يُعاد رفع ملف الكتاب — هو محفوظ أصلًا في مساحتك الخاصة." : "Page position and bookmarks are saved to your library; the book file itself is not re-uploaded — it is already stored in your private space.") : (rtl ? "يُحفظ رقم الصفحة والعلامات فقط على هذا الجهاز؛ ملف الكتاب والصوت الخلفي غير محفوظين في المنصة." : "Only page position and bookmarks are stored on this device; book and ambience files are not stored.")}</div>
    </section>}

    <section className="milestone-board panel"><div><span>{rtl ? "يعمل الآن" : "Working now"}</span><strong>{rtl ? "العرض الأصلي + صوت الجهاز" : "Original view + device voice"}</strong><p>{rtl ? "قراءة مجانية بالعربية أو الإنجليزية بحسب أصوات الجهاز." : "Free Arabic or English speech using installed device voices."}</p></div><div><span>{rtl ? "حاجز جودة" : "Quality gate"}</span><strong>{rtl ? "اختبار بصري قبل التقليب" : "Visual check before turning"}</strong><p>{rtl ? "الفشل يعيد الملف للأصل ولا يعتمد التشويه." : "Failure returns to Original view and rejects distorted text."}</p></div><div><span>{rtl ? "حدود المجاني" : "Free-mode limits"}</span><strong>{rtl ? "النص الأصلي فقط" : "Original text only"}</strong><p>{rtl ? "الترجمة والتلخيص والصوت الاحترافي خدمات AI اختيارية منفصلة." : "Translation, summaries, and professional voice are separate optional AI services."}</p></div></section>
  </div>;
}
