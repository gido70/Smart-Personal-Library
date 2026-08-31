import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import Reader, { type SavedBookRef } from "./Reader";
import {
  getBookResults,
  getAiLimitsSnapshot,
  getLibraryStats,
  getLegalConsentStatus,
  getPaidTaskReceipt,
  getPrivateAudioUrl,
  archivePilotBook,
  downloadBookFile,
  deletePilotBook,
  groupDuplicateBooks,
  invokeBookAI,
  listPilotBooks,
  rollbackPilotBook,
  saveFeedback,
  saveLegalConsent,
  saveManualImport,
  uploadPilotBook,
  updateBookCatalogMetadata,
  updateBookClassification,
  restoreArchivedBook,
  saveCoverThumbnail,
  isBookArchived,
  MAX_ACTIVE_BOOKS,
  type AiLimitsSnapshot,
  type BookClassificationPatch,
  type DuplicateGroup,
  type AiUsageEvent,
  type BookCatalogPatch,
  type OutputLanguage,
  type PilotBook,
  type StoredAnalysis,
  type LibraryStats,
} from "./lib/library";
import { signInLibraryAccount, signOutLibraryAccount, signUpLibraryAccount, supabase, supabaseConfigured } from "./lib/supabase";
import { PAID_PILOT_MAX_BOOKS, ZERO_COST_MODE } from "./lib/config";
import { runLocalStructuralAnalysis, type LocalAnalysisProgress } from "./lib/localAnalysis";
import { searchInsideBook, validateManualImport, type BookSearchMatch, type LocalStructuralAnalysis, type ManualImportPayload } from "./lib/textAnalysis";
import { calculateLoggedTextCost } from "./lib/openAiCost";
import {
  disableBookReminder,
  enablePushForThisDevice,
  listBookReminders,
  saveBookReminder,
  showReminderTest,
  type BookReminder,
} from "./lib/reminders";

type Lang = "ar" | "en";
type ProfessionalVoice = "marin" | "cedar" | "coral" | "onyx" | "nova" | "sage";
const PROFESSIONAL_VOICES: ProfessionalVoice[] = ["marin", "cedar", "coral", "onyx", "nova", "sage"];
const isProfessionalVoice = (value: unknown): value is ProfessionalVoice =>
  PROFESSIONAL_VOICES.includes(value as ProfessionalVoice);
