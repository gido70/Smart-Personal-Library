import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import Reader, { type SavedBookRef } from "./Reader";
import {
  getBookResults,
  getAiLimitsSnapshot,
  getLibraryStats,
  getLegalConsentStatus,
  getPrivateAudioUrl,
  archivePilotBook,
  downloadBookFile,
  groupDuplicateBooks,
  invokeBookAI,
  listPilotBooks,
  rollbackPilotBook,
  saveFeedback,
  saveLegalConsent,
  saveManualImport,
  uploadPilotBook,
  updateBookClassification,
  restoreArchivedBook,
  isBookArchived,
  MAX_ACTIVE_BOOKS,
  type AiLimitsSnapshot,
  type BookClassificationPatch,
  type DuplicateGroup,
  type AiUsageEvent,
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
    search: "ابحث بالعنوان أو الموضوع أو التصنيف…",
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
    search: "Search by title, topic, or category…",
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
    // Never leave a restored/bfcached tab showing a library snapshot that may
    // have been deleted or changed in another tab. Hide the old snapshot while
    // Supabase is being read again.
    setPilotBooks([]);
    setLibraryStats({ analysedBooks: 0, questions: 0, audioParts: 0 });
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
    const refreshFromSupabase = () => setBooksLoadToken((n) => n + 1);
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
            <button onClick={() => setView("guide")} title={rtl ? "دليل الاستخدام" : "User guide"}>؟</button>
            <button onClick={activateLatestVersion} disabled={activating} title={rtl ? "تنشيط أحدث نسخة" : "Activate latest version"}>↻</button>
            <button onClick={switchLang} className="lang-switch">
              {rtl ? "EN" : "ع"}
            </button>
            <button onClick={() => setDark(!dark)}>{dark ? "☀" : "◐"}</button>
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
  const current = activePilotBooks[0];
  return (
    <div className="page">
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
        <article className="panel librarian-card">
          <div className="librarian-icon">✦</div>
          <span className="eyebrow">
            {rtl ? "توصية شخصية" : "Personal recommendation"}
          </span>
          <h3>{t.suggestion}</h3>
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
        </article>
      </section>
      <section className="panel library-preview">
        <SectionHead
          over={rtl ? "رفوفك الشخصية" : "Your shelves"}
          title={t.myLibrary}
          action={t.all}
          onAction={() => setView("library")}
        />
        <div className="book-grid active-book-grid">
          {activePilotBooks.length > 0
            ? activePilotBooks.map((book) => (
              <LiveBookCard key={book.id} book={book} rtl={rtl} onOpen={() => onOpenPilot(book)} />
            ))
            : <SampleShelf rtl={rtl} compact />}
          {activePilotBooks.length > 0 && activePilotBooks.length < MAX_ACTIVE_BOOKS && (
            <button className="add-book-card" onClick={onUpload}>
              <i>＋</i>
              <strong>{rtl ? "أضف كتابًا جديدًا" : "Add a new book"}</strong>
              <span>{rtl ? `${activePilotBooks.length}/6 كتب نشطة` : `${activePilotBooks.length}/6 active books`}</span>
            </button>
          )}
        </div>
      </section>
      <section className="journey">
        <SectionHead
          over={rtl ? "من الملف إلى المعرفة" : "From file to knowledge"}
          title={t.journey}
        />
        <div className="steps">
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
    rtl ? "" : book.source_language,
  ].filter(Boolean).join(" ").toLowerCase();
}

function OriginalPdfCover({ book }: { book: PilotBook }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [archivedCoverUrl, setArchivedCoverUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setFailed(false);
    setArchivedCoverUrl("");
    const render = async () => {
      const archivedCoverPath = String(book.metadata?.archive_cover_path ?? "");
      if (archivedCoverPath) {
        const coverBlob = await downloadBookFile(archivedCoverPath);
        objectUrl = URL.createObjectURL(coverBlob);
        if (!cancelled) setArchivedCoverUrl(objectUrl);
        return;
      }
      // Download through the authenticated Storage client instead of asking
      // PDF.js to range-fetch a short-lived signed URL. Samsung Internet and
      // some Android WebViews can reject those cross-origin range requests and
      // leave an empty canvas even though the book itself is available.
      const fileBlob = await downloadBookFile(book.storage_path);
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fileBlob.arrayBuffer()), disableFontFace: true }).promise;
      const first = await pdf.getPage(1);
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
    };
    render().catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [book.id, book.storage_path, book.metadata?.archive_cover_path]);
  if (failed) return <BookCover tone={coverToneFor(book.title)} title={book.title.split(" ").slice(0, 3).join(" ")} />;
  if (archivedCoverUrl) return <div className="book-cover original-pdf-cover"><img src={archivedCoverUrl} alt={book.title} /></div>;
  return <div className="book-cover original-pdf-cover"><canvas ref={canvasRef} aria-label={book.title} /></div>;
}