const TTS_CHUNK_MAX_CHARACTERS = 3900;
const splitTextForSpeech = (text: string, limit = TTS_CHUNK_MAX_CHARACTERS) => {
  const chunks: string[] = [];
  let current = "";
  for (const rawSentence of text.split(/(?<=[.!؟?])\s+/u)) {
    let remaining = rawSentence.trim();
    while (remaining) {
      const separator = current ? 1 : 0;
      const room = limit - current.length - separator;
      if (room <= 0) {
        chunks.push(current);
        current = "";
        continue;
      }
      if (remaining.length <= room) {
        current += `${current ? " " : ""}${remaining}`;
        remaining = "";
        continue;
      }
      let cut = remaining.lastIndexOf(" ", room);
      if (cut < Math.floor(room * 0.6)) cut = room;
      current += `${current ? " " : ""}${remaining.slice(0, cut).trim()}`;
      if (current) chunks.push(current);
      current = "";
      remaining = remaining.slice(cut).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks;
};
const voiceLabel = (voice: ProfessionalVoice, rtl: boolean) => {
  const recommended = voice === "marin" || voice === "cedar";
  const name = `${voice[0].toUpperCase()}${voice.slice(1)}`;
  return `${name}${recommended ? (rtl ? " — موصى به" : " — recommended") : (rtl ? " — بديل للاختبار" : " — alternative")}`;
};
const audioPartCount = (results: Record<string, unknown> | null) => {
  const overview = results?.overview as Record<string, unknown> | undefined;
  const spoken = String(overview?.summary ?? results?.summary ?? "").slice(0, 24000);
  if (!spoken) return 0;
  return Math.min(splitTextForSpeech(spoken).length, 8);
};
type View =
  | "home"
  | "library"
  | "book"
  | "pilot"
  | "reader"
  | "progress"
  | "librarian"
  | "feedback"
  | "guide";

const text = {
  ar: {
    name: "المكتبة الشخصية الذكية",
    version: "حساب المكتبة الموحد — V0.10.4",
    search: "ابحث بالعنوان أو المؤلف أو الناشر أو الموضوع أو التصنيف…",
    hello: "صباح المعرفة، عبدالرحمن",
    intro:
      "مكتبتك لا تختصر الكتاب بدلًا عنك؛ بل تمنحك خريطته وتعيدك إلى المواضع التي تستحق القراءة.",
    add: "أضف كتابًا",
    continue: "واصل القراءة",
    books: "الكتب",
    ready: "جاهز للتحليل",
    minutes: "دقيقة استماع",
    streak: "أيام متتالية",
    current: "تابع من حيث توقفت",
    suggestion: "أمين مكتبتك يقترح",
    myLibrary: "مكتبتي",
    all: "عرض كل الكتب",
    journey: "رحلة كتابك",
    uploadTitle: "أضف كتابًا إلى مكتبتك",
    uploadSub: "الملف يبقى خاصًا، ولن يُنشر أو يُشارك مع مستخدم آخر.",
    choose: "اختر PDF",
    rights1:
      "أقرّ أنني أملك حق استخدام هذا الملف أو لدي تصريح بمعالجته للاستخدام الشخصي.",
    rights2:
      "أفهم أن المنصة لا تسمح بنشر الكتاب أو إنشاء قراءة حرفية كاملة لعمل محمي.",
    start: "احفظ الكتاب في مكتبتي",
    cancel: "إلغاء",
    journal: "سجل التجربة",
    journalSub:
      "ملاحظاتك هنا تساعدنا في تطوير المنتج وصياغة الدراسة العلمية لاحقًا.",
  },
  en: {
    name: "Smart Personal Library",
    version: "Unified library account — V0.10.4",
    search: "Search by title, author, publisher, topic, or category…",
    hello: "Good morning, Abdel Rahman",
    intro:
      "Your library does not replace the book. It maps it, then leads you back to the passages worth reading.",
    add: "Add a book",
    continue: "Continue reading",
    books: "Books",
    ready: "Ready to explore",
    minutes: "Minutes listened",
    streak: "Day streak",
    current: "Continue where you stopped",
    suggestion: "Your librarian suggests",
    myLibrary: "My library",
    all: "View all books",
    journey: "Your book journey",
    uploadTitle: "Add a book to your library",
    uploadSub:
      "Your file stays private and is never published or shared with another user.",
    choose: "Choose PDF",
    rights1:
      "I confirm that I own this file or have permission to process it for personal use.",
    rights2:
      "I understand that the platform does not allow publishing the book or generating a full verbatim narration of a protected work.",
    start: "Save book to my library",
    cancel: "Cancel",
    journal: "Experience journal",
    journalSub:
      "Your notes will guide product improvements and the future academic study.",
  },
};

const navigation = {
  ar: [
    ["home", "الرئيسية", "⌂"],
    ["library", "مكتبتي", "▥"],
    ["reader", "القارئ والصوت المجاني", "◫"],
    ["upload", "أضف كتابًا", "＋"],
    ["progress", "التقدم والتنبيهات", "🔔"],
    ["librarian", "أمين المكتبة", "✦"],
    ["feedback", "سجل التجربة", "✎"],
    ["guide", "دليل الاستخدام", "؟"],
  ],
  en: [
    ["home", "Home", "⌂"],
    ["library", "My library", "▥"],
    ["reader", "Free reader & voice", "◫"],
    ["upload", "Add a book", "＋"],
    ["progress", "Progress & alerts", "🔔"],
    ["librarian", "Library assistant", "✦"],
    ["feedback", "Research journal", "✎"],
    ["guide", "User guide", "?"],
  ],
} as const;

function describeReminderError(error: unknown, rtl: boolean) {
  const value = error as { message?: string } | null;
  const raw = value?.message ?? String(error ?? "");
  const messages: Record<string, [string, string]> = {
    V0103_REMINDER_MIGRATION_REQUIRED: ["التنبيهات جاهزة في V0.10.3 لكنها تحتاج تطبيق Migration المراجع أولًا.", "V0.10.3 reminders need the reviewed migration first."],
    VAPID_NOT_CONFIGURED: ["مفاتيح التنبيهات لم تُجهّز بعد.", "Push notification keys are not configured yet."],
    IOS_HOME_SCREEN_REQUIRED: ["على iPhone: أضف المكتبة إلى الشاشة الرئيسية وافتحها كتطبيق، ثم فعّل التنبيهات.", "On iPhone, add the library to the Home Screen, open it as an app, then enable notifications."],
    PUSH_PERMISSION_DENIED: ["لم يسمح الجهاز بالتنبيهات.", "This device did not allow notifications."],
    PUSH_UNSUPPORTED: ["هذا المتصفح لا يدعم التنبيهات المطلوبة.", "This browser does not support the required notifications."],
    REMINDER_TIME_INVALID: ["اختر وقتًا مستقبليًا صحيحًا.", "Choose a valid future time."],
  };
  const found = Object.entries(messages).find(([key]) => raw.includes(key));
  return found ? found[1][rtl ? 0 : 1] : raw || (rtl ? "تعذر تنفيذ التنبيه." : "The reminder could not be completed.");
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("ar");
  const [dark, setDark] = useState(false);
  const [view, setView] = useState<View>("home");
  const [upload, setUpload] = useState(false);
  const [rights1, setRights1] = useState(false);
  const [rights2, setRights2] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("ar");
  const [pilotBooks, setPilotBooks] = useState<PilotBook[]>([]);
  const [libraryStats, setLibraryStats] = useState<LibraryStats>({ analysedBooks: 0, questions: 0, audioParts: 0 });
  const [booksLoading, setBooksLoading] = useState(true);
  const [booksError, setBooksError] = useState("");
  const [booksLoadToken, setBooksLoadToken] = useState(0);
  const libraryRefreshTimerRef = useRef<number | null>(null);
  const [browserCacheReady, setBrowserCacheReady] = useState(false);
  const [activePilotBook, setActivePilotBook] = useState<PilotBook | null>(
    null,
  );
  const [readerBook, setReaderBook] = useState<SavedBookRef | null>(null);
  const [processing, setProcessing] = useState(false);
  const [percent, setPercent] = useState(0);
  const [notice, setNotice] = useState("");
  const [activating, setActivating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [authState, setAuthState] = useState<"loading" | "signed_out" | "authenticated">("loading");
  const [accountEmail, setAccountEmail] = useState("");
  const [reminderCount, setReminderCount] = useState(0);
  const t = text[lang];
  const rtl = lang === "ar";
  useEffect(() => {
    const saved = localStorage.getItem("spl-lang");
    if (saved === "ar" || saved === "en") setLang(saved);
  }, []);
  useEffect(() => {
    const client = supabase;
    if (!client) {
      setAuthState("signed_out");
      return;
    }
    const applySession = (session: Awaited<ReturnType<typeof client.auth.getSession>>["data"]["session"]) => {
      const permanent = Boolean(session && !(session.user as { is_anonymous?: boolean }).is_anonymous);
      setAuthState(permanent ? "authenticated" : "signed_out");
      setAccountEmail(permanent ? session?.user.email ?? "" : "");
      if (!permanent) {
        setPilotBooks([]);
        setLibraryStats({ analysedBooks: 0, questions: 0, audioParts: 0 });
      }
    };
    client.auth.getSession().then(({ data }) => applySession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, session) => applySession(session));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const prepareCurrentWorker = async () => {
      if (!("serviceWorker" in navigator)) {
        if (!cancelled) setBrowserCacheReady(true);
        return;
      }
      if (sessionStorage.getItem("spl-worker-prepared-v0103-3") !== "1") {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const cacheNames = "caches" in window ? await caches.keys() : [];
        await Promise.all([
          ...registrations.map((registration) => registration.unregister()),
          ...cacheNames
            .filter((name) => name.startsWith("smart-personal-library-"))
            .map((name) => caches.delete(name)),
        ]);
        sessionStorage.setItem("spl-worker-prepared-v0103-3", "1");
      }
      await navigator.serviceWorker.register("./sw.js");
      if (!cancelled) setBrowserCacheReady(true);
    };
    prepareCurrentWorker().catch(() => {
      if (!cancelled) setBrowserCacheReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const requestedBook = new URLSearchParams(window.location.search).get("book");
    if (!requestedBook || pilotBooks.length === 0) return;
    const book = pilotBooks.find((item) => item.id === requestedBook);
    if (book) {
      setActivePilotBook(book);
      setView("pilot");
    }
  }, [pilotBooks]);
  useEffect(() => {
    if (!browserCacheReady || authState !== "authenticated") return;
    if (!supabaseConfigured) {
      setBooksLoading(false);
      return;
    }
    let cancelled = false;
    setBooksLoading(true);
    // Keep the last confirmed shelf visible while Supabase is revalidated.
    // Clearing it here made every focus/visibility refresh look as though the
    // user's books had disappeared, especially on slower mobile connections.
    setBooksError("");
    listPilotBooks()
      .then(async (books) => {
        if (cancelled) return;
        setPilotBooks(books);
        // Statistics are secondary. A missing optional table must never hide
        // the user's books or make the library appear empty.
        const stats = await getLibraryStats().catch(() => null);
        if (!cancelled && stats) setLibraryStats(stats);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setBooksError(
          rtl
            ? `تعذر تحميل مكتبتك: ${loadError instanceof Error ? loadError.message : "خطأ غير معروف"}`
            : `Could not load your library: ${loadError instanceof Error ? loadError.message : "Unknown error"}`,
        );
      })
      .finally(() => {
        if (!cancelled) setBooksLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booksLoadToken, browserCacheReady, authState]);
  useEffect(() => {
    if (authState !== "authenticated") return;
    listBookReminders()
      .then((items) => setReminderCount(items.length))
      .catch(() => setReminderCount(0));
  }, [authState, booksLoadToken, view]);
  useEffect(() => {
    const refreshFromSupabase = () => {
      // focus, pageshow and visibilitychange commonly fire together on mobile.
      // Coalesce that burst into one read so older requests cannot make the
      // knowledge shelf flicker between empty and populated states.
      if (libraryRefreshTimerRef.current !== null) window.clearTimeout(libraryRefreshTimerRef.current);
      libraryRefreshTimerRef.current = window.setTimeout(() => {
        libraryRefreshTimerRef.current = null;
        setBooksLoadToken((n) => n + 1);
      }, 250);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshFromSupabase();
    };
    // Mobile Chrome and Safari may restore a complete React page from the
    // back-forward cache. Revalidate the library whenever that page becomes
    // active instead of trusting the restored in-memory list.
    window.addEventListener("pageshow", refreshFromSupabase);
    window.addEventListener("focus", refreshFromSupabase);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      if (libraryRefreshTimerRef.current !== null) window.clearTimeout(libraryRefreshTimerRef.current);
      window.removeEventListener("pageshow", refreshFromSupabase);
      window.removeEventListener("focus", refreshFromSupabase);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);
  const reloadPilotBooks = () => setBooksLoadToken((n) => n + 1);
  const patchPilotBook = (bookId: string, patch: Partial<PilotBook>) => {
    setPilotBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, ...patch } : b)));
    setActivePilotBook((prev) => (prev && prev.id === bookId ? { ...prev, ...patch } : prev));
  };
  const switchLang = () => {
    const next = lang === "ar" ? "en" : "ar";
    setLang(next);
    localStorage.setItem("spl-lang", next);
  };
  const activateLatestVersion = async () => {
    setActivating(true);
    setNotice(rtl ? "جارٍ تنشيط أحدث نسخة…" : "Activating the latest version…");
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith("smart-personal-library-")).map((name) => caches.delete(name)));
      }
      sessionStorage.removeItem("spl-worker-prepared-v0103-3");
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.set("refresh", Date.now().toString());
      window.location.replace(cleanUrl.toString());
    } catch {
      window.location.reload();
    }
  };
  const pageTitle = useMemo(
    () => navigation[lang].find((x) => x[0] === view)?.[1] || t.name,
    [lang, view, t.name],
  );
  const openReaderFor = (book: PilotBook, initialPage?: number) => {
    setReaderBook({ id: book.id, title: book.title, storagePath: book.storage_path, initialPage });
    setView("reader");
  };
  const openReaderStandalone = () => {
    setReaderBook(null);
    setView("reader");
  };
  const startProcessing = async () => {
    if (!file || !rights1 || !rights2) return;
    if (!supabaseConfigured) {
      setNotice(
        rtl
          ? "لم تُضف إعدادات Supabase إلى بيئة النشر بعد."
          : "Supabase deployment settings are missing.",
      );
      return;
    }
    setProcessing(true);
    setPercent(12);
    try {
      setPercent(35);
      const { book, deduped } = await uploadPilotBook(file, outputLanguage);
      setPercent(75);
      if (deduped) {
        const consent = await getLegalConsentStatus(book.id);
        if (!consent.recorded) await saveLegalConsent(book.id, rights1, rights2);
      } else {
        try {
          await saveLegalConsent(book.id, rights1, rights2);
        } catch (consentError) {
          await rollbackPilotBook(book);
          throw consentError;
        }
      }
      setPercent(100);
      const all = await listPilotBooks();
      const refreshed = all.find((item) => item.id === book.id) ?? book;
      setPilotBooks(all);
      setActivePilotBook(refreshed);
      setUpload(false);
      setView("pilot");
      setNotice(
        deduped
          ? rtl
            ? "هذا الكتاب موجود بالفعل في مكتبتك — فتحنا نسختك المحفوظة دون رفع نسخة ثانية."
            : "This book is already in your library — opened your saved copy instead of uploading a duplicate."
          : rtl
            ? "حُفظ الكتاب فقط. لم يُرسل إلى OpenAI ولم يُخصم من رصيدك."
            : "Book saved only. Nothing was sent to OpenAI and no API credit was used.",
      );
      setFile(null);
      setRights1(false);
      setRights2(false);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Unknown error";
      const friendly = raw === "FILE_TOO_LARGE_30MB"
        ? (rtl ? "الحد الأقصى 30 ميجابايت. أوقفنا الرفع قبل حفظ الملف أو تشغيل أي خدمة مدفوعة." : "The limit is 30 MB. Upload stopped before saving or starting any paid service.")
        : raw === "ACTIVE_BOOK_LIMIT_REACHED"
          ? (rtl ? "لديك ستة كتب نشطة. انقل كتابًا إلى الأرشيف أولًا؛ لن يُرفع الملف ولن يُخصم شيء." : "You already have six active books. Archive one first; nothing was uploaded or charged.")
        : raw === "TOO_MANY_PAGES_500"
          ? (rtl ? "الحد الأقصى 500 صفحة في نسخة القبول الحالية." : "The current acceptance build supports up to 500 pages.")
        : raw === "PDF_ONLY"
          ? (rtl ? "هذه التجربة تقبل ملف PDF فقط." : "This pilot accepts PDF files only.")
          : raw;
      setNotice(
        `${rtl ? "تعذر حفظ الكتاب" : "Could not save the book"}: ${friendly}`,
      );
    } finally {
      setProcessing(false);
      setTimeout(() => setNotice(""), 7000);
    }
  };
  const openUpload = () => {
    const activeCount = pilotBooks.filter((book) => !isBookArchived(book)).length;
    if (activeCount >= MAX_ACTIVE_BOOKS) {
      setView("library");
      setNotice(
        rtl
          ? "اكتمل رفك النشط بستة كتب. انقل كتابًا إلى الأرشيف أولًا لإضافة كتاب جديد؛ لن يُرفع شيء ولن يُخصم شيء."
          : "Your active shelf is full with six books. Archive one before adding another; nothing will be uploaded or charged.",
      );
      setTimeout(() => setNotice(""), 7000);
      return;
    }
    setUpload(true);
  };
  const go = (id: string) => {
    if (id === "upload") {
      openUpload();
    } else if (id === "reader") {
      openReaderStandalone();
    } else {
      setView(id as View);
    }
  };
  if (authState !== "authenticated") {
    return (
      <LibraryLogin
        rtl={rtl}
        loading={authState === "loading"}
        onLanguage={switchLang}
        onSignedIn={() => setAuthState("authenticated")}
      />
    );
  }
  return (
    <div
      className={dark ? "app dark" : "app"}
      dir={rtl ? "rtl" : "ltr"}
      lang={lang}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">ك</div>
          <div>
            <h1>{t.name}</h1>
            <span>{t.version}</span>
          </div>
        </div>
        <nav className="main-nav">
          {navigation[lang].map(([id, label, icon]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              disabled={id === "librarian"}
              title={id === "librarian" ? (rtl ? "غير معتمد بعد في نسخة القبول" : "Not yet accepted in this build") : undefined}
              onClick={() => go(id)}
            >
              <i>{icon}</i>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="prototype-note">
          <strong>
            {rtl ? "حساب موحد وآمن V0.10.4" : "Secure unified account V0.10.4"}
          </strong>
          <p>
            {rtl
              ? "مكتبتك قابلة للنمو. لا يبدأ التحليل أو السؤال أو الصوت الاحترافي إلا بعد تأكيدك."
              : "Your library can grow. Analysis, questions, and professional audio start only after your confirmation."}
          </p>
        </div>
        <div className="profile">
          <span>ع</span>
          <div>
            <strong>{accountEmail || (rtl ? "حساب المكتبة" : "Library account")}</strong>
            <small>{rtl ? "محفوظ على أجهزتك" : "Synced across your devices"}</small>
          </div>
          <button onClick={() => signOutLibraryAccount()} title={rtl ? "تسجيل الخروج" : "Sign out"}>↪</button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button className="mobile-brand" onClick={() => setView("home")}>
            ك
          </button>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (searchQuery.trim()) setView("library");
            }}
          >
            <input
              placeholder={t.search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="submit" aria-label={rtl ? "تنفيذ البحث" : "Run search"} title={rtl ? "بحث" : "Search"}>⌕</button>
          </form>
          <div className="top-actions">
            <button className="desktop-utility" onClick={() => setView("guide")} title={rtl ? "دليل الاستخدام" : "User guide"}>؟</button>
            <button className="desktop-utility" onClick={activateLatestVersion} disabled={activating} title={rtl ? "تنشيط أحدث نسخة" : "Activate latest version"}>↻</button>
            <button onClick={switchLang} className="lang-switch">
              {rtl ? "EN" : "ع"}
            </button>
            <button className="desktop-utility" onClick={() => setDark(!dark)}>{dark ? "☀" : "◐"}</button>
            <button
              className={`bell ${reminderCount > 0 ? "has-alerts" : ""}`}
              title={rtl ? "التنبيهات" : "Notifications"}
              aria-label={rtl ? `التنبيهات: ${reminderCount}` : `Notifications: ${reminderCount}`}
              onClick={() => setView("progress")}
            >
              🔔
              {reminderCount > 0 && <b>{reminderCount > 9 ? "9+" : reminderCount}</b>}
            </button>
          </div>
        </header>
        {view === "home" && (
          <nav className="mobile-home-toolbar" aria-label={rtl ? "أدوات الصفحة الرئيسية" : "Home page tools"}>
            <button className="tool-home active" aria-current="page" onClick={() => setView("home")}><i>⌂</i><span>{rtl ? "الرئيسية" : "Home"}</span></button>
            <button className="tool-index" onClick={() => setView("library")}><i>▥</i><span>{rtl ? "الدليل" : "Index"}</span></button>
            <button className="tool-guide" onClick={() => setView("guide")}><i>؟</i><span>{rtl ? "دليل الاستخدام" : "User guide"}</span></button>
            <button className="tool-refresh" onClick={activateLatestVersion} disabled={activating}><i>↻</i><span>{activating ? (rtl ? "جارٍ التنشيط" : "Activating") : (rtl ? "تنشيط الصفحة" : "Refresh page")}</span></button>
            <button className="tool-version" onClick={() => setNotice(rtl ? `النسخة الحالية: ${t.version}` : `Current version: ${t.version}`)}><i>V</i><span>{rtl ? "النسخة" : "Version"}</span></button>
            <button className={`tool-theme ${dark ? "active" : ""}`} aria-pressed={dark} onClick={() => setDark(!dark)}><i>{dark ? "☀" : "◐"}</i><span>{rtl ? "المظهر" : "Appearance"}</span></button>
          </nav>
        )}
        {view === "home" && (
          <Dashboard
            rtl={rtl}
            t={t}
            onUpload={openUpload}
            setView={setView}
            onOpenReader={openReaderStandalone}
            pilotBooks={pilotBooks}
            libraryStats={libraryStats}
            onOpenPilot={(book) => { setActivePilotBook(book); setView("pilot"); }}
          />
        )}
        {view === "library" && (
          <Library
            rtl={rtl}
            title={pageTitle}
            onUpload={openUpload}
            pilotBooks={pilotBooks}
            booksLoading={booksLoading}
            booksError={booksError}
            onRetry={reloadPilotBooks}
            onBooksChanged={reloadPilotBooks}
            searchQuery={searchQuery}
            onOpenPilot={(book) => {
              setActivePilotBook(book);
              setView("pilot");
            }}
          />
        )}
        {view === "book" && (
          <BookDetail rtl={rtl} onBack={() => setView("library")} />
        )}
        {view === "pilot" && activePilotBook && (
          <PilotWorkspace
            rtl={rtl}
            book={activePilotBook}
            onBack={() => setView("library")}
            onOpenReader={(page) => openReaderFor(activePilotBook, page)}
            onReuploadOriginal={openUpload}
            onBookPatched={patchPilotBook}
          />
        )}
        {view === "reader" && (
          <Reader
            rtl={rtl}
            savedBook={readerBook}
            onExitSavedBook={() => {
              setReaderBook(null);
              setView(activePilotBook ? "pilot" : "library");
            }}
          />
        )}
        {view === "progress" && <Progress rtl={rtl} title={pageTitle} books={pilotBooks.filter((book) => !isBookArchived(book))} />}
        {view === "librarian" && <Librarian rtl={rtl} title={pageTitle} />}
        {view === "feedback" && <Feedback rtl={rtl} t={t} />}
        {view === "guide" && <UserGuide rtl={rtl} onUpload={openUpload} onLibrary={() => setView("library")} onActivate={activateLatestVersion} activating={activating} />}
      </main>
      <nav className="mobile-nav">
        {navigation[lang].slice(0, 5).map(([id, label, icon]) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            onClick={() => go(id)}
          >
            <i>{icon}</i>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {upload && (
        <Upload
          rtl={rtl}
          t={t}
          file={file}
          setFile={setFile}
          outputLanguage={outputLanguage}
          setOutputLanguage={setOutputLanguage}
          rights1={rights1}
          rights2={rights2}
          setRights1={setRights1}
          setRights2={setRights2}
          processing={processing}
          percent={percent}
          close={() => !processing && setUpload(false)}
          start={startProcessing}
        />
      )}
      {notice && <div className="toast">✓ {notice}</div>}
    </div>
  );
}

function LibraryLogin({
  rtl,
  loading,
  onLanguage,
  onSignedIn,
}: {
  rtl: boolean;
  loading: boolean;
  onLanguage: () => void;
  onSignedIn: () => void;
}) {
  const [email, setEmail] = useState("aarahman70@gmail.com");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (mode === "signup") {
        const data = await signUpLibraryAccount(email, password);
        if (data.session) {
          onSignedIn();
        } else {
          setSuccess(rtl ? "تم إنشاء الحساب. افتح رسالة التأكيد في بريدك مرة واحدة، ثم ارجع وسجّل الدخول." : "Account created. Confirm the email once, then return and sign in.");
          setMode("signin");
          setPassword("");
        }
      } else {
        await signInLibraryAccount(email, password);
        onSignedIn();
      }
    } catch (loginError) {
      const raw = loginError instanceof Error ? loginError.message : "LOGIN_FAILED";
      setError(
        raw.toLowerCase().includes("invalid login credentials")
          ? rtl
            ? "البريد أو كلمة المرور غير صحيحة."
            : "Incorrect email or password."
          : raw === "PASSWORD_TOO_SHORT"
            ? rtl
              ? `كلمة المرور يجب ألا تقل عن ${mode === "signup" ? "8" : "6"} أحرف.`
              : `Password must be at least ${mode === "signup" ? "8" : "6"} characters.`
            : raw,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page" dir={rtl ? "rtl" : "ltr"} lang={rtl ? "ar" : "en"}>
      <button className="login-language" onClick={onLanguage}>{rtl ? "EN" : "ع"}</button>
      <section className="login-card">
        <div className="brand-mark">ك</div>
        <span className="eyebrow">{rtl ? "المكتبة الشخصية الذكية" : "Smart Personal Library"}</span>
        <h1>{mode === "signup" ? (rtl ? "أنشئ حساب مكتبتك" : "Create your library account") : (rtl ? "ادخل إلى مكتبتك" : "Sign in to your library")}</h1>
        <p>
          {rtl
            ? "حساب واحد ومكتبة واحدة على كروم وEdge والآيفون وسامسونج والتابلت. سجّل مرة واحدة في كل جهاز، ثم يبقى الدخول محفوظًا."
            : "One account and one library across Chrome, Edge, iPhone, Samsung and tablets. Sign in once per device and the session stays saved."}
        </p>
        {loading ? (
          <div className="login-loading">{rtl ? "جارٍ فحص الحساب…" : "Checking account…"}</div>
        ) : (
          <form onSubmit={submit}>
            <label>
              {rtl ? "البريد الإلكتروني" : "Email"}
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
            </label>
            <label>
              {rtl ? "كلمة المرور" : "Password"}
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 8 : 6} required />
            </label>
            <button className="primary" type="submit" disabled={busy}>
              {busy
                ? mode === "signup" ? (rtl ? "جارٍ إنشاء الحساب…" : "Creating account…") : (rtl ? "جارٍ الدخول…" : "Signing in…")
                : mode === "signup" ? (rtl ? "إنشاء الحساب" : "Create account") : (rtl ? "دخول" : "Sign in")}
            </button>
          </form>
        )}
        {error && <div className="reader-error inline">{error}</div>}
        {success && <div className="login-success">{success}</div>}
        {!loading && (
          <button className="login-mode" type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setSuccess(""); setPassword(""); }}>
            {mode === "signin"
              ? (rtl ? "ليس لديك حساب؟ أنشئ حسابًا" : "No account? Create one")
              : (rtl ? "لديك حساب؟ سجّل الدخول" : "Already have an account? Sign in")}
          </button>
        )}
        <small>{rtl ? "لا تُحفظ كلمة المرور داخل المنصة؛ يحميها Supabase بصورة مشفّرة." : "Your password is protected by Supabase and is never stored in the app."}</small>
      </section>
    </div>
  );
}

function Dashboard({
  rtl,
  t,
  onUpload,
  setView,
  onOpenReader,
  pilotBooks,
  libraryStats,
  onOpenPilot,
}: {
  rtl: boolean;
  t: typeof text.ar;
  onUpload: () => void;
  setView: (v: View) => void;
  onOpenReader: () => void;
  pilotBooks: PilotBook[];
  libraryStats: LibraryStats;
  onOpenPilot: (book: PilotBook) => void;
}) {
  const activePilotBooks = pilotBooks.filter((book) => !isBookArchived(book)).slice(0, MAX_ACTIVE_BOOKS);
  const knowledgeCopies = pilotBooks.filter(isBookArchived);
  const [homeShelf, setHomeShelf] = useState<"active" | "archive">(() => localStorage.getItem("spl-preferred-library-shelf") === "archive" ? "archive" : "active");
  const [mobileLibrarianOpen, setMobileLibrarianOpen] = useState(false);
  const [mobileJourneyOpen, setMobileJourneyOpen] = useState(false);
  const previewBooks = (homeShelf === "active" ? activePilotBooks : knowledgeCopies).slice(0, MAX_ACTIVE_BOOKS);
  const chooseHomeShelf = (nextShelf: "active" | "archive") => {
    setHomeShelf(nextShelf);
    localStorage.setItem("spl-preferred-library-shelf", nextShelf);
  };
  const current = activePilotBooks[0];
  return (
    <div className="page dashboard-page">
      <section className="welcome">
        <div>
          <span className="eyebrow">
            {rtl
              ? "مكتبة تقرأ معك، لا بدلًا عنك"
              : "A library that reads with you, not for you"}
          </span>
          <h2>{t.hello}</h2>
          <p>{t.intro}</p>
          <div className="welcome-actions">
            <button className="primary" onClick={onOpenReader}>
              ◫ {rtl ? "افتح القارئ" : "Open reader"}
            </button>
            <button className="secondary" onClick={onUpload}>
              ＋ {rtl ? "أضف كتابًا" : "Add a book"}
            </button>
            <button className="secondary" onClick={() => setView("library")}>
              ▥ {rtl ? "افتح مكتبتي" : "Open my library"}
            </button>
          </div>
        </div>
        <div className="quote-mark">
          <span>«</span>
          <p>
            {rtl
              ? "افهم خريطة الكتاب، ثم عُد إلى الأصل بوعي."
              : "Understand the map, then return to the source."}
          </p>
        </div>
      </section>
      <section className="metrics">
        <Metric
          icon="▥"
          value={String(pilotBooks.length)}
          label={t.books}
          note={rtl ? "كتبك المحفوظة فعليًا" : "Your actually saved books"}
        />
        <Metric
          icon="✓"
          value={String(libraryStats.analysedBooks)}
          label={t.ready}
          note={rtl ? "كتب لها تحليل AI محفوظ" : "Books with saved AI analysis"}
        />
        <Metric
          icon="◖"
          value={String(libraryStats.questions)}
          label={rtl ? "أسئلة محفوظة" : "Saved questions"}
          note={rtl ? "إجابات مرتبطة بالكتب" : "Book-grounded answers"}
        />
        <Metric
          icon="↗"
          value={String(libraryStats.audioParts)}
          label={rtl ? "مقاطع صوتية" : "Audio parts"}
          note={rtl ? "خلاصات احترافية محفوظة" : "Saved professional summaries"}
        />
      </section>
      <section className="split-grid">
        <article className="panel continue-card">
          <SectionHead
            over={rtl ? "القراءة الحالية" : "Current reading"}
            title={t.current}
          />
          {current ? <div className="current-book">
            <OriginalPdfCover book={current} />
            <div className="book-copy">
              <span className="status">
                {rtl ? "أقرأ الآن" : "In progress"}
              </span>
              <h4>{current.title}</h4>
              <p>{rtl ? "كتاب محفوظ في مكتبتك الخاصة" : "Saved in your private library"}</p>
              <button
                className="primary compact"
                onClick={() => onOpenPilot(current)}
              >
                ▶ {rtl ? "افتح الكتاب ونتائجه" : "Open book & results"}
              </button>
            </div>
          </div> : <p className="disclosure-note">{rtl ? "لم تضف كتابًا حقيقيًا بعد." : "No real book has been added yet."}</p>}
        </article>
        <article className={`panel librarian-card ${mobileLibrarianOpen ? "mobile-expanded" : ""}`}>
          <div className="librarian-icon">✦</div>
          <span className="eyebrow">
            {rtl ? "توصية شخصية" : "Personal recommendation"}
          </span>
          <h3>{t.suggestion}</h3>
          <button className="mobile-section-toggle" onClick={() => setMobileLibrarianOpen((open) => !open)} aria-expanded={mobileLibrarianOpen}>
            {mobileLibrarianOpen ? (rtl ? "إخفاء" : "Hide") : (rtl ? "عرض الاقتراح" : "Show suggestion")}
          </button>
          <div className="mobile-collapsible-content">
            <p>{current
              ? (rtl
                ? `ابدأ بتحليل «${current.title}» ثم اسأل أمين المكتبة عن الأفكار والفصول التي تستحق العودة إلى المصدر.`
                : `Analyze “${current.title}”, then ask the librarian which ideas and chapters deserve a return to the source.`)
              : (rtl ? "أضف أول كتاب حقيقي ليبدأ الاقتراح من بيانات مكتبتك، لا من أمثلة وهمية." : "Add your first real book so recommendations use your library—not placeholder examples.")}</p>
            <div className="source-note">
              <b>{rtl ? "سبب الاقتراح" : "Why this suggestion"}</b>
              <span>
                {rtl
                  ? "يتفعّل من تحليلات كتبك المحفوظة فقط"
                  : "Enabled only from your saved book analyses"}
              </span>
            </div>
            {current && <button className="text-button" onClick={() => onOpenPilot(current)}>
              {rtl ? "حلّل الكتاب واسأله" : "Analyze and ask this book"}
            </button>}
          </div>
        </article>
      </section>
      <section className="panel library-preview">
        <SectionHead
          over={rtl ? "رفوفك الشخصية" : "Your shelves"}
          title={homeShelf === "active" ? (rtl ? "الكتب الأصلية" : "Original books") : (rtl ? "النسخ المعرفية" : "Knowledge copies")}
          action={rtl ? "عرض مكتبتي" : "Open my library"}
          onAction={() => setView("library")}
        />
        <div className="library-shelf-tabs home-shelf-switch" role="group" aria-label={rtl ? "اختيار الرف الظاهر في المقدمة" : "Choose the shelf shown on the home page"}>
          <button className={homeShelf === "active" ? "active" : ""} onClick={() => chooseHomeShelf("active")}>{rtl ? `الكتب الأصلية ${activePilotBooks.length}/${MAX_ACTIVE_BOOKS}` : `Original books ${activePilotBooks.length}/${MAX_ACTIVE_BOOKS}`}</button>
          <button className={homeShelf === "archive" ? "active" : ""} onClick={() => chooseHomeShelf("archive")}>{rtl ? `النسخ المعرفية ${knowledgeCopies.length}` : `Knowledge copies ${knowledgeCopies.length}`}</button>
        </div>
        <p className="home-shelf-explainer">{homeShelf === "active"
          ? (rtl ? "تعرض الكتب الكاملة الموجودة حاليًا، بحد أقصى ستة كتب." : "Shows the complete books currently available, up to six.")
          : (rtl ? "تعرض الكتب الملخّصة المحفوظة بعد أرشفة الأصل؛ افتح أي بطاقة للوصول إلى نتائجها." : "Shows saved summarized books after the original is archived; open a card to access its results.")}</p>
        <div className="book-grid active-book-grid">
          {previewBooks.length > 0
            ? previewBooks.map((book) => (
              <LiveBookCard key={book.id} book={book} rtl={rtl} compact onOpen={() => onOpenPilot(book)} />
            ))
            : homeShelf === "active"
              ? <SampleShelf rtl={rtl} compact />
              : <p className="disclosure-note empty-knowledge-shelf">{rtl ? "لا توجد نسخ معرفية بعد. عند أرشفة كتاب مكتمل سيظهر هنا مع خلاصته وصوته ونتائجه." : "No knowledge copies yet. An archived completed book will appear here with its summary, audio and results."}</p>}
          {homeShelf === "active" && activePilotBooks.length > 0 && activePilotBooks.length < MAX_ACTIVE_BOOKS && (
            <button className="add-book-card" onClick={onUpload}>
              <i>＋</i>
              <strong>{rtl ? "أضف كتابًا جديدًا" : "Add a new book"}</strong>
              <span>{rtl ? `${activePilotBooks.length}/6 كتب نشطة` : `${activePilotBooks.length}/6 active books`}</span>
            </button>
          )}
        </div>
      </section>
      <section className={`journey ${mobileJourneyOpen ? "mobile-expanded" : ""}`}>
        <SectionHead
          over={rtl ? "من الملف إلى المعرفة" : "From file to knowledge"}
          title={t.journey}
        />
        <button className="mobile-section-toggle journey-toggle" onClick={() => setMobileJourneyOpen((open) => !open)} aria-expanded={mobileJourneyOpen}>
          {mobileJourneyOpen ? (rtl ? "إخفاء الخطوات" : "Hide steps") : (rtl ? "عرض الخطوات الخمس" : "Show five steps")}
        </button>
        <div className="steps mobile-collapsible-content">
          {[
            [
              "01",
              "⇧",
              rtl ? "ارفع كتابك" : "Upload",
              rtl ? "ملف PDF خاص بك" : "Your private PDF",
            ],
            [
              "02",
              "⌕",
              rtl ? "تحقق وفهرسة" : "Verify & catalogue",
              rtl ? "حقوق، بيانات وفصول" : "Rights, metadata, chapters",
            ],
            [
              "03",
              "✦",
              rtl ? "فهم وتحليل" : "Understand",
              rtl ? "خلاصة وفصول وتوثيق" : "Summary, chapters, citations",
            ],
            [
              "04",
              "◖",
              rtl ? "استمع واسأل" : "Listen & ask",
              rtl ? "صوت وإجابات من المصدر" : "Audio and grounded answers",
            ],
            [
              "05",
              "↗",
              rtl ? "عُد وتابع" : "Return & continue",
              rtl ? "مواضع قراءة وتنبيهات" : "Reading locations, reminders",
            ],
          ].map(([n, i, h, p]) => (
            <div className="step" key={n}>
              <b>{n}</b>
              <i>{i}</i>
              <h4>{h}</h4>
              <p>{p}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({
  icon,
  value,
  label,
  note,
}: {
  icon: string;
  value: string;
  label: string;
  note: string;
}) {
  return (
    <article className="metric">
      <i>{icon}</i>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        <small>{note}</small>
      </div>
    </article>
  );
}
function SectionHead({
  over,
  title,
  action,
  onAction,
}: {
  over: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-head">
      <div>
        <span>{over}</span>
        <h3>{title}</h3>
      </div>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action} ←
        </button>
      )}
    </div>
  );
}
function Bar({ value }: { value: number }) {
  return (
    <div className="progress">
      <i style={{ width: `${value}%` }} />
    </div>
  );
}
function BookCover({ tone, title }: { tone: string; title: string }) {
  return (
    <div className={`book-cover ${tone}`}>
      <span>المكتبة الذكية</span>
      <strong>{title}</strong>
      <i>◈</i>
    </div>
  );
}
function PageTitle({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <header className="page-title">
      <div>
        <span>المكتبة الشخصية الذكية</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action && (
        <button className="primary" onClick={onAction}>
          ＋ {action}
        </button>
      )}
    </header>
  );
}

const COVER_TONES = ["emerald", "navy", "gold"] as const;

/** Deterministic (title-based) local cover tone — no image, no paid API, same tone every render. */
function coverToneFor(seed: string): (typeof COVER_TONES)[number] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return COVER_TONES[hash % COVER_TONES.length];
}