/** A real saved book; page one is rendered as its cover with a safe fallback. */
function LiveBookCard({
  book,
  rtl,
  onOpen,
  onArchive,
  onRestore,
  onClassificationChange,
}: {
  book: PilotBook;
  rtl: boolean;
  onOpen: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onClassificationChange?: (classification: BookClassificationPatch) => Promise<boolean | void> | boolean | void;
}) {
  const subtitle = languageLabel(book.source_language, rtl);
  const classification = inferClassification(book);
  const archived = isBookArchived(book);
  const status = book.status === "processing"
    ? (rtl ? "جارٍ التحليل — يمكنك مغادرة الصفحة" : "Analysis running — you may leave this page")
    : book.status === "failed"
      ? (rtl ? "تعذر التحليل — لم يُخصم طلب جديد" : "Analysis failed — no new request was charged")
      : book.analysis_ready
        ? (rtl ? "✓ تم التحليل" : "✓ Analysis complete")
        : (rtl ? "بانتظار التحليل" : "Awaiting analysis");
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
    <article className="book-card live-book-card">
      <button className="book-card-open" onClick={onOpen} aria-label={`${rtl ? "فتح" : "Open"} ${book.title}`}>
        <OriginalPdfCover book={book} />
      </button>
      <div className="live-book-copy">
        <span className="tag">{rtl ? "كتابك" : "Your book"}</span>
        <button className="book-title-button" onClick={onOpen}><h4>{book.title}</h4></button>
        <p>{subtitle}</p>
        <small>{status}</small>
        {onClassificationChange && editingClassification ? <div className="book-classification-editor">
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
        </div> : <button className="book-category-chips category-edit-trigger" onClick={() => { setDraftClassification(classification); setEditingClassification(true); }} aria-label={rtl ? "عرض أو تغيير تصنيف الكتاب" : "View or change book category"}><span className={`book-category-chip ${classification.deweyMain ? "" : "unclassified"}`}>{gatewayLabel(classification.deweyMain, rtl)}</span>{classification.deweyBranch && <span className="book-category-chip branch">{branchLabel(classification.deweyMain, classification.deweyBranch, rtl)}</span>}{classification.modernTopic && <span className="book-category-chip modern">{modernTopicLabel(classification.modernTopic, rtl)}</span>}<small>{rtl ? "اضغط للتغيير" : "Tap to change"}</small></button>}
        {onArchive && !archived && <button className="book-archive-button" onClick={onArchive}>▣ {rtl ? "نقل إلى الأرشيف" : "Move to archive"}</button>}
        {onRestore && archived && <button className="book-restore-button" onClick={onRestore}>↥ {rtl ? "إعادة إلى الكتب النشطة" : "Restore to active shelf"}</button>}
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
      {!compact && <p className="sample-library-intro">{rtl
        ? "هذه أمثلة توضيحية فقط لتعرف شكل المكتبة ومخرجات كل كتاب. لا تُرسل إلى OpenAI ولا تُحسب ضمن كتبك."
        : "These are display-only examples of the library and book outputs. They never call OpenAI and do not count as your books."}</p>}
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
  const [shelf, setShelf] = useState<"active" | "archive">("active");
  const [bookToArchive, setBookToArchive] = useState<PilotBook | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState("");
  const query = searchQuery.trim().toLowerCase();
  const activeBooks = pilotBooks.filter((book) => !isBookArchived(book));
  const archivedBooks = pilotBooks.filter(isBookArchived);
  const shelfBooks = shelf === "active" ? activeBooks : archivedBooks;
  const filteredPilotBooks = pilotBooks.filter((book) => {
    if (shelf === "active" ? isBookArchived(book) : !isBookArchived(book)) return false;
    const classification = inferClassification(book);
    const matchesQuery = !query || classificationSearchText(book, rtl).includes(query);
    const matchesCategory = categoryFilter === "all"
      || (categoryFilter === "modern" ? Boolean(classification.modernTopic) : classification.deweyMain === categoryFilter);
    const matchesBranch = branchFilter === "all"
      || (categoryFilter === "modern" ? classification.modernTopic === branchFilter : classification.deweyBranch === branchFilter);
    return matchesQuery && matchesCategory && matchesBranch;
  });
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
          <button className={shelf === "active" ? "active" : ""} onClick={() => { setShelf("active"); setCategoryFilter("all"); setBranchFilter("all"); setClassificationFiltersOpen(false); }}>{rtl ? `الكتب النشطة ${activeBooks.length}/${MAX_ACTIVE_BOOKS}` : `Active books ${activeBooks.length}/${MAX_ACTIVE_BOOKS}`}</button>
          <button className={shelf === "archive" ? "active" : ""} onClick={() => { setShelf("archive"); setCategoryFilter("all"); setBranchFilter("all"); setClassificationFiltersOpen(false); }}>{rtl ? `الأرشيف ${archivedBooks.length}` : `Archive ${archivedBooks.length}`}</button>
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
          <h3>{shelf === "active" ? (rtl ? "مكتبتك الفعلية" : "Your live library") : (rtl ? "أرشيفك المحفوظ" : "Your saved archive")}</h3>
          {shelf === "active" && <p className="active-shelf-limit">{rtl ? `يمكن عرض ستة كتب أصلية نشطة. المتاح الآن: ${MAX_ACTIVE_BOOKS - activeBooks.length}. الكتاب السابع يحتاج نقل كتاب إلى الأرشيف، دون فقد النتائج المدفوعة.` : `Six original books can remain active. Available now: ${MAX_ACTIVE_BOOKS - activeBooks.length}. A seventh requires archiving one book without losing paid outputs.`}</p>}
          <p className="pilot-session-warning">
            {rtl
              ? "تنبيه النسخة التجريبية: دخولك مرتبط بهذا المتصفح حاليًا؛ لا تمسح بيانات المتصفح قبل الترقية إلى حساب دائم أدناه."
              : "Pilot notice: access is currently tied to this browser. Do not clear browser data before upgrading to a permanent account below."}
          </p>
          <div className="library-full live-book-grid">
            {filteredPilotBooks.map((book) => (
              <LiveBookCard
                key={book.id}
                book={book}
                rtl={rtl}
                onOpen={() => onOpenPilot(book)}
                onArchive={shelf === "active" ? () => setBookToArchive(book) : undefined}
                onRestore={shelf === "archive" ? () => restoreBook(book) : undefined}
                onClassificationChange={(classification) => changeClassification(book, classification)}
              />
            ))}
          </div>
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
    </div>
  );
}