function languageLabel(lang: string, rtl: boolean): string {
  return lang === "ar"
    ? rtl
      ? "العربية"
      : "Arabic"
    : lang === "en"
      ? rtl
        ? "الإنجليزية"
        : "English"
      : lang === "mixed"
        ? rtl
          ? "مختلطة"
          : "Mixed"
        : lang === "bilingual"
          ? rtl
            ? "ثنائية اللغة"
            : "Bilingual"
          : rtl
            ? "لم تُحدَّد بعد"
            : "Not detected yet";
}

const STATUS_LABELS_AR: Record<PilotBook["status"], string> = {
  uploaded: "محفوظ — بانتظار التحليل المحلي",
  processing: "قيد المعالجة",
  ready: "جاهز",
  failed: "فشل",
};
const STATUS_LABELS_EN: Record<PilotBook["status"], string> = {
  uploaded: "Saved — awaiting local analysis",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

const DEWEY_GATEWAYS = [
  { id: "000", ar: "المعارف العامة وعلوم الحاسوب", en: "Computer science & general works", branches: [["004", "علوم الحاسوب ومعالجة البيانات", "Computer science & data processing"], ["005.8", "أمن المعلومات والأمن السيبراني", "Information & cybersecurity"], ["006.3", "الذكاء الاصطناعي", "Artificial intelligence"], ["020", "علم المكتبات والمعلومات", "Library & information science"], ["070", "الإعلام والصحافة والنشر", "News media & publishing"]] },
  { id: "100", ar: "الفلسفة وعلم النفس", en: "Philosophy & psychology", branches: [["110", "ما وراء الطبيعة", "Metaphysics"], ["130", "الظواهر النفسية", "Parapsychology"], ["150", "علم النفس", "Psychology"], ["170", "الأخلاق", "Ethics"]] },
  { id: "200", ar: "الديانات", en: "Religion", branches: [["210", "فلسفة الدين", "Philosophy of religion"], ["220", "الكتب المقدسة", "Sacred texts"], ["230", "المسيحية", "Christianity"], ["290", "الديانات الأخرى والمقارنة", "Other & comparative religions"]] },
  { id: "300", ar: "العلوم الاجتماعية", en: "Social sciences", branches: [["310", "الإحصاء", "Statistics"], ["320", "العلوم السياسية", "Political science"], ["330", "الاقتصاد", "Economics"], ["340", "القانون", "Law"], ["370", "التعليم", "Education"]] },
  { id: "400", ar: "اللغات", en: "Language", branches: [["410", "اللسانيات", "Linguistics"], ["420", "اللغة الإنجليزية", "English"], ["490", "اللغات الأخرى والعربية", "Other languages & Arabic"], ["401", "فلسفة اللغة", "Philosophy of language"]] },
  { id: "500", ar: "العلوم الطبيعية والرياضيات", en: "Science & mathematics", branches: [["510", "الرياضيات", "Mathematics"], ["520", "الفلك", "Astronomy"], ["530", "الفيزياء", "Physics"], ["540", "الكيمياء", "Chemistry"], ["570", "علوم الحياة", "Life sciences"]] },
  { id: "600", ar: "التقنية والعلوم التطبيقية", en: "Technology", branches: [["610", "الطب والصحة", "Medicine & health"], ["620", "الهندسة", "Engineering"], ["630", "الزراعة", "Agriculture"], ["650", "الإدارة والأعمال", "Management & business"], ["660", "الهندسة الكيميائية", "Chemical engineering"]] },
  { id: "700", ar: "الفنون والترفيه", en: "Arts & recreation", branches: [["710", "التخطيط والعمارة الطبيعية", "Civic & landscape art"], ["720", "العمارة", "Architecture"], ["740", "الرسم والتصميم", "Drawing & design"], ["780", "الموسيقى", "Music"], ["790", "الترفيه والرياضة", "Recreation & sport"]] },
  { id: "800", ar: "الآداب", en: "Literature", branches: [["810", "الأدب الأمريكي", "American literature"], ["820", "الأدب الإنجليزي", "English literature"], ["890", "الآداب الأخرى والعربية", "Other literatures & Arabic"], ["808", "الكتابة والبلاغة", "Writing & rhetoric"]] },
  { id: "900", ar: "التاريخ والجغرافيا", en: "History & geography", branches: [["910", "الجغرافيا والرحلات", "Geography & travel"], ["920", "السير والأنساب", "Biography & genealogy"], ["930", "التاريخ القديم", "Ancient history"], ["950", "تاريخ آسيا", "History of Asia"], ["960", "تاريخ أفريقيا", "History of Africa"]] },
] as const;
const MODERN_GATEWAY = { id: "modern", ar: "الموضوعات الحديثة والناشئة", en: "Modern & emerging topics" } as const;
const MODERN_TOPICS = [
  ["artificial-intelligence", "الذكاء الاصطناعي", "Artificial intelligence"],
  ["cybersecurity", "الأمن السيبراني", "Cybersecurity"],
  ["data-science", "علوم البيانات", "Data science"],
  ["digital-transformation", "التحول الرقمي", "Digital transformation"],
  ["cloud-computing", "الحوسبة السحابية", "Cloud computing"],
  ["blockchain-fintech", "البلوك تشين والتقنية المالية", "Blockchain & fintech"],
  ["sustainability", "الاستدامة والتقنيات الخضراء", "Sustainability & green tech"],
  ["biotechnology", "التقنية الحيوية", "Biotechnology"],
  ["innovation", "الابتكار وريادة الأعمال", "Innovation & entrepreneurship"],
  ["future-studies", "دراسات المستقبل", "Future studies"],
] as const;
type DeweyGatewayId = (typeof DEWEY_GATEWAYS)[number]["id"];

function inferClassification(book: PilotBook): BookClassificationPatch {
  const savedMain = String(book.metadata?.dewey_main ?? "");
  const knownMain = DEWEY_GATEWAYS.some((item) => item.id === savedMain);
  if (knownMain) return {
    deweyMain: savedMain,
    deweyBranch: String(book.metadata?.dewey_branch ?? DEWEY_GATEWAYS.find((item) => item.id === savedMain)!.branches[0][0]),
    modernTopic: String(book.metadata?.modern_topic ?? ""),
  };
  const haystack = `${book.title} ${String(book.metadata?.subject ?? "")}`.toLowerCase();
  if (/تاريخ|history|حضار|سيرة|جغراف|geograph|رحلات/.test(haystack)) return { deweyMain: "900", deweyBranch: /سيرة|biograph/.test(haystack) ? "920" : "910" };
  if (/إدار|قياد|management|leadership|business/.test(haystack)) return { deweyMain: "600", deweyBranch: "650", modernTopic: /تحول رقمي|digital transformation/.test(haystack) ? "digital-transformation" : undefined };
  if (/cyber|أمن سيبراني|الأمن السيبراني|information security/.test(haystack)) return { deweyMain: "000", deweyBranch: "005.8", modernTopic: "cybersecurity" };
  if (/ذكاء اصطناعي|\bai\b|artificial intelligence|claude|coming wave/.test(haystack)) return { deweyMain: "000", deweyBranch: "006.3", modernTopic: "artificial-intelligence" };
  if (/research writing|كتابة بحث|منهجية البحث/.test(haystack)) return { deweyMain: "800", deweyBranch: "808" };
  if (/أدب|رواي|شعر|literature|novel|poetry/.test(haystack)) return { deweyMain: "800", deweyBranch: "890" };
  if (/لغ|language|linguistic/.test(haystack)) return { deweyMain: "400", deweyBranch: "410" };
  if (/صحة|طب|health|medicine/.test(haystack)) return { deweyMain: "600", deweyBranch: "610" };
  if (/علوم|رياض|فيزياء|كيمياء|science|math|physics|chemistry/.test(haystack)) return { deweyMain: "500", deweyBranch: "510" };
  if (/دين|relig/.test(haystack)) return { deweyMain: "200", deweyBranch: "290" };
  if (/فكر|فلسف|نفس|thought|philosoph|psycholog/.test(haystack)) return { deweyMain: "100", deweyBranch: "150" };
  return { deweyMain: "", deweyBranch: "" };
}

function gatewayLabel(id: string, rtl: boolean) {
  if (!id) return rtl ? "غير مصنف" : "Unclassified";
  if (id === MODERN_GATEWAY.id) return rtl ? MODERN_GATEWAY.ar : MODERN_GATEWAY.en;
  const item = DEWEY_GATEWAYS.find((entry) => entry.id === id) ?? DEWEY_GATEWAYS[0];
  return `${item.id} · ${rtl ? item.ar : item.en}`;
}

function branchLabel(main: string, branch: string, rtl: boolean) {
  if (!main || !branch) return rtl ? "لم يُحدد التفريع" : "No subdivision selected";
  const item = DEWEY_GATEWAYS.find((entry) => entry.id === main) ?? DEWEY_GATEWAYS[0];
  const selected = item.branches.find((entry) => entry[0] === branch) ?? item.branches[0];
  return `${selected[0]} · ${rtl ? selected[1] : selected[2]}`;
}

function modernTopicLabel(topic: string, rtl: boolean) {
  const selected = MODERN_TOPICS.find((entry) => entry[0] === topic);
  return selected ? (rtl ? selected[1] : selected[2]) : "";
}

function finalClassificationLabel(classification: BookClassificationPatch, rtl: boolean) {
  if (!classification.deweyMain) return rtl ? "غير مصنف" : "Unclassified";
  const gateway = DEWEY_GATEWAYS.find((entry) => entry.id === classification.deweyMain);
  const branch = gateway?.branches.find((entry) => entry[0] === classification.deweyBranch);
  const code = classification.deweyBranch || classification.deweyMain;
  const label = classification.modernTopic
    ? modernTopicLabel(classification.modernTopic, rtl)
    : branch
      ? (rtl ? branch[1] : branch[2])
      : gateway
        ? (rtl ? gateway.ar : gateway.en)
        : (rtl ? "غير مصنف" : "Unclassified");
  return `${code} · ${label}`;
}

function classificationSearchText(book: PilotBook, rtl: boolean) {
  const classification = inferClassification(book);
  const gateway = DEWEY_GATEWAYS.find((entry) => entry.id === classification.deweyMain);
  const branch = gateway?.branches.find((entry) => entry[0] === classification.deweyBranch);
  const modern = MODERN_TOPICS.find((entry) => entry[0] === classification.modernTopic);
  return [
    book.title,
    classification.deweyMain,
    gateway?.ar,
    gateway?.en,
    classification.deweyBranch,
    branch?.[1],
    branch?.[2],
    classification.modernTopic,
    modern?.[1],
    modern?.[2],
    book.metadata?.author,
    book.metadata?.publisher,
    book.metadata?.publication_place,
    book.metadata?.publication_year,
    book.metadata?.isbn,
    book.metadata?.subject,
    book.metadata?.page_count,
    rtl ? "" : book.source_language,
  ].filter(Boolean).join(" ").toLowerCase();
}

// Caps how many books can render a FULL pdf.js cover (download + decode +
// canvas + Worker) at the same time. Without this, opening a library with
// many books fires one full-PDF download and one pdf.js Worker per visible
// card simultaneously — the main cause of covers failing to appear on
// Samsung/Android browsers, whose per-tab memory budget is much tighter than
// desktop or iPhone Safari. Cached thumbnails (the common case after the
// first render) never touch this limiter at all.
const MAX_CONCURRENT_PDF_COVER_RENDERS = 2;
let activePdfCoverRenders = 0;
const pdfCoverRenderQueue: Array<() => void> = [];
function acquirePdfCoverRenderSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      activePdfCoverRenders += 1;
      resolve(() => {
        activePdfCoverRenders -= 1;
        const next = pdfCoverRenderQueue.shift();
        if (next) next();
      });
    };
    if (activePdfCoverRenders < MAX_CONCURRENT_PDF_COVER_RENDERS) tryAcquire();
    else pdfCoverRenderQueue.push(tryAcquire);
  });
}

function activeCoverThumbnailPath(book: PilotBook): string {
  const separator = book.storage_path.lastIndexOf("/");
  return separator >= 0 ? `${book.storage_path.slice(0, separator)}/cover.jpg` : "";
}

function OriginalPdfCover({ book }: { book: PilotBook }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [coverImageUrl, setCoverImageUrl] = useState("");
  // Lazy-load: only start any network/PDF work once the card is actually
  // near the viewport, instead of every card firing at once on mount. This
  // is the other half of the Samsung fix — mobile screens show far fewer
  // cards at a time than the whole library, so most work is deferred until
  // the user scrolls near it.
  const [isNearViewport, setIsNearViewport] = useState(false);
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") { setIsNearViewport(true); return; }
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) { setIsNearViewport(true); observer.disconnect(); } },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isNearViewport) return;
    let cancelled = false;
    let objectUrl = "";
    setFailed(false);
    setCoverImageUrl("");
    const archivedCoverPath = String(book.metadata?.archive_cover_path ?? "");
    const cachedCoverPath = String(book.metadata?.cover_path ?? "") || activeCoverThumbnailPath(book);
    const render = async () => {
      // 1) Archived books: a small cover JPEG was already saved when they
      //    were archived — just show it.
      // 2) Active books that already went through this component once: a
      //    small cover JPEG was cached to metadata.cover_path (see below) —
      //    show it directly, no PDF download or Worker involved.
      const cachedPaths = [...new Set([archivedCoverPath, cachedCoverPath].filter(Boolean))];
      for (const cachedPath of cachedPaths) {
        try {
          const coverBlob = await downloadBookFile(cachedPath);
          objectUrl = URL.createObjectURL(coverBlob);
          if (!cancelled) setCoverImageUrl(objectUrl);
          return;
        } catch {
          // An active thumbnail is only a cache. If it is missing or corrupt,
          // render from the original PDF and recreate it below. Archived books
          // have no original to fall back to and will use BookCover safely.
        }
      }
      if (isBookArchived(book)) throw new Error("ARCHIVED_COVER_UNAVAILABLE");
      // First time this book's cover is needed: fall back to the full
      // render, but only MAX_CONCURRENT_PDF_COVER_RENDERS at a time so a
      // large library doesn't spike memory on low-RAM Android devices.
      const releaseSlot = await acquirePdfCoverRenderSlot();
      try {
        if (cancelled) return;
        // Download through the authenticated Storage client instead of asking
        // PDF.js to range-fetch a short-lived signed URL. Samsung Internet and
        // some Android WebViews can reject those cross-origin range requests
        // and leave an empty canvas even though the book itself is available.
        const fileBlob = await downloadBookFile(book.storage_path);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await fileBlob.arrayBuffer()), disableFontFace: true });
        const pdf = await loadingTask.promise;
        let first: Awaited<ReturnType<typeof pdf.getPage>> | null = null;
        try {
          first = await pdf.getPage(1);
          const base = first.getViewport({ scale: 1 });
          const viewport = first.getViewport({ scale: Math.max(0.34, Math.min(1.2, 420 / base.width)) });
          if (cancelled || !canvasRef.current) return;
          const canvas = canvasRef.current;
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("COVER_CANVAS_UNAVAILABLE");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          await first.render({ canvasContext: context, viewport, canvas }).promise;
          canvas.dataset.ready = "true";
          // Cache a small JPEG so every future load of this book (this device
          // or any other) uses the cheap path above instead of re-downloading
          // and re-decoding the whole PDF. Fire-and-forget: a caching failure
          // must not affect the cover that already rendered successfully.
          canvas.toBlob((blob) => { if (blob) void saveCoverThumbnail(book, blob); }, "image/jpeg", 0.82);
        } finally {
          first?.cleanup();
          await loadingTask.destroy();
        }
      } finally {
        releaseSlot();
      }
    };
    render().catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [book.id, book.storage_path, book.metadata?.archive_cover_path, book.metadata?.cover_path, isNearViewport]);
  // wrapperRef only needs to sit on the placeholder box below: that's the
  // only state rendered before isNearViewport flips to true, at which point
  // the observer has already done its job and disconnected. Attaching it
  // there (rather than a synthetic outer wrapper) keeps the exact original
  // .book-cover DOM structure intact, so the CSS grid sizing rules that
  // target `.book-cover` as a direct child (e.g. `.book-card .book-cover`)
  // and BookCover's own `.book-cover` div are unaffected.
  if (failed) return <BookCover tone={coverToneFor(book.title)} title={book.title.split(" ").slice(0, 3).join(" ")} />;
  if (coverImageUrl) return <div className="book-cover original-pdf-cover"><img src={coverImageUrl} alt={book.title} /></div>;
  return <div ref={wrapperRef} className="book-cover original-pdf-cover"><canvas ref={canvasRef} aria-label={book.title} /></div>;
}