function PilotWorkspace({
  rtl,
  book,
  onBack,
  onOpenReader,
  onBookPatched,
}: {
  rtl: boolean;
  book: PilotBook;
  onBack: () => void;
  onOpenReader: (page?: number) => void;
  onBookPatched: (bookId: string, patch: Partial<PilotBook>) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [localAnalysis, setLocalAnalysis] = useState<LocalStructuralAnalysis | null>(null);
  const [manualImportSaved, setManualImportSaved] = useState<StoredAnalysis | null>(null);
  const [consent, setConsent] = useState<{ recorded: boolean; acceptedAt: string | null } | null>(null);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<Record<string, unknown> | null>(null);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [resultLanguage, setResultLanguage] = useState<"ar" | "en">(
    book.output_language === "en" ? "en" : rtl ? "ar" : "en",
  );
  const [professionalVoice, setProfessionalVoice] = useState<"marin" | "cedar">(() => localStorage.getItem(`spl-professional-voice-${book.id}`) === "cedar" ? "cedar" : "marin");
  const [voicePreviewUrls, setVoicePreviewUrls] = useState<Partial<Record<"marin" | "cedar", string>>>({});
  const [questionHistory, setQuestionHistory] = useState<Array<{ id: string; question: string; answer: Record<string, unknown>; language: "ar" | "en"; created_at: string }>>([]);
  const [usageTotals, setUsageTotals] = useState({ calls: 0, input: 0, output: 0, textCostUsd: 0, audioCharacters: 0, unpricedCalls: 0 });
  const [limits, setLimits] = useState<AiLimitsSnapshot | null>(null);
  const [busy, setBusy] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<
    "process" | "ask" | "audio" | ""
  >("");
  const [localBusy, setLocalBusy] = useState(false);
  const [localProgress, setLocalProgress] = useState<LocalAnalysisProgress | null>(null);
  const [localError, setLocalError] = useState("");
  const [manualText, setManualText] = useState("");
  const [manualErrors, setManualErrors] = useState<string[]>([]);
  const [manualBusy, setManualBusy] = useState(false);
  const [questionCostOpen, setQuestionCostOpen] = useState(false);
  const [bookSearchTerm, setBookSearchTerm] = useState("");
  const [bookSearchResults, setBookSearchResults] = useState<BookSearchMatch[] | null>(null);
  const selectProfessionalVoice = (voice: "marin" | "cedar") => {
    setProfessionalVoice(voice);
    localStorage.setItem(`spl-professional-voice-${book.id}`, voice);
  };
  const taskStorageKey = `spl-paid-task-${book.id}`;
  const beginPaidTask = (action: "process" | "ask" | "audio" | "audio_preview") => {
    const requestId = crypto.randomUUID();
    localStorage.setItem(taskStorageKey, JSON.stringify({ requestId, action, startedAt: new Date().toISOString(), language: resultLanguage, voice: professionalVoice }));
    setRecoveryMessage("");
    return requestId;
  };
  const finishPaidTask = () => localStorage.removeItem(taskStorageKey);
  const handlePaidFailure = (value: unknown) => {
    const raw = value instanceof Error ? value.message : String(value ?? "");
    if (/(PAID_AI_DISABLED|PRIVATE_PILOT_EMAIL_REQUIRED|DAILY_ANALYSIS_LIMIT_REACHED|DAILY_QUESTION_LIMIT_REACHED|PILOT_QUESTION_LIMIT_REACHED|LEGAL_CONSENT_REQUIRED|BOOK_NOT_PROCESSED|ANALYSIS_NOT_READY)/.test(raw)) {
      finishPaidTask();
      return;
    }
    setRecoveryMessage(rtl ? "انقطع الرد أو تعذر التحقق. بقيت المهمة محفوظة وسنبحث عن النتيجة دون إعادة الخصم؛ لا تضغط مرة أخرى." : "The response was interrupted or could not be verified. The task remains saved and will be checked without charging again; do not press again.");
  };
  useEffect(() => {
    setProfessionalVoice(localStorage.getItem(`spl-professional-voice-${book.id}`) === "cedar" ? "cedar" : "marin");
  }, [book.id]);
  const sizeMb = Math.max(0.1, (book.file_size || 0) / 1048576);
  const band = sizeMb < 5 ? "small" : sizeMb < 20 ? "medium" : "large";
  const estimates = {
    small: { analysis: [0.05, 0.35], audio: [0.1, 0.6] },
    medium: { analysis: [0.2, 0.9], audio: [0.1, 0.6] },
    large: { analysis: [0.5, 1.8], audio: [0.1, 0.6] },
  }[band];
  const money = ([low, high]: number[]) =>
    `$${low.toFixed(2)}–$${high.toFixed(2)}`;
  const reload = async () => {
    const [data, limitSnapshot] = await Promise.all([getBookResults(book.id), getAiLimitsSnapshot()]);
    setLimits(limitSnapshot);
    const paid = data.analyses.find(
      (a) =>
        ["overview", "chapters", "critical", "metadata"].includes(a.kind) &&
        (!a.source || a.source === "openai") &&
        a.language === resultLanguage,
    );
    setResults((paid?.content as Record<string, unknown>) ?? null);
    const local = data.analyses.find((a) => a.kind === "local_structural");
    setLocalAnalysis(
      (local?.content as unknown as LocalStructuralAnalysis) ?? null,
    );
    const manual = data.analyses.find((a) => a.kind === "manual_import");
    setManualImportSaved(manual ?? null);
    setQuestionHistory(data.questions.filter((item) => item.language === resultLanguage));
    const cost = calculateLoggedTextCost(data.usage as AiUsageEvent[]);
    setUsageTotals({
      calls: data.usage.length,
      input: data.usage.reduce((sum, item) => sum + (item.input_tokens ?? 0), 0),
      output: data.usage.reduce((sum, item) => sum + (item.output_tokens ?? 0), 0),
      textCostUsd: cost.usd,
      audioCharacters: cost.audioCharacters,
      unpricedCalls: cost.unpricedCalls,
    });
    const languageAudio = data.audio.filter(
      (item) => item.language === resultLanguage && item.voice === professionalVoice,
    );
    if (languageAudio.length)
      setAudioUrls(
        await Promise.all(
          languageAudio.map((item) => getPrivateAudioUrl(item.storage_path)),
        ),
      );
    else setAudioUrls([]);
  };
  useEffect(() => {
    reload()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    getLegalConsentStatus(book.id)
      .then(setConsent)
      .catch(() => setConsent(null));
  }, [book.id, resultLanguage, professionalVoice]);
  useEffect(() => {
    const raw = localStorage.getItem(taskStorageKey);
    if (!raw) return;
    let saved: { action?: string; startedAt?: string; language?: string; voice?: string } | null = null;
    try { saved = JSON.parse(raw); } catch { localStorage.removeItem(taskStorageKey); }
    if (!saved?.action || !saved.startedAt) return;
    const startedAt = Date.parse(saved.startedAt);
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > 2 * 60 * 60 * 1000) {
      localStorage.removeItem(taskStorageKey);
      setRecoveryMessage(rtl ? "انتهت مهلة مهمة سابقة. راجع النتائج قبل بدء طلب جديد؛ لن نضغط تلقائيًا." : "A previous task timed out. Review results before starting a new request; nothing will be retried automatically.");
      return;
    }
    setBusy(saved.action);
    setRecoveryMessage(rtl ? "تم العثور على مهمة مدفوعة سابقة. نتحقق من نتيجتها المحفوظة دون إنشاء طلب جديد." : "A previous paid task was found. Checking its saved result without creating a new request.");
    const check = async () => {
      try {
        const data = await getBookResults(book.id);
        const completed = saved?.action === "process"
          ? data.analyses.some((item) => item.kind === "overview" && item.language === saved?.language)
          : saved?.action === "audio"
            ? data.audio.some((item) => item.language === saved?.language && item.voice === saved?.voice)
            : saved?.action === "ask"
              ? data.questions.some((item) => Date.parse(item.created_at) >= startedAt)
              : data.usage.some((item) => item.action === "audio_preview" && Date.parse(item.created_at) >= startedAt);
        if (completed) {
          localStorage.removeItem(taskStorageKey);
          setBusy("");
          setRecoveryMessage(rtl ? "✓ اكتملت المهمة السابقة وحُفظت نتيجتها. لم يُنشأ طلب مكرر." : "✓ Previous task completed and was saved. No duplicate request was created.");
          await reload();
        }
      } catch { /* keep the task marker and retry the read only */ }
    };
    void check();
    const timer = window.setInterval(check, 5000);
    return () => window.clearInterval(timer);
  // The task is scoped to the saved book; changing UI language must not create a new task.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);
  const process = async () => {
    if (ZERO_COST_MODE) return;
    setBusy("process");
    setError("");
    const requestId = beginPaidTask("process");
    try {
      await invokeBookAI(book.id, "process", { language: resultLanguage, requestId });
      await reload();
      finishPaidTask();
      setConfirming("");
    } catch (e) {
      setError(describeAiError(e, rtl));
      handlePaidFailure(e);
    } finally {
      if (!localStorage.getItem(taskStorageKey)) setBusy("");
    }
  };
  const ask = async () => {
    if (ZERO_COST_MODE) return;
    if (!q.trim()) return;
    setBusy("ask");
    setError("");
    const requestId = beginPaidTask("ask");
    try {
      const data = await invokeBookAI(book.id, "ask", {
        question: q,
        language: resultLanguage,
        requestId,
      });
      setAnswer(data.answer);
      finishPaidTask();
      setConfirming("");
    } catch (e) {
      setError(describeAiError(e, rtl));
      handlePaidFailure(e);
    } finally {
      if (!localStorage.getItem(taskStorageKey)) setBusy("");
    }
  };
  const audio = async () => {
    if (ZERO_COST_MODE) return;
    setBusy("audio");
    setError("");
    const requestId = beginPaidTask("audio");
    try {
      const data = await invokeBookAI(book.id, "audio", {
        language: resultLanguage,
        voice: professionalVoice,
        requestId,
      });
      setAudioUrls(
        await Promise.all(
          data.audio.map((item: { storage_path: string }) =>
            getPrivateAudioUrl(item.storage_path),
          ),
        ),
      );
      await reload();
      finishPaidTask();
      setConfirming("");
    } catch (e) {
      setError(describeAiError(e, rtl));
      handlePaidFailure(e);
    } finally {
      if (!localStorage.getItem(taskStorageKey)) setBusy("");
    }
  };
  const previewVoice = async (voice: "marin" | "cedar") => {
    if (ZERO_COST_MODE) return;
    selectProfessionalVoice(voice);
    setBusy(`preview-${voice}`);
    setError("");
    const requestId = beginPaidTask("audio_preview");
    try {
      const data = await invokeBookAI(book.id, "audio_preview", {
        language: resultLanguage,
        voice,
        requestId,
      });
      const url = await getPrivateAudioUrl(data.storage_path);
      setVoicePreviewUrls((current) => ({ ...current, [voice]: url }));
      await reload();
      finishPaidTask();
    } catch (e) {
      setError(describeAiError(e, rtl));
      handlePaidFailure(e);
    } finally {
      if (!localStorage.getItem(taskStorageKey)) setBusy("");
    }
  };
  const runLocalAnalysis = async () => {
    setLocalBusy(true);
    setLocalError("");
    setLocalProgress(null);
    try {
      const { analysis, appliedBookPatch } = await runLocalStructuralAnalysis(book, setLocalProgress);
      setLocalAnalysis(analysis);
      setBookSearchResults(null);
      if (Object.keys(appliedBookPatch).length > 0) onBookPatched(book.id, appliedBookPatch);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      console.error("SPL: local analysis failed", e);
      setLocalError(
        raw.startsWith("MIGRATION_REQUIRED")
          ? rtl
            ? "يحتاج هذا إلى تطبيق ملف الترحيل (migration) الجديد أولًا — راجع CHANGED-FILES.md."
            : "This needs the new migration file applied first — see CHANGED-FILES.md."
          : raw ||
              (rtl ? "تعذر إجراء التحليل المحلي" : "Local analysis failed"),
      );
    } finally {
      setLocalBusy(false);
    }
  };
  const runBookSearch = () => {
    setBookSearchResults(searchInsideBook(localAnalysis?.pages_text, bookSearchTerm));
  };
  const submitManualImport = async () => {
    setManualErrors([]);
    setManualBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(manualText);
      } catch {
        setManualErrors([
          rtl
            ? "النص المُدخل ليس JSON صالحًا."
            : "The pasted text is not valid JSON.",
        ]);
        return;
      }
      const validation = validateManualImport(parsed);
      if (!validation.ok) {
        setManualErrors(validation.errors);
        return;
      }
      await saveManualImport(book.id, validation.data);
      await reload();
      setManualText("");
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      setManualErrors([
        raw.startsWith("MIGRATION_REQUIRED")
          ? rtl
            ? "يحتاج هذا إلى تطبيق ملف الترحيل (migration) الجديد أولًا — راجع CHANGED-FILES.md."
            : "This needs the new migration file applied first — see CHANGED-FILES.md."
          : raw ||
              (rtl
                ? "تعذر حفظ الاستيراد اليدوي"
                : "Could not save the manual import"),
      ]);
    } finally {
      setManualBusy(false);
    }
  };
  const statusLabelsAr: Record<PilotBook["status"], string> = {
    uploaded: "محفوظ",
    processing: "قيد المعالجة",
    ready: "جاهز",
    failed: "فشل",
  };
  const statusLabelsEn: Record<PilotBook["status"], string> = {
    uploaded: "Saved",
    processing: "Processing",
    ready: "Ready",
    failed: "Failed",
  };
  const languageLabel = (lang: string) =>
    lang === "ar"
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
              ? "غير معروفة"
              : "Unknown";
  return (
    <div className="page">
      <button className="back" onClick={onBack}>
        → {rtl ? "العودة إلى مكتبتي" : "Back to my library"}
      </button>
      <PageTitle
        title={book.title}
        description={
          rtl
            ? "محفوظ في مساحتك الخاصة. الحفظ وحده لا يستهلك رصيد OpenAI."
            : "Saved in your private space. Storage alone does not use OpenAI credit."
        }
      />
      <div className="mobile-book-tools" aria-label={rtl ? "اختصارات وظائف الكتاب" : "Book feature shortcuts"}>
        <button className="secondary" onClick={() => document.getElementById("ask-book-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{rtl ? "اسأل الكتاب" : "Ask"}</button>
        <button className="secondary" onClick={() => document.getElementById("professional-voice-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{rtl ? "اختيار الصوت" : "Choose voice"}</button>
      </div>
      {(busy || recoveryMessage) && <section className={`panel durable-task-banner ${busy ? "running" : "complete"}`} aria-live="polite">
        <div className="task-train" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <div><strong>{busy
          ? (rtl ? "المحتوى قيد التجهيز — المهمة محفوظة" : "Content is being prepared — task saved")
          : (rtl ? "تحديث حالة المهمة" : "Task status update")}</strong>
          <p>{recoveryMessage || (rtl ? "يمكنك إبقاء الصفحة مفتوحة أو العودة لاحقًا. لا تضغط الزر مرة أخرى؛ سنعرض النتيجة المحفوظة عند اكتمالها." : "You may keep this page open or return later. Do not press again; the saved result will appear when complete.")}</p>
        </div>
      </section>}
      <section className="panel book-info-card">
        <span className="eyebrow">
          {rtl ? "بيانات الكتاب المحفوظ" : "Saved book details"}
        </span>
        <dl className="book-info-grid">
          <div>
            <dt>{rtl ? "اسم الملف" : "File name"}</dt>
            <dd>{book.file_name}</dd>
          </div>
          <div>
            <dt>{rtl ? "الحجم" : "Size"}</dt>
            <dd>{sizeMb.toFixed(2)} MB</dd>
          </div>
          <div>
            <dt>{rtl ? "تاريخ الرفع" : "Uploaded"}</dt>
            <dd>
              {new Date(book.created_at).toLocaleString(rtl ? "ar" : "en")}
            </dd>
          </div>
          <div>
            <dt>{rtl ? "الحالة" : "Status"}</dt>
            <dd>
              {rtl ? statusLabelsAr[book.status] : statusLabelsEn[book.status]}
            </dd>
          </div>
          <div>
            <dt>{rtl ? "لغة المصدر" : "Source language"}</dt>
            <dd>{languageLabel(book.source_language)}</dd>
          </div>
          <div>
            <dt>{rtl ? "لغة المخرجات" : "Output language"}</dt>
            <dd>{languageLabel(book.output_language)}</dd>
          </div>
          <div>
            <dt>{rtl ? "مسار التخزين" : "Storage path"}</dt>
            <dd className="mono">{book.storage_path}</dd>
          </div>
          <div>
            <dt>{rtl ? "إقرار الحقوق" : "Legal consent"}</dt>
            <dd>
              {consent === null
                ? rtl
                  ? "جارٍ التحقق…"
                  : "Checking…"
                : consent.recorded
                  ? `${rtl ? "مُسجَّل" : "Recorded"}${
                      consent.acceptedAt
                        ? ` — ${new Date(consent.acceptedAt).toLocaleDateString(rtl ? "ar" : "en")}`
                        : ""
                    }`
                  : rtl
                    ? "غير مُسجَّل"
                    : "Not recorded"}
            </dd>
          </div>
        </dl>
      </section>
      <section className="service-map panel">
        <div className="free-lane">
          <span>{rtl ? "مجاني" : "FREE"}</span>
          <h3>
            {rtl
              ? "افتح الكتاب واستمع بصوت الجهاز"
              : "Read with your device voice"}
          </h3>
          <p>
            {rtl
              ? "يقرأ النص الأصلي على جهازك بلا إرسال إلى OpenAI وبلا خصم من رصيدك."
              : "Reads the original text on your device. Nothing is sent to OpenAI and no API credit is used."}
          </p>
          <button className="secondary" onClick={() => onOpenReader()}>
            ◫ {rtl ? "فتح القارئ والصوت المجاني" : "Open free reader & voice"}
          </button>
        </div>
        <div className="paid-lane">
          <span>{rtl ? "اختياري ومدفوع" : "OPTIONAL · PAID"}</span>
          <h3>
            {rtl
              ? "تحليل وترجمة وصوت احترافي"
              : "Analysis, translation & professional voice"}
          </h3>
          <p>
            {rtl
              ? `لغة النتيجة: ${languageLabel(book.output_language)}. لا تبدأ الخدمة إلا بعد تأكيدك.`
              : `Output: ${languageLabel(book.output_language)}. The service starts only after confirmation.`}
          </p>
          {ZERO_COST_MODE && (
            <p className="locked-note">
              🔒{" "}
              {rtl
                ? "مُقفلة في هذا الإصدار (وضع التكلفة الصفرية) — لا يُرسل أي طلب إلى OpenAI."
                : "Locked in this build (Zero-Cost Mode) — no request is ever sent to OpenAI."}
            </p>
          )}
        </div>
      </section>
      <section className="panel local-analysis-card">
        <span className="eyebrow">
          {rtl ? "مجاني — بدون OpenAI" : "FREE — no OpenAI"}
        </span>
        <h3>
          {rtl ? "التجربة المحلية المجانية" : "Free local experience"}
        </h3>
        <p>
          {rtl
            ? "تحليل بنيوي يعمل داخل متصفحك فقط عبر PDF.js: عدد الصفحات والكلمات، لغة النص، عناوين مرشّحة، أكثر الكلمات تكرارًا. هذا ليس تلخيصًا ولا ترجمة ولا تحليلًا بالذكاء الاصطناعي."
            : "A structural pass that runs only in your browser via PDF.js: page/word counts, detected language, candidate headings, top terms. This is not a summary, translation, or AI analysis."}
        </p>
        {!localAnalysis && !localBusy && (
          <button className="secondary" onClick={runLocalAnalysis}>
            ⌕ {rtl ? "شغّل التحليل المحلي المجاني" : "Run free local analysis"}
          </button>
        )}
        {localBusy && (
          <div className="local-progress">
            <Bar
              value={
                localProgress
                  ? Math.round((localProgress.page / localProgress.totalPages) * 100)
                  : 0
              }
            />
            <small>
              {localProgress
                ? rtl
                  ? `صفحة ${localProgress.page} من ${localProgress.totalPages}`
                  : `Page ${localProgress.page} of ${localProgress.totalPages}`
                : rtl
                  ? "جارٍ التحميل…"
                  : "Loading…"}
            </small>
          </div>
        )}
        {localError && <div className="reader-error inline">{localError}</div>}
        {localAnalysis && (
          <div className="local-analysis-results">
            <div className="local-stats">
              <b>
                {localAnalysis.page_count}
                <small>{rtl ? "صفحة" : "pages"}</small>
              </b>
              <b>
                {localAnalysis.word_count}
                <small>{rtl ? "كلمة" : "words"}</small>
              </b>
              <b>
                {languageLabel(localAnalysis.detected_language)}
                <small>{rtl ? "اللغة المكتشفة" : "detected language"}</small>
              </b>
              <b>
                {localAnalysis.heading_candidates.length}
                <small>{rtl ? "عنوان مرشّح" : "heading candidates"}</small>
              </b>
            </div>
            {(localAnalysis.extractive_summary?.length ?? 0) > 0 && (
              <div className="extractive-summary">
                <h4>{rtl ? "خلاصة استخراجية مجانية" : "Free extractive overview"}</h4>
                <p className="disclosure-note">
                  {rtl
                    ? "جمل مختارة آليًا من صفحات الكتاب نفسه، بلا ترجمة وبلا إعادة صياغة وبلا إرسال إلى أي خدمة خارجية."
                    : "Sentences selected from the book itself, with no translation, rewriting, or external service."}
                </p>
                <ol className="candidate-list">
                  {localAnalysis.extractive_summary?.map((item, index) => (
                    <li key={`${item.page}-${index}`}>
                      <em>{rtl ? `ص ${item.page}` : `p. ${item.page}`}</em> {item.text}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {localAnalysis.heading_candidates.length > 0 && (
              <details>
                <summary>
                  {rtl ? "العناوين المرشّحة" : "Heading candidates"}
                </summary>
                <ul className="candidate-list">
                  {localAnalysis.heading_candidates.slice(0, 15).map((h, i) => (
                    <li key={i}>
                      <em>{rtl ? `ص ${h.page}` : `p. ${h.page}`}</em> {h.text}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {localAnalysis.top_terms.length > 0 && (
              <details>
                <summary>{rtl ? "أكثر الكلمات تكرارًا" : "Top terms"}</summary>
                <ul className="candidate-list">
                  {localAnalysis.top_terms.slice(0, 15).map((term) => (
                    <li key={term.term}>
                      {term.term} — {term.count}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="book-search">
              <h4>{rtl ? "بحث داخل الكتاب (محلي)" : "Search inside the book (local)"}</h4>
              <p className="disclosure-note">
                {rtl
                  ? "بحث حرفي عن كلمة أو عبارة داخل صفحات الكتاب نفسها — ليس سؤالًا ذكيًا ولا يفهم المعنى، فقط يطابق النص ويعيد رقم الصفحة ومقتطفًا حقيقيًا."
                  : "A literal word/phrase match across the book's own pages — not a smart question, no meaning understanding, just real text matches with page numbers and a real snippet."}
              </p>
              {localAnalysis.pages_text ? (
                <>
                  <div className="book-search-form">
                    <input
                      type="text"
                      value={bookSearchTerm}
                      onChange={(e) => setBookSearchTerm(e.target.value)}
                      placeholder={rtl ? "اكتب كلمة أو عبارة…" : "Type a word or phrase…"}
                      onKeyDown={(e) => e.key === "Enter" && runBookSearch()}
                    />
                    <button className="secondary" onClick={runBookSearch} disabled={bookSearchTerm.trim().length < 2}>
                      {rtl ? "بحث" : "Search"}
                    </button>
                  </div>
                  {bookSearchResults && (
                    bookSearchResults.length > 0 ? (
                      <ul className="candidate-list">
                        {bookSearchResults.map((match, index) => (
                          <li key={`${match.page}-${index}`}>
                            <button className="search-result-link" onClick={() => onOpenReader(match.page)}>
                              <em>{rtl ? `افتح ص ${match.page}` : `Open p. ${match.page}`}</em> {match.snippet}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="disclosure-note">{rtl ? "لا توجد نتائج مطابقة." : "No matches found."}</p>
                    )
                  )}
                </>
              ) : (
                <p className="disclosure-note">
                  {rtl ? "غير متاح لهذا الكتاب — أعد تشغيل التحليل المحلي أعلاه لتفعيل البحث." : "Not available for this book — re-run the local analysis above to enable search."}
                </p>
              )}
            </div>
            <p className="disclosure-note">{localAnalysis.disclosure}</p>
            <button
              className="text-button"
              onClick={runLocalAnalysis}
              disabled={localBusy}
            >
              {rtl ? "إعادة التشغيل" : "Re-run"}
            </button>
          </div>
        )}
      </section>
      <section className="panel zero-cost-explainer">
        <span className="eyebrow">
          {rtl ? "مساران واضحان بلا التباس" : "Two clearly separated paths"}
        </span>
        <h3>
          {rtl ? "المحلي للاستخراج، وOpenAI للفهم" : "Local extraction; OpenAI understanding"}
        </h3>
        <p>
          {rtl
            ? "لا نسخ ولا JSON ولا خطوات تقنية. البحث الحرفي والبيانات البنيوية يعملان في المتصفح. التلخيص والترجمة والأسئلة والصوت الاحترافي تستخدم OpenAI فقط بعد تأكيد مستقل لكل خدمة."
            : "No copying, JSON, or technical steps. Literal search and structural metadata run in the browser. Summaries, translation, questions, and professional audio use OpenAI only after a separate confirmation for each service."}
        </p>
      </section>
      <section className="budget-card panel">
        <div>
          <span className="eyebrow">
              {rtl ? "حماية ميزانية التجربة" : "Pilot budget protection"}
          </span>
          <h3>
            {rtl
                ? "الميزانية التي خصصتها عند بدء التجربة: 10 دولارات"
                : "Starting budget allocated to this pilot: $10"}
          </h3>
          <p>
            {rtl
                ? "هذه ليست قراءة حية لرصيد OpenAI الحالي. راجع صفحة Billing لمعرفة الرصيد المتبقي فعليًا؛ والنطاقات أدناه تقديرات تخطيطية وليست فاتورة."
                : "This is not a live reading of your current OpenAI balance. Check Billing for the actual remainder; the ranges below are planning estimates, not a bill."}
          </p>
        </div>
        <div className="budget-numbers">
          <b>
            {money(estimates.analysis)}
            <small>
              {rtl
                ? "تحليل/ترجمة هذا الكتاب"
                : "analysis/translation for this book"}
            </small>
          </b>
          <b>
            {money(estimates.audio)}
            <small>
              {rtl ? "خلاصة صوتية احترافية" : "professional audio summary"}
            </small>
          </b>
          <b>
            {money([
              PAID_PILOT_MAX_BOOKS * (estimates.analysis[0] + estimates.audio[0]),
              PAID_PILOT_MAX_BOOKS * (estimates.analysis[1] + estimates.audio[1]),
            ])}
            <small>
              {rtl ? "سقف تخطيطي لستة كتب مماثلة" : "planning range for six similar books"}
            </small>
          </b>
          <b>
            {usageTotals.calls}
            <small>{rtl ? "استدعاءات مسجلة لهذا الكتاب" : "logged calls for this book"}</small>
          </b>
          <b>
            ${usageTotals.textCostUsd.toFixed(4)}
            <small>{rtl ? "تكلفة النص المحسوبة لهذا الكتاب" : "calculated text cost for this book"}</small>
          </b>
        </div>
        <small>
          {rtl
            ? `حجم الملف: ${sizeMb.toFixed(1)} MB · رموز النص: إدخال ${usageTotals.input.toLocaleString()} / إخراج ${usageTotals.output.toLocaleString()} · أحرف الصوت المرسلة: ${usageTotals.audioCharacters.toLocaleString()} · الشحن التلقائي مغلق. تكلفة النص محسوبة وفق سعر النموذج؛ الصوت يبقى تقديرًا لأن واجهة الصوت لا تعيد رموز الفوترة في الاستجابة.`
            : `File size: ${sizeMb.toFixed(1)} MB · text tokens: ${usageTotals.input.toLocaleString()} in / ${usageTotals.output.toLocaleString()} out · audio characters sent: ${usageTotals.audioCharacters.toLocaleString()} · auto-reload is off. Text cost uses the model rate; audio remains an estimate because the speech response does not return billing-token usage.`}
        </small>
      </section>
      {limits && <section className="panel usage-limits-card" aria-live="polite">
        <div><span>{rtl ? "تحليلات اليوم" : "Analyses today"}</span><strong>{limits.analysesToday}/{limits.analysisLimit}</strong><small>{rtl ? `المتبقي ${Math.max(0, limits.analysisLimit - limits.analysesToday)}` : `${Math.max(0, limits.analysisLimit - limits.analysesToday)} remaining`}</small></div>
        <div><span>{rtl ? "أسئلة اليوم" : "Questions today"}</span><strong>{limits.questionsToday}/{limits.dailyQuestionLimit}</strong><small>{rtl ? `المتبقي ${Math.max(0, limits.dailyQuestionLimit - limits.questionsToday)}` : `${Math.max(0, limits.dailyQuestionLimit - limits.questionsToday)} remaining`}</small></div>
        <div><span>{rtl ? "إجمالي أسئلة التجربة" : "Pilot questions total"}</span><strong>{limits.questionsTotal}/{limits.totalQuestionLimit}</strong><small>{rtl ? `المتبقي ${Math.max(0, limits.totalQuestionLimit - limits.questionsTotal)}` : `${Math.max(0, limits.totalQuestionLimit - limits.questionsTotal)} remaining`}</small></div>
        <p>{rtl ? `تتجدد الحدود اليومية في ${new Date(limits.resetsAt).toLocaleString("ar")}. عند بلوغ الحد يتوقف الطلب قبل OpenAI ولا يحدث خصم.` : `Daily limits reset at ${new Date(limits.resetsAt).toLocaleString("en")}. At the limit, the request stops before OpenAI and no charge occurs.`}</p>
      </section>}
      {loading ? (
        <section className="panel">
          {rtl ? "جارٍ تحميل النتائج…" : "Loading results…"}
        </section>
      ) : (
        <div className="pilot-grid">
          <article className="panel reading-surface">
            <span className="eyebrow">
              {rtl ? "نتائج الذكاء الاصطناعي المدفوعة" : "Paid AI results"}
            </span>
            <h3>
              {rtl
                ? "الخلاصة والتحليل والفصول"
                : "Summary, analysis and chapters"}
            </h3>
            <label className="select-label paid-language-select">
              {rtl ? "لغة النتيجة الحالية" : "Current result language"}
              <select value={resultLanguage} onChange={(event) => setResultLanguage(event.target.value as "ar" | "en")}>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </label>
            {ZERO_COST_MODE ? (
              <div className="paid-empty locked">
                <p>
                  🔒{" "}
                  {rtl
                    ? "هذه الميزة مقفلة في وضع التكلفة الصفرية لهذا الإصدار. جرّب بدلًا منها التحليل المحلي المجاني أو الاستيراد اليدوي أعلاه."
                    : "This feature is locked in this build's Zero-Cost Mode. Try the free local analysis or manual import above instead."}
                </p>
              </div>
            ) : (
              !results && (
              <div className="paid-empty">
                <p>
                  {rtl
                    ? "لم يُرسل الكتاب إلى OpenAI بعد، ولذلك لم يُخصم شيء للتحليل."
                    : "This book has not been sent to OpenAI, so no analysis credit has been used."}
                </p>
                {confirming !== "process" ? (
                  <button
                    className="primary"
                    onClick={() => setConfirming("process")}
                  >
                    ✦{" "}
                    {rtl
                      ? `اطلب التحليل والترجمة — تقدير ${money(estimates.analysis)}`
                      : `Request analysis & translation — est. ${money(estimates.analysis)}`}
                  </button>
                ) : (
                  <div className="cost-confirm">
                    <strong>
                      {rtl ? "تأكيد خدمة مدفوعة" : "Confirm paid service"}
                    </strong>
                    <p>
                      {rtl
                          ? "سيُرسل هذا الكتاب إلى OpenAI ويُخصم الاستهلاك من رصيد API الفعلي في حسابك."
                          : "This book will be sent to OpenAI and usage will be deducted from the actual API credit in your account."}
                    </p>
                    <button
                      className="primary"
                      disabled={Boolean(busy)}
                      onClick={process}
                    >
                      {busy === "process"
                        ? "…"
                        : rtl
                          ? "أوافق وابدأ التحليل"
                          : "Confirm and analyse"}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setConfirming("")}
                    >
                      {rtl ? "تراجع" : "Go back"}
                    </button>
                  </div>
                )}
              </div>
              )
            )}
            {results && <PaidResultView result={results} rtl={rtl} />}
          </article>
          <aside className="detail-aside">
            <section className="panel" id="ask-book-panel">
              <h3>{rtl ? "اسأل الكتاب — مدفوع" : "Ask the book — paid"}</h3>
              {ZERO_COST_MODE ? (
                <p className="locked-note">
                  🔒{" "}
                  {rtl
                    ? "قريبًا — غير مفعّلة في وضع التكلفة الصفرية لهذا الإصدار."
                    : "Coming soon — disabled in this build's Zero-Cost Mode."}
                </p>
              ) : (
                <>
                  <button className="secondary question-cost-button" onClick={() => setQuestionCostOpen((open) => !open)}>{rtl ? "اعرف فائدة السؤال وتكلفته أولًا" : "See question purpose and cost first"}</button>
                  {questionCostOpen && <div className="question-cost-info"><strong>{rtl ? "قبل أن تكتب السؤال" : "Before you ask"}</strong><p>{rtl ? "الفائدة: إجابة مرتبطة بتحليل هذا الكتاب مع مراجع عند توفرها. كل سؤال خدمة مستقلة مدفوعة؛ التقدير التخطيطي للسؤال القصير $0.01–$0.15، وقد يزيد مع طول السؤال والإجابة. لا يبدأ الخصم إلا بعد زر التأكيد." : "Purpose: a book-grounded answer with references when available. Each question is a separate paid action; a short-question planning estimate is $0.01–$0.15 and may increase with length. Billing starts only after confirmation."}</p></div>}
                  <p className="question-purpose-note">
                    {results
                      ? (rtl ? "اكتب سؤالًا محددًا؛ ستأتي الإجابة من تحليل هذا الكتاب مع مراجع عند توفرها." : "Ask a specific question; the answer uses this book's analysis and includes references when available.")
                      : (rtl ? "تُفعّل الأسئلة بعد اكتمال تحليل هذا الكتاب." : "Questions become available after this book is analyzed.")}
                  </p>
                  <button
                    className="secondary sample-question-button"
                    disabled={!results}
                    onClick={() => setQ(rtl ? "ما الأفكار المحورية في هذا الكتاب، وما الأدلة التي اعتمد عليها المؤلف؟" : "What are the book's central ideas, and what evidence does the author use?")}
                  >
                    {rtl ? "استخدم سؤالًا نموذجيًا" : "Use a sample question"}
                  </button>
                  <textarea
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={rtl ? "اكتب سؤالك…" : "Type your question…"}
                  />
                  {confirming !== "ask" ? (
                    <button
                      className="secondary"
                      disabled={!results || !q.trim()}
                      onClick={() => setConfirming("ask")}
                    >
                      {rtl ? "راجع التكلفة وأرسل" : "Review cost & ask"}
                    </button>
                  ) : (
                    <div className="cost-confirm">
                      <p>
                        {rtl
                          ? "كل سؤال يستخدم API. ابدأ بعدد قليل في التجربة."
                          : "Each question uses the API. Keep the pilot small."}
                      </p>
                      <button
                        className="primary"
                        disabled={Boolean(busy)}
                        onClick={ask}
                      >
                        {busy === "ask"
                          ? "…"
                          : rtl
                            ? "تأكيد وإرسال"
                            : "Confirm & ask"}
                      </button>
                    </div>
                  )}
                  {answer && <div className="answer-live"><strong>{String(answer.answer ?? "")}</strong>{Array.isArray(answer.references) && <ul>{answer.references.map((item, index) => <li key={index}>{readableItem(item)}</li>)}</ul>}<small>{rtl ? "الثقة" : "Confidence"}: {String(answer.confidence ?? "—")}</small></div>}
                  {questionHistory.length > 0 && <details className="question-history"><summary>{rtl ? `الأسئلة المحفوظة (${questionHistory.length})` : `Saved questions (${questionHistory.length})`}</summary>{questionHistory.map((item) => <div key={item.id}><b>{item.question}</b><p>{String(item.answer.answer ?? "")}</p></div>)}</details>}
                </>
              )}
            </section>
            <section className="panel" id="professional-voice-panel">
              <h3>
                {rtl ? "الصوت الاحترافي — مدفوع" : "Professional voice — paid"}
              </h3>
              {ZERO_COST_MODE ? (
                <p className="locked-note">
                  🔒{" "}
                  {rtl
                    ? "قريبًا — غير مفعّلة في وضع التكلفة الصفرية لهذا الإصدار. صوت الجهاز المجاني متاح في القارئ."
                    : "Coming soon — disabled in this build's Zero-Cost Mode. Free device voice is available in the reader."}
                </p>
              ) : (
                <>
                  <p>
                    {rtl
                      ? `تقدير الخلاصة الصوتية: ${money(estimates.audio)}. صوت الجهاز المجاني موجود في القارئ.`
                      : `Estimated audio summary: ${money(estimates.audio)}. Free device voice is available in the reader.`}
                  </p>
                  <p className="voice-preview-note">
                    {rtl
                      ? "استمع إلى عينة قصيرة أولًا. تُنشأ العينة مرة واحدة بتكلفة ضئيلة جدًا، ثم يعاد تشغيلها دون تكلفة."
                      : "Listen to a short sample first. It has a tiny one-time generation cost, then replays at no cost."}
                  </p>
                  <div className="voice-choice-grid">
                    {(["marin", "cedar"] as const).map((voice) => (
                      <div className={`voice-choice ${professionalVoice === voice ? "selected" : ""}`} key={voice}>
                        <button
                          className="voice-select"
                          aria-pressed={professionalVoice === voice}
                          onClick={() => selectProfessionalVoice(voice)}
                        >
                          <span className="voice-radio" aria-hidden="true">{professionalVoice === voice ? "●" : "○"}</span>
                          <strong>{voice === "marin" ? (rtl ? "صوت أنثوي — Marin" : "Female voice — Marin") : (rtl ? "صوت رجالي — Cedar" : "Male voice — Cedar")}</strong>
                          <span>{rtl ? "هادئ، دافئ، وقراءة متزنة" : "Calm, warm, balanced narration"}</span>
                          {professionalVoice === voice && <b className="voice-selected-label">{rtl ? "مختار لإنشاء الصوت الكامل" : "Selected for full audio"}</b>}
                        </button>
                        <button className="secondary voice-preview-button" disabled={Boolean(busy)} onClick={() => previewVoice(voice)}>
                          {busy === `preview-${voice}` ? "…" : rtl ? "أنشئ/شغّل العينة" : "Create/play sample"}
                        </button>
                        {voicePreviewUrls[voice] && <audio controls preload="metadata" src={voicePreviewUrls[voice]} />}
                      </div>
                    ))}
                  </div>
                  <p className="selected-voice-summary">
                    {rtl ? "الصوت المختار للشراء: " : "Voice selected for purchase: "}
                    <strong>{professionalVoice === "marin" ? (rtl ? "الأنثوي — Marin" : "Female — Marin") : (rtl ? "الرجالي — Cedar" : "Male — Cedar")}</strong>
                  </p>
                  {confirming !== "audio" ? (
                    <button
                      className="secondary"
                      disabled={!results}
                      onClick={() => setConfirming("audio")}
                    >
                      {rtl ? "راجع التكلفة" : "Review cost"}
                    </button>
                  ) : (
                    <div className="cost-confirm">
                      <strong className="confirm-voice-name">
                        {rtl ? "سيُنشأ الصوت الكامل باستخدام: " : "Full audio will use: "}
                        {professionalVoice === "marin" ? (rtl ? "الصوت الأنثوي — Marin" : "Female — Marin") : (rtl ? "الصوت الرجالي — Cedar" : "Male — Cedar")}
                      </strong>
                      <button
                        className="primary"
                        disabled={Boolean(busy)}
                        onClick={audio}
                      >
                        {busy === "audio"
                          ? "…"
                          : rtl
                            ? "أوافق وأنشئ الصوت"
                            : "Confirm & generate"}
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setConfirming("")}
                      >
                        {rtl ? "تراجع" : "Go back"}
                      </button>
                    </div>
                  )}
                  {audioUrls.length > 0 && <div className="professional-audio-list">{audioUrls.map((url, index) => <label key={url}><span>{rtl ? `الجزء ${index + 1}` : `Part ${index + 1}`}</span><audio controls preload="metadata" src={url} /></label>)}<small>{rtl ? "هذه الأصوات مولدة بالذكاء الاصطناعي." : "These voices are AI-generated."}</small></div>}
                </>
              )}
            </section>