/** A real saved book; page one is rendered as its cover with a safe fallback. */
function LiveBookCard({
  book,
  rtl,
  onOpen,
  compact = false,
  onArchive,
  onRestore,
  onDelete,
  onClassificationChange,
}: {
  book: PilotBook;
  rtl: boolean;
  onOpen: () => void;
  compact?: boolean;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  onClassificationChange?: (classification: BookClassificationPatch) => Promise<boolean | void> | boolean | void;
}) {
  const subtitle = languageLabel(book.source_language, rtl);
  const classification = inferClassification(book);
  const archived = isBookArchived(book);
  const originalRemoved = Boolean(book.metadata?.original_removed);
  const status = archived
    ? originalRemoved
      ? (rtl ? "✓ نسخة معرفية محفوظة — الأصل مؤرشف" : "✓ Saved knowledge copy — original archived")
      : (rtl ? "جارٍ إكمال الأرشفة — النتائج محفوظة" : "Completing archive — results are saved")
    : book.status === "processing"
    ? (rtl ? "جارٍ التحليل — انتظر ولا تكرر الطلب" : "Analysis running — wait and do not repeat the request")
    : book.status === "failed"
      ? (rtl ? "تعذر التحليل — لم يُخصم طلب جديد" : "Analysis failed — no new request was charged")
      : book.analysis_ready
        ? (rtl ? "✓ مكتمل — جاهز للأرشفة" : "✓ Complete — ready to archive")
        : (rtl ? "بانتظار التحليل" : "Awaiting analysis");
  const statusTone = archived ? "knowledge" : book.status === "processing" ? "processing" : book.status === "failed" ? "failed" : book.analysis_ready ? "complete" : "waiting";
  const [editingClassification, setEditingClassification] = useState(false);
  const [classificationBusy, setClassificationBusy] = useState(false);
  const [draftClassification, setDraftClassification] = useState<BookClassificationPatch>(classification);
  useEffect(() => setDraftClassification(classification), [book.id, book.metadata?.dewey_main, book.metadata?.dewey_branch, book.metadata?.modern_topic]);
  const selectedGateway = DEWEY_GATEWAYS.find((item) => item.id === draftClassification.deweyMain) ?? DEWEY_GATEWAYS[0];
  const saveClassification = async () => {
    if (!onClassificationChange || !draftClassification.deweyMain || !draftClassification.deweyBranch) return;
    setClassificationBusy(true);
    try {
      const saved = await onClassificationChange(draftClassification);
      if (saved !== false) setEditingClassification(false);
    } finally {
      setClassificationBusy(false);
    }
  };
  return (
    <article className={`book-card live-book-card${compact ? " compact-live-book-card" : ""}`}>
      <button className="book-card-open" onClick={onOpen} aria-label={`${rtl ? "فتح" : "Open"} ${book.title}`}>
        <OriginalPdfCover book={book} />
      </button>
      <div className="live-book-copy">
        {!compact && <span className="tag">{rtl ? "كتابك" : "Your book"}</span>}
        <button className="book-title-button" onClick={onOpen}><h4>{book.title}</h4></button>
        {!compact && <p>{subtitle}</p>}
        {!compact && <span className={`book-status-badge ${statusTone}`}>{status}</span>}
        {compact && archived && <span className="book-status-badge knowledge compact-knowledge-status">{rtl ? "نسخة معرفية" : "Knowledge copy"}</span>}
        {compact ? <span className={`book-category-chip final ${classification.deweyMain ? "" : "unclassified"}`}>{finalClassificationLabel(classification, rtl)}</span> : onClassificationChange && editingClassification ? <div className="book-classification-editor">
          <select value={draftClassification.deweyMain} onChange={(event) => {
            const gateway = DEWEY_GATEWAYS.find((item) => item.id === event.target.value) ?? DEWEY_GATEWAYS[0];
            setDraftClassification({ ...draftClassification, deweyMain: gateway.id, deweyBranch: gateway.branches[0][0] });
          }} aria-label={rtl ? "تصنيف ديوي الرئيسي" : "Main Dewey class"}>
            <option value="" disabled>{rtl ? "اختر التصنيف الرئيسي" : "Choose main class"}</option>
            {DEWEY_GATEWAYS.map((item) => <option key={item.id} value={item.id}>{gatewayLabel(item.id, rtl)}</option>)}
          </select>
          <select value={draftClassification.deweyBranch} disabled={!draftClassification.deweyMain} onChange={(event) => setDraftClassification({ ...draftClassification, deweyBranch: event.target.value })} aria-label={rtl ? "تفريع ديوي" : "Dewey subdivision"}>
            {selectedGateway.branches.map((branch) => <option key={branch[0]} value={branch[0]}>{branchLabel(selectedGateway.id, branch[0], rtl)}</option>)}
          </select>
          <select value={draftClassification.modernTopic ?? ""} onChange={(event) => setDraftClassification({ ...draftClassification, modernTopic: event.target.value || undefined })} aria-label={rtl ? "موضوع حديث اختياري" : "Optional modern topic"}>
            <option value="">{rtl ? "لا يوجد موضوع حديث إضافي" : "No additional modern topic"}</option>
            {MODERN_TOPICS.map((topic) => <option key={topic[0]} value={topic[0]}>{rtl ? topic[1] : topic[2]}</option>)}
          </select>
          <div className="classification-editor-actions">
            <button className="primary compact" disabled={classificationBusy || !draftClassification.deweyMain || !draftClassification.deweyBranch} onClick={saveClassification}>{classificationBusy ? "…" : rtl ? "حفظ التصنيف" : "Save category"}</button>
            <button className="secondary compact" disabled={classificationBusy} onClick={() => { setDraftClassification(classification); setEditingClassification(false); }}>{rtl ? "تراجع" : "Cancel"}</button>
          </div>
        </div> : <button className="book-category-chips category-edit-trigger" onClick={() => { setDraftClassification(classification); setEditingClassification(true); }} aria-label={rtl ? "عرض أو تغيير تصنيف الكتاب" : "View or change book category"}><span className={`book-category-chip final ${classification.deweyMain ? "" : "unclassified"}`}>{finalClassificationLabel(classification, rtl)}</span><small>{rtl ? "تغيير التصنيف" : "Change category"}</small></button>}
        {!compact && onArchive && !archived && <button className="book-archive-button" onClick={onArchive}>▣ {rtl ? "نقل إلى الأرشيف" : "Move to archive"}</button>}
        {!compact && onRestore && archived && <button className="book-restore-button" onClick={onRestore}>↥ {rtl ? "إعادة إلى الكتب النشطة" : "Restore to active shelf"}</button>}
        {!compact && onDelete && archived && <button className="book-permanent-delete-button" onClick={onDelete}>⌫ {rtl ? "حذف نهائي" : "Delete permanently"}</button>}
      </div>
    </article>
  );
}

const SAMPLE_BOOKS = [
  { title: "The Coming Wave", dewey: "000", modern: "artificial-intelligence", tone: "navy" },
  { title: "التحول الرقمي في الإدارة والقيادة الحديثة", dewey: "600", modern: "digital-transformation", tone: "emerald" },
  { title: "The Instant AI Agency", dewey: "000", modern: "artificial-intelligence", tone: "emerald" },
  { title: "100 خطوة لإتقان Claude", dewey: "000", modern: "artificial-intelligence", tone: "gold" },
  { title: "رحلة في تاريخ العلوم", dewey: "900", modern: "", tone: "navy" },
  { title: "مدخل إلى علم النفس", dewey: "100", modern: "", tone: "gold" },
] as const;

function SampleShelf({ rtl, compact = false }: { rtl: boolean; compact?: boolean }) {
  return (
    <div className={compact ? "sample-shelf compact-samples" : "sample-shelf"}>
      <p className="sample-library-intro">{compact
        ? (rtl ? "نماذج توضيحية فقط — تختفي عند إضافة أول كتاب حقيقي." : "Display-only samples — they disappear after your first real book.")
        : rtl
        ? "هذه أمثلة توضيحية فقط لتعرف شكل المكتبة ومخرجات كل كتاب. لا تُرسل إلى OpenAI ولا تُحسب ضمن كتبك."
        : "These are display-only examples of the library and book outputs. They never call OpenAI and do not count as your books."}</p>
      <div className="sample-book-grid">
        {SAMPLE_BOOKS.map((sample) => (
          <article className="sample-book-card" key={sample.title}>
            <BookCover tone={sample.tone} title={sample.title} />
            <div>
              <span className="sample-badge">{rtl ? "نموذج" : "Sample"}</span>
              <h4>{sample.title}</h4>
              <span className="book-category-chip">{gatewayLabel(sample.dewey, rtl)}</span>
              <small>{rtl ? "خلاصة • أفكار • فصول • صوت • أسئلة" : "Summary • ideas • chapters • audio • questions"}</small>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function DuplicateReviewPanel({
  rtl,
  groups,
  onBooksChanged,
}: {
  rtl: boolean;
  groups: DuplicateGroup[];
  onBooksChanged: () => void;
}) {
  const [confirmingId, setConfirmingId] = useState("");
  const [confirmingGroup, setConfirmingGroup] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  if (groups.length === 0) return null;
  const remove = async (book: PilotBook) => {
    setBusyId(book.id);
    setError("");
    try {
      await archivePilotBook(book);
      onBooksChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : rtl ? "تعذرت أرشفة السجل." : "Could not archive this record.");
    } finally {
      setBusyId("");
      setConfirmingId("");
    }
  };
  const keepNewestOnly = async (group: DuplicateGroup) => {
    const ordered = [...group.books].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    setBusyId(group.key);
    setError("");
    try {
      for (const duplicate of ordered.slice(1)) await archivePilotBook(duplicate);
      onBooksChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : rtl ? "تعذر تنظيف المجموعة." : "Could not clean this group.");
    } finally {
      setBusyId("");
      setConfirmingGroup("");
    }
  };
  return (
    <section className="panel duplicate-review">
      <span className="eyebrow">{rtl ? "مراجعة السجلات المكررة" : "Duplicate review"}</span>
      <h3>{rtl ? "لا حذف نهائي — راجع النسخ ثم انقل الزائد إلى الأرشيف" : "No permanent deletion — review copies, then archive extras"}</h3>
      <p className="disclosure-note">
        {rtl
          ? "المجموعات المؤكدة تتطابق ببصمة الملف SHA-256. المجموعات غير المؤكدة تتطابق بالعنوان والحجم فقط. الأرشفة تحافظ على النتائج المدفوعة ولا تحذفها."
          : "Confirmed groups match by SHA-256. Unconfirmed groups match only by title and size. Archiving preserves paid outputs."}
      </p>
      {error && <div className="reader-error inline">{error}</div>}
      {groups.map((group) => (
        <div key={group.key} className="duplicate-group">
          <small className={group.confirmed ? "dup-confirmed" : "dup-unconfirmed"}>
            {group.confirmed
              ? rtl
                ? "مؤكد — نفس محتوى الملف"
                : "Confirmed — identical file content"
              : rtl
                ? "غير مؤكد — تطابق بالعنوان والحجم فقط"
                : "Unconfirmed — title + size match only"}
          </small>
          {confirmingGroup === group.key ? <span className="dup-confirm-row"><em>{rtl ? "سنُبقي أحدث نسخة نشطة ونؤرشف البقية. تأكيد؟" : "Keep the newest active and archive the rest?"}</em><button className="primary" disabled={busyId === group.key} onClick={() => keepNewestOnly(group)}>{rtl ? "نعم، أرشف الزائد" : "Archive extras"}</button><button className="secondary" onClick={() => setConfirmingGroup("")}>{rtl ? "تراجع" : "Cancel"}</button></span> : <button className="primary compact" onClick={() => setConfirmingGroup(group.key)}>{rtl ? "أبقِ نسخة نشطة واحدة" : "Keep one active copy"}</button>}
          <ul>
            {group.books.map((book) => (
              <li key={book.id}>
                <span>
                  {book.title} — {new Date(book.created_at).toLocaleString(rtl ? "ar" : "en")}
                </span>
                {confirmingId === book.id ? (
                  <span className="dup-confirm-row">
                    <em>{rtl ? "تأكيد الأرشفة؟" : "Confirm archive?"}</em>
                    <button className="primary" disabled={busyId === book.id} onClick={() => remove(book)}>
                      {rtl ? "نعم، أرشف" : "Yes, archive"}
                    </button>
                    <button className="secondary" onClick={() => setConfirmingId("")}>
                      {rtl ? "تراجع" : "Cancel"}
                    </button>
                  </span>
                ) : (
                  <button className="secondary" onClick={() => setConfirmingId(book.id)}>
                    {rtl ? "أرشفة هذه النسخة" : "Archive this copy"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

type PaidBookResult = {
  source_language?: string;
  metadata?: { title?: string; author?: string; subject?: string; pages_if_known?: string | number | null };
  overview?: { summary?: string; key_ideas?: unknown[]; return_to_source?: unknown[] };
  chapters?: Array<{ title?: string; summary?: string; pages_if_known?: string | number | null }>;
  critical?: { strengths?: unknown[]; limitations?: unknown[]; platform_inferences?: unknown[] };
  trust_notes?: unknown;
};

function readableItem(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  return [item.page ?? item.pages ?? item.pages_if_known, item.reason ?? item.note ?? item.text ?? item.title]
    .filter(Boolean)
    .join(" — ");
}

function describeAiError(value: unknown, rtl: boolean) {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  const code = raw.match(/(PAID_AI_DISABLED|PRIVATE_PILOT_EMAIL_REQUIRED|PAID_PILOT_BOOK_LIMIT_REACHED|DAILY_ANALYSIS_LIMIT_REACHED|DAILY_QUESTION_LIMIT_REACHED|PILOT_QUESTION_LIMIT_REACHED|OPENAI_API_KEY_MISSING|LEGAL_CONSENT_REQUIRED|BOOK_NOT_PROCESSED|ANALYSIS_NOT_READY)/)?.[1];
  const ar: Record<string, string> = {
    PAID_AI_DISABLED: "الخدمة المدفوعة ما زالت مغلقة من خادم Supabase؛ لم يُرسل الكتاب ولم يُخصم أي رصيد.",
    PRIVATE_PILOT_EMAIL_REQUIRED: "سجّل دخولك بالبريد التجريبي المعتمد أولًا. الجلسة المجهولة لا تستطيع استخدام رصيد OpenAI.",
    PAID_PILOT_BOOK_LIMIT_REACHED: "بلغت حد الكتب المدفوعة المسموح به في المختبر. لن يُخصم شيء لكتاب إضافي.",
    DAILY_ANALYSIS_LIMIT_REACHED: "بلغت حد التحليلات اليومية الآمن. أوقفنا الطلب قبل الخصم الإضافي.",
    DAILY_QUESTION_LIMIT_REACHED: "بلغت حد الأسئلة اليومية الآمن.",
    PILOT_QUESTION_LIMIT_REACHED: "بلغت حد الأسئلة الإجمالي للتجربة الحالية.",
    OPENAI_API_KEY_MISSING: "مفتاح OpenAI غير مضبوط داخل أسرار Supabase؛ لم تبدأ الخدمة.",
    LEGAL_CONSENT_REQUIRED: "إقرار حقوق استخدام هذا الكتاب غير مسجل.",
    BOOK_NOT_PROCESSED: "حلّل الكتاب أولًا قبل طرح الأسئلة.",
    ANALYSIS_NOT_READY: "أنشئ الخلاصة بهذه اللغة أولًا، ثم أنشئ الصوت.",
  };
  const en: Record<string, string> = {
    PAID_AI_DISABLED: "Paid AI is still locked on the Supabase server. Nothing was sent and no credit was used.",
    PRIVATE_PILOT_EMAIL_REQUIRED: "Sign in with the approved pilot email first. Anonymous sessions cannot use OpenAI credit.",
    PAID_PILOT_BOOK_LIMIT_REACHED: "The paid pilot book limit has been reached. No additional credit was used.",
    DAILY_ANALYSIS_LIMIT_REACHED: "The safe daily analysis limit has been reached.",
    DAILY_QUESTION_LIMIT_REACHED: "The safe daily question limit has been reached.",
    PILOT_QUESTION_LIMIT_REACHED: "The pilot's total question limit has been reached.",
    OPENAI_API_KEY_MISSING: "The OpenAI key is not configured in Supabase secrets; the service did not start.",
    LEGAL_CONSENT_REQUIRED: "The rights declaration for this book is not recorded.",
    BOOK_NOT_PROCESSED: "Analyze the book before asking questions.",
    ANALYSIS_NOT_READY: "Create the summary in this language before generating audio.",
  };
  return code ? (rtl ? ar[code] : en[code]) : raw || (rtl ? "تعذر إكمال الطلب." : "The request could not be completed.");
}

function PaidResultView({ result, rtl }: { result: Record<string, unknown>; rtl: boolean }) {
  const data = result as PaidBookResult;
  const ideas = data.overview?.key_ideas ?? [];
  const returns = data.overview?.return_to_source ?? [];
  const strengths = data.critical?.strengths ?? [];
  const limitations = data.critical?.limitations ?? [];
  const inferences = data.critical?.platform_inferences ?? [];
  return (
    <div className="paid-result-view">
      <div className="paid-result-meta">
        <span>✓ {rtl ? "تحليل محفوظ" : "Saved analysis"}</span>
        {data.metadata?.author && <span>{rtl ? "المؤلف" : "Author"}: {data.metadata.author}</span>}
        {data.metadata?.subject && <span>{rtl ? "الموضوع" : "Subject"}: {data.metadata.subject}</span>}
        {data.metadata?.pages_if_known && <span>{rtl ? "الصفحات" : "Pages"}: {String(data.metadata.pages_if_known)}</span>}
      </div>
      <section>
        <h4>{rtl ? "الخلاصة الذكية" : "AI overview"}</h4>
        <p className="paid-summary">{data.overview?.summary || (rtl ? "لم تُحفظ خلاصة." : "No overview was saved.")}</p>
      </section>
      {ideas.length > 0 && <section><h4>{rtl ? "الأفكار المحورية" : "Key ideas"}</h4><ol>{ideas.map((item, index) => <li key={index}>{readableItem(item)}</li>)}</ol></section>}
      {(data.chapters?.length ?? 0) > 0 && <section><h4>{rtl ? "الفصول" : "Chapters"}</h4><div className="chapters">{data.chapters?.map((chapter, index) => <details key={index} open={index === 0}><summary><b>{String(index + 1).padStart(2, "0")}</b><span>{chapter.title || (rtl ? "فصل" : "Chapter")}</span><em>{chapter.pages_if_known ? `${rtl ? "ص" : "p."} ${chapter.pages_if_known}` : ""}</em></summary><p>{chapter.summary}</p></details>)}</div></section>}
      {(strengths.length > 0 || limitations.length > 0) && <section><h4>{rtl ? "القراءة النقدية" : "Critical reading"}</h4><div className="analysis-grid"><div><h4>✓ {rtl ? "نقاط القوة" : "Strengths"}</h4><ul>{strengths.map((item, index) => <li key={index}>{readableItem(item)}</li>)}</ul></div><div><h4>△ {rtl ? "الحدود" : "Limitations"}</h4><ul>{limitations.map((item, index) => <li key={index}>{readableItem(item)}</li>)}</ul></div></div></section>}
      {inferences.length > 0 && <section className="inference"><b>{rtl ? "استنتاجات المنصة" : "Platform inferences"}</b><ul>{inferences.map((item, index) => <li key={index}>{readableItem(item)}</li>)}</ul></section>}
      {returns.length > 0 && <section><h4>{rtl ? "مواضع العودة إلى الكتاب" : "Return to the source"}</h4><ol className="return-list paid-return-list">{returns.map((item, index) => <li key={index}>{readableItem(item)}</li>)}</ol></section>}
      {Boolean(data.trust_notes) && <p className="disclosure-note">{rtl ? "ملاحظات الثقة: " : "Trust notes: "}{readableItem(data.trust_notes)}</p>}
    </div>
  );
}

function Library({
  rtl,
  title,
  onUpload,
  pilotBooks,
  booksLoading,
  booksError,
  onRetry,
  onBooksChanged,
  searchQuery,
  onOpenPilot,
}: {
  rtl: boolean;
  title: string;
  onUpload: () => void;
  pilotBooks: PilotBook[];
  booksLoading: boolean;
  booksError: string;
  onRetry: () => void;
  onBooksChanged: () => void;
  searchQuery: string;
  onOpenPilot: (book: PilotBook) => void;
}) {
  const [categoryFilter, setCategoryFilter] = useState<DeweyGatewayId | "modern" | "all">("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [classificationFiltersOpen, setClassificationFiltersOpen] = useState(false);
  const [shelf, setShelf] = useState<"active" | "archive">(() => localStorage.getItem("spl-preferred-library-shelf") === "archive" ? "archive" : "active");
  const [bookToArchive, setBookToArchive] = useState<PilotBook | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [bookToDelete, setBookToDelete] = useState<PilotBook | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState("");
  const [mobileShelfLayout, setMobileShelfLayout] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const syncLayout = () => setMobileShelfLayout(media.matches);
    syncLayout();
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);
  const query = searchQuery.trim().toLowerCase();
  const activeBooks = pilotBooks.filter((book) => !isBookArchived(book));
  const archivedBooks = pilotBooks.filter(isBookArchived);
  const shelfBooks = shelf === "active" ? activeBooks : archivedBooks;
  const filteredPilotBooks = pilotBooks.filter((book) => {
    // Search spans the complete personal library. Without a search term, the
    // selected shelf keeps originals and knowledge copies visually separate.
    if (!query && (shelf === "active" ? isBookArchived(book) : !isBookArchived(book))) return false;
    const classification = inferClassification(book);
    const matchesQuery = !query || classificationSearchText(book, rtl).includes(query);
    const matchesCategory = categoryFilter === "all"
      || (categoryFilter === "modern" ? Boolean(classification.modernTopic) : classification.deweyMain === categoryFilter);
    const matchesBranch = branchFilter === "all"
      || (categoryFilter === "modern" ? classification.modernTopic === branchFilter : classification.deweyBranch === branchFilter);
    return matchesQuery && matchesCategory && matchesBranch;
  });
  const mobileShelves = Array.from(filteredPilotBooks.reduce((groups, book) => {
    const classification = inferClassification(book);
    const key = finalClassificationLabel(classification, rtl);
    const items = groups.get(key) ?? [];
    items.push(book);
    groups.set(key, items);
    return groups;
  }, new Map<string, PilotBook[]>()));
  const selectedShelfLabel = query
    ? (rtl ? "نتائج البحث" : "Search results")
    : categoryFilter === "modern"
      ? (branchFilter === "all" ? gatewayLabel("modern", rtl) : modernTopicLabel(branchFilter, rtl))
      : categoryFilter !== "all"
        ? (branchFilter === "all" ? gatewayLabel(categoryFilter, rtl) : branchLabel(categoryFilter, branchFilter, rtl))
        : (rtl ? "كل الكتب" : "All books");
  const denseMobileShelves = mobileShelves.filter(([, books]) => books.length >= 3);
  const sparseMobileBooks = mobileShelves.filter(([, books]) => books.length < 3).flatMap(([, books]) => books);
  const adaptiveMobileShelves: Array<[string, PilotBook[]]> = query || categoryFilter !== "all"
    ? [[selectedShelfLabel, filteredPilotBooks]]
    : denseMobileShelves.length > 0
      ? [...denseMobileShelves, ...(sparseMobileBooks.length ? [[rtl ? "كتب أخرى" : "Other books", sparseMobileBooks] as [string, PilotBook[]]] : [])]
      : [[selectedShelfLabel, filteredPilotBooks]];
  const changeClassification = async (book: PilotBook, classification: BookClassificationPatch) => {
    setLibraryMessage("");
    try {
      await updateBookClassification(book, classification);
      onBooksChanged();
      setLibraryMessage(rtl ? "تم حفظ تصنيف الكتاب." : "Book category saved.");
      return true;
    } catch (error) {
      setLibraryMessage(error instanceof Error ? error.message : rtl ? "تعذر حفظ التصنيف." : "Could not save category.");
      return false;
    }
  };
  const chooseShelf = (nextShelf: "active" | "archive") => {
    setShelf(nextShelf);
    localStorage.setItem("spl-preferred-library-shelf", nextShelf);
    setCategoryFilter("all");
    setBranchFilter("all");
    setClassificationFiltersOpen(false);
  };
  const confirmArchive = async () => {
    if (!bookToArchive) return;
    setArchiveBusy(true);
    setLibraryMessage("");
    try {
      await archivePilotBook(bookToArchive);
      setBookToArchive(null);
      onBooksChanged();
      setLibraryMessage(rtl ? "نُقل الكتاب إلى الأرشيف، وحُذف PDF الأصلي لتوفير المساحة، وبقي الغلاف والخلاصة والصوت والأسئلة محفوظة. يمكنك إعادة رفع الملف نفسه لاحقًا بلا سجل مكرر." : "Book archived and the original PDF was removed to save space; cover, summary, audio and questions remain. Re-upload the same file later without creating a duplicate record.");
    } catch (error) {
      setLibraryMessage(error instanceof Error ? error.message : rtl ? "تعذرت أرشفة الكتاب." : "Could not archive the book.");
    } finally {
      setArchiveBusy(false);
    }
  };
  const restoreBook = async (book: PilotBook) => {
    setLibraryMessage("");
    try {
      await restoreArchivedBook(book);
      onBooksChanged();
      setLibraryMessage(rtl ? "عاد الكتاب إلى رف الكتب النشطة." : "Book restored to the active shelf.");
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      setLibraryMessage(raw === "ACTIVE_BOOK_LIMIT_REACHED"
        ? (rtl ? "لديك ستة كتب نشطة. أرشف كتابًا أولًا لاستعادة هذا الكتاب." : "You already have six active books. Archive one before restoring this book.")
        : raw === "ARCHIVED_ORIGINAL_REUPLOAD_REQUIRED"
          ? (rtl ? "PDF الأصلي غير محفوظ في الأرشيف لتوفير المساحة. أعد رفع الملف نفسه من زر «أضف كتابًا»؛ ستعود هذه البطاقة بلا خصم أو تكرار." : "The original PDF is not kept in the archive. Re-upload the same file through Add a book; this record will return without a duplicate or charge.")
        : raw || (rtl ? "تعذرت استعادة الكتاب." : "Could not restore the book."));
    }
  };
  const confirmPermanentDelete = async () => {
    if (!bookToDelete) return;
    setDeleteBusy(true);
    setLibraryMessage("");
    try {
      const result = await deletePilotBook(bookToDelete);
      setBookToDelete(null);
      onBooksChanged();
      setLibraryMessage(result.cleanupWarning
        ? (rtl ? "حُذف سجل الكتاب نهائيًا، وتعذر تنظيف بعض الملفات التابعة تلقائيًا." : "The book record was permanently deleted, but some generated files could not be cleaned up automatically.")
        : (rtl ? "حُذف الكتاب وجميع نتائجه نهائيًا." : "The book and all its results were permanently deleted."));
    } catch (error) {
      setLibraryMessage(error instanceof Error ? error.message : rtl ? "تعذر حذف الكتاب نهائيًا." : "Could not permanently delete the book.");
    } finally {
      setDeleteBusy(false);
    }
  };
  return (
    <div className="page">
      <PageTitle
        title={title}
        description={
          rtl
            ? "مجموعة شخصية تنمو وتترابط مع كل كتاب تضيفه."
            : "A private collection that grows and connects with every book."
        }
        action={rtl ? "أضف كتابًا" : "Add a book"}
        onAction={onUpload}
      />
      {query && (
        <p className="search-status">
          {rtl
            ? `نتائج البحث عن «${searchQuery}»: ${filteredPilotBooks.length}`
            : `Search results for "${searchQuery}": ${filteredPilotBooks.length}`}
        </p>
      )}
      {!booksLoading && !booksError && pilotBooks.length > 0 && <>
        <div className="library-shelf-tabs">
          <button className={shelf === "active" ? "active" : ""} onClick={() => chooseShelf("active")}>{rtl ? `الكتب الأصلية ${activeBooks.length}/${MAX_ACTIVE_BOOKS}` : `Original books ${activeBooks.length}/${MAX_ACTIVE_BOOKS}`}</button>
          <button className={shelf === "archive" ? "active" : ""} onClick={() => chooseShelf("archive")}>{rtl ? `النسخ المعرفية ${archivedBooks.length}` : `Knowledge copies ${archivedBooks.length}`}</button>
        </div>
        <div className="classification-filter-summary">
          <button className="classification-filter-toggle" aria-expanded={classificationFiltersOpen} onClick={() => setClassificationFiltersOpen((open) => !open)}>⌄ {rtl ? "تصفية الكتب حسب التصنيف" : "Filter books by category"}</button>
          {categoryFilter !== "all" && <span className="active-classification-filter">{categoryFilter === "modern" ? (branchFilter === "all" ? gatewayLabel("modern", rtl) : modernTopicLabel(branchFilter, rtl)) : (branchFilter === "all" ? gatewayLabel(categoryFilter, rtl) : branchLabel(categoryFilter, branchFilter, rtl))}<button aria-label={rtl ? "مسح فلتر التصنيف" : "Clear category filter"} onClick={() => { setCategoryFilter("all"); setBranchFilter("all"); }}>×</button></span>}
        </div>
        {classificationFiltersOpen && <div className="classification-filter-drawer">
          <p>{rtl ? "تصنيف ديوي العشري — اختر بوابة رئيسية ثم تفريعًا عند الحاجة" : "Dewey Decimal Classification — choose a main class, then an optional subdivision"}</p>
          <div className="category-filter dewey-gateways" role="group" aria-label={rtl ? "بوابات التصنيف الإحدى عشرة" : "Eleven classification gateways"}>
            {DEWEY_GATEWAYS.map((gateway) => <button key={gateway.id} className={categoryFilter === gateway.id ? "active" : ""} onClick={() => { setCategoryFilter(gateway.id); setBranchFilter("all"); }}>{gatewayLabel(gateway.id, rtl)} <b>{shelfBooks.filter((book) => inferClassification(book).deweyMain === gateway.id).length}</b></button>)}
            <button className={categoryFilter === "modern" ? "active modern" : "modern"} onClick={() => { setCategoryFilter("modern"); setBranchFilter("all"); }}>{gatewayLabel("modern", rtl)} <b>{shelfBooks.filter((book) => Boolean(inferClassification(book).modernTopic)).length}</b></button>
          </div>
          {categoryFilter !== "all" && <div className="category-branches" role="group" aria-label={rtl ? "التفريعات" : "Subcategories"}>
            <button className={branchFilter === "all" ? "active" : ""} onClick={() => { setBranchFilter("all"); setClassificationFiltersOpen(false); }}>{rtl ? "عرض كل كتب هذا التصنيف" : "Show all books in this class"}</button>
            {categoryFilter === "modern"
              ? MODERN_TOPICS.map((topic) => <button key={topic[0]} className={branchFilter === topic[0] ? "active" : ""} onClick={() => { setBranchFilter(topic[0]); setClassificationFiltersOpen(false); }}>{rtl ? topic[1] : topic[2]}</button>)
              : (DEWEY_GATEWAYS.find((gateway) => gateway.id === categoryFilter)?.branches ?? []).map((branch) => <button key={branch[0]} className={branchFilter === branch[0] ? "active" : ""} onClick={() => { setBranchFilter(branch[0]); setClassificationFiltersOpen(false); }}>{branchLabel(categoryFilter, branch[0], rtl)}</button>)}
          </div>}
        </div>}
      </>}
      {libraryMessage && <p className="library-action-message">{libraryMessage}</p>}
      {booksLoading && (
        <section className="panel state-panel">
          {rtl ? "جارٍ تحميل مكتبتك…" : "Loading your library…"}
        </section>
      )}
      {!booksLoading && booksError && (
        <section className="panel state-panel error">
          <p>{booksError}</p>
          <button className="secondary" onClick={onRetry}>
            {rtl ? "إعادة المحاولة" : "Retry"}
          </button>
        </section>
      )}
      {!booksLoading && !booksError && pilotBooks.length === 0 && !query && (
        <section className="panel sample-library-panel">
          <span className="eyebrow">{rtl ? "ابدأ بصورة واضحة" : "Start with a clear preview"}</span>
          <h3>{rtl ? "كيف ستبدو مكتبتك" : "How your library will look"}</h3>
          <SampleShelf rtl={rtl} />
        </section>
      )}
      {!booksLoading && !booksError && filteredPilotBooks.length > 0 && (
        <section className="panel live-books">
          <span className="eyebrow">
            {rtl ? "كتب V0.7 المحفوظة" : "Saved V0.7 books"}
          </span>
          <h3>{query
            ? (rtl ? "نتائج البحث في المكتبة كاملة" : "Search results across the library")
            : shelf === "active"
              ? (rtl ? "مكتبة الكتب الأصلية" : "Original-book library")
              : (rtl ? "مكتبة النسخ المعرفية" : "Knowledge-copy library")}</h3>
          {shelf === "active" && <p className="active-shelf-limit">{rtl ? `يمكن عرض ستة كتب أصلية نشطة. المتاح الآن: ${MAX_ACTIVE_BOOKS - activeBooks.length}. الكتاب السابع يحتاج نقل كتاب إلى الأرشيف، دون فقد النتائج المدفوعة.` : `Six original books can remain active. Available now: ${MAX_ACTIVE_BOOKS - activeBooks.length}. A seventh requires archiving one book without losing paid outputs.`}</p>}
          {shelf === "archive" && !query && <p className="knowledge-shelf-note">{rtl ? "هذه نسخ معرفية خفيفة: الغلاف والفهرسة والتصنيف والخلاصة والتحليل والصوت والأسئلة محفوظة، بينما أزيل PDF الأصلي لتوفير المساحة." : "These are lightweight knowledge copies: cover, catalogue, classification, summary, analysis, audio and questions remain, while the original PDF was removed to save space."}</p>}
          <p className="pilot-session-warning">
            {rtl
              ? "تنبيه النسخة التجريبية: دخولك مرتبط بهذا المتصفح حاليًا؛ لا تمسح بيانات المتصفح قبل الترقية إلى حساب دائم أدناه."
              : "Pilot notice: access is currently tied to this browser. Do not clear browser data before upgrading to a permanent account below."}
          </p>
          {mobileShelfLayout ? <div className="mobile-category-shelves">
            {adaptiveMobileShelves.map(([label, books]) => <section className="mobile-category-shelf" key={label}>
              <div className="mobile-shelf-heading"><h4>{label}</h4><small>{rtl ? "اسحب لمشاهدة الكتب" : "Swipe to browse"} ↔</small></div>
              <div className="mobile-shelf-track">
                {books.map((book) => <LiveBookCard
                  key={book.id}
                  book={book}
                  rtl={rtl}
                  onOpen={() => onOpenPilot(book)}
                  onArchive={!isBookArchived(book) ? () => setBookToArchive(book) : undefined}
                  onRestore={isBookArchived(book) ? () => restoreBook(book) : undefined}
                  onDelete={isBookArchived(book) ? () => setBookToDelete(book) : undefined}
                  onClassificationChange={(classification) => changeClassification(book, classification)}
                />)}
              </div>
            </section>)}
          </div> : <div className="library-full live-book-grid">
            {filteredPilotBooks.map((book) => <LiveBookCard
              key={book.id}
              book={book}
              rtl={rtl}
              onOpen={() => onOpenPilot(book)}
              onArchive={!isBookArchived(book) ? () => setBookToArchive(book) : undefined}
              onRestore={isBookArchived(book) ? () => restoreBook(book) : undefined}
              onDelete={isBookArchived(book) ? () => setBookToDelete(book) : undefined}
              onClassificationChange={(classification) => changeClassification(book, classification)}
            />)}
          </div>}
        </section>
      )}
      {!booksLoading && !booksError && (
        <DuplicateReviewPanel rtl={rtl} groups={groupDuplicateBooks(activeBooks)} onBooksChanged={onBooksChanged} />
      )}
      {bookToArchive && (
        <div className="confirm-delete-backdrop" role="presentation" onMouseDown={() => !archiveBusy && setBookToArchive(null)}>
          <section className="confirm-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="archive-book-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="delete-dialog-icon">▣</span>
            <h3 id="archive-book-title">{rtl ? "نقل الكتاب إلى الأرشيف" : "Move book to archive"}</h3>
            <p>{rtl
              ? `هل تريد أرشفة «${bookToArchive.title}»؟ ستتحرر فتحة من الستة ويُحذف PDF الأصلي لتوفير المساحة، مع بقاء الغلاف والخلاصة والتحليل والصوت والأسئلة محفوظة. لاستعادته لاحقًا أعد رفع الملف نفسه.`
              : `Archive “${bookToArchive.title}”? One slot will be freed and the original PDF removed to save space, while its cover, summaries, analysis, audio and questions remain. Re-upload the same file to restore it later.`}</p>
            <div>
              <button className="primary" disabled={archiveBusy} onClick={confirmArchive}>{archiveBusy ? (rtl ? "جارٍ النقل…" : "Archiving…") : (rtl ? "نعم، انقل إلى الأرشيف" : "Yes, archive book")}</button>
              <button className="secondary" disabled={archiveBusy} onClick={() => setBookToArchive(null)}>{rtl ? "إلغاء" : "Cancel"}</button>
            </div>
          </section>
        </div>
      )}
      {bookToDelete && (
        <div className="confirm-delete-backdrop" role="presentation" onMouseDown={() => !deleteBusy && setBookToDelete(null)}>
          <section className="confirm-delete-dialog permanent-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-book-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="delete-dialog-icon">⌫</span>
            <h3 id="delete-book-title">{rtl ? "حذف نهائي لا يمكن التراجع عنه" : "Permanent deletion cannot be undone"}</h3>
            <p>{rtl
              ? `سيُحذف «${bookToDelete.title}» نهائيًا مع بطاقة الفهرسة والغلاف والخلاصة والتحليل والصوت والأسئلة. استخدم هذا الخيار فقط إذا لم تعد تريد الاحتفاظ بأي نتيجة.`
              : `“${bookToDelete.title}” will be permanently deleted with its catalogue card, cover, summaries, analysis, audio and questions. Use this only when you no longer want to keep any result.`}</p>
            <div>
              <button className="danger" disabled={deleteBusy} onClick={confirmPermanentDelete}>{deleteBusy ? (rtl ? "جارٍ الحذف…" : "Deleting…") : (rtl ? "نعم، احذف نهائيًا" : "Yes, delete permanently")}</button>
              <button className="secondary" disabled={deleteBusy} onClick={() => setBookToDelete(null)}>{rtl ? "إلغاء والاحتفاظ بالكتاب" : "Cancel and keep book"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function PilotWorkspace({
  rtl,
  book,
  onBack,
  onOpenReader,
  onReuploadOriginal,
  onBookPatched,
}: {
  rtl: boolean;
  book: PilotBook;
  onBack: () => void;
  onOpenReader: (page?: number) => void;
  onReuploadOriginal: () => void;
