import { type FormEvent, useEffect, useMemo, useState } from "react";
import Reader, { type SavedBookRef } from "./Reader";
import {
  getBookResults,
  getLibraryStats,
  getPrivateAudioUrl,
  getReadingProgress,
  invokeBookAI,
  listPilotBooks,
  saveLegalConsent,
  uploadPilotBook,
  type LibraryStats,
  type PilotBook,
} from "./lib/library";
import { runLocalStructuralAnalysis, type LocalAnalysisProgress } from "./lib/localAnalysis";
import { signInLibraryAccount, signOutLibraryAccount, signUpLibraryAccount, supabase } from "./lib/supabase";
import { ZERO_COST_MODE } from "./lib/config";
import {
  disableBookReminder,
  enablePushForThisDevice,
  listBookReminders,
  saveBookReminder,
  showLocalNotification,
  type BookReminder,
} from "./lib/reminders";

type Lang = "ar" | "en";
type View = "home" | "library" | "book" | "reader";
type Filter = "all" | "new" | "reading" | "ready";

type BookBundle = Awaited<ReturnType<typeof getBookResults>>;

const copy = {
  ar: {
    name: "المكتبة الشخصية الذكية",
    version: "رحلة الكتاب — V0.11",
    intro: "اقرأ، تابع من حيث توقفت، حلّل واستمع واسأل — وكل مرحلة واضحة أمامك.",
    add: "أضف كتابًا",
    library: "مكتبتي",
    home: "الرئيسية",
    search: "ابحث بعنوان الكتاب…",
  },
  en: {
    name: "Smart Personal Library",
    version: "Book Journey — V0.11",
    intro: "Read, resume, analyze, listen and ask — with every stage visible.",
    add: "Add a book",
    library: "My library",
    home: "Home",
    search: "Search by book title…",
  },
};

function friendlyError(error: unknown, rtl: boolean) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const map: Record<string, [string, string]> = {
    PAID_AI_DISABLED: ["الذكاء المدفوع ما زال مقفلاً من الخادم. لن تُخصم أي تكلفة.", "Paid AI is still server-locked. No cost can be charged."],
    PRIVATE_PILOT_EMAIL_REQUIRED: ["الحساب الحالي غير مصرح له بالتجربة المدفوعة الخاصة.", "This account is not authorized for the private paid pilot."],
    V011_MIGRATION_REQUIRED: ["بنية التنبيهات V0.11 تحتاج تطبيق Migration بعد المراجعة.", "The V0.11 reminder schema needs its reviewed migration."],
    VAPID_NOT_CONFIGURED: ["التنبيهات الخلفية جاهزة في الكود، لكن مفاتيح Web Push لم تُضف بعد.", "Background push is coded, but Web Push keys are not configured yet."],
    PUSH_PERMISSION_DENIED: ["لم يسمح الجهاز بالإشعارات. يمكنك تفعيلها من إعدادات الموقع.", "Notification permission was not granted. Enable it in site settings."],
    PUSH_UNSUPPORTED: ["هذا المتصفح لا يدعم Web Push بهذه الطريقة.", "This browser does not support Web Push in this mode."],
    FILE_TOO_LARGE_20MB: ["حجم الملف يتجاوز 20MB في النسخة التجريبية الحالية.", "The current pilot accepts files up to 20MB."],
    TOO_MANY_PAGES_250: ["النسخة التجريبية الحالية تقبل حتى 250 صفحة.", "The current pilot accepts up to 250 pages."],
  };
  const match = Object.entries(map).find(([key]) => raw.includes(key));
  return match ? match[1][rtl ? 0 : 1] : raw;
}

export default function AppV11() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("spl-lang") === "en" ? "en" : "ar"));
  const rtl = lang === "ar";
  const t = copy[lang];
  const [view, setView] = useState<View>("home");
  const [auth, setAuth] = useState<"loading" | "out" | "in">("loading");
  const [email, setEmail] = useState("");
  const [books, setBooks] = useState<PilotBook[]>([]);
  const [stats, setStats] = useState<LibraryStats>({ analysedBooks: 0, questions: 0, audioParts: 0 });
  const [active, setActive] = useState<PilotBook | null>(null);
  const [readerBook, setReaderBook] = useState<SavedBookRef | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  const switchLang = () => {
    const next = lang === "ar" ? "en" : "ar";
    setLang(next);
    localStorage.setItem("spl-lang", next);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextBooks, nextStats] = await Promise.all([listPilotBooks(), getLibraryStats()]);
      setBooks(nextBooks);
      setStats(nextStats);
      setActive((current) => current ? nextBooks.find((b) => b.id === current.id) ?? current : current);
    } catch (error) {
      setNotice(friendlyError(error, rtl));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!supabase) { setAuth("out"); return; }
    supabase.auth.getSession().then(({ data }) => {
      const permanent = Boolean(data.session && !(data.session.user as { is_anonymous?: boolean }).is_anonymous);
      setAuth(permanent ? "in" : "out");
      setEmail(permanent ? data.session?.user.email ?? "" : "");
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const permanent = Boolean(session && !(session.user as { is_anonymous?: boolean }).is_anonymous);
      setAuth(permanent ? "in" : "out");
      setEmail(permanent ? session?.user.email ?? "" : "");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (auth === "in") refresh();
  }, [auth]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("SPL_SW_REGISTER_FAILED", error));
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("book");
    if (id && books.length) {
      const found = books.find((book) => book.id === id);
      if (found) { setActive(found); setView("book"); }
    }
  }, [books]);

  if (auth !== "in") return <Login rtl={rtl} loading={auth === "loading"} onLang={switchLang} onDone={() => setAuth("in")} />;

  const filtered = books.filter((book) => {
    const queryOk = !search.trim() || book.title.toLowerCase().includes(search.trim().toLowerCase());
    const stateOk = filter === "all" || (filter === "new" && book.status === "uploaded") || (filter === "ready" && book.status === "ready") || (filter === "reading" && book.status !== "failed");
    return queryOk && stateOk;
  });

  const openBook = (book: PilotBook) => { setActive(book); setView("book"); };
  const openReader = (book: PilotBook, initialPage?: number) => {
    setActive(book);
    setReaderBook({ id: book.id, title: book.title, storagePath: book.storage_path, initialPage });
    setView("reader");
  };

  return (
    <div className="v11-app" dir={rtl ? "rtl" : "ltr"} lang={lang}>
      <aside className="v11-sidebar">
        <button className="v11-brand" onClick={() => setView("home")}><b>ك</b><span><strong>{t.name}</strong><small>{t.version}</small></span></button>
        <nav>
          <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>⌂ <span>{t.home}</span></button>
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>▥ <span>{t.library}</span></button>
          <button onClick={() => setShowUpload(true)}>＋ <span>{t.add}</span></button>
        </nav>
        <div className="v11-account"><small>{rtl ? "حسابك الموحد" : "Unified account"}</small><strong>{email}</strong><button onClick={() => signOutLibraryAccount()}>↪</button></div>
      </aside>
      <main className="v11-main">
        <header className="v11-topbar">
          <form onSubmit={(e) => { e.preventDefault(); setView("library"); }}><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} /><button>⌕</button></form>
          <button onClick={switchLang}>{rtl ? "EN" : "ع"}</button>
          <button className="v11-bell" onClick={async () => {
            try { await enablePushForThisDevice(); setNotice(rtl ? "تم تفعيل إشعارات هذا الجهاز." : "Notifications enabled for this device."); }
            catch (error) { setNotice(friendlyError(error, rtl)); }
          }}>🔔</button>
        </header>

        {view === "home" && <Home rtl={rtl} books={books} stats={stats} onAdd={() => setShowUpload(true)} onLibrary={() => setView("library")} onOpen={openBook} onRead={openReader} />}
        {view === "library" && <Library rtl={rtl} books={filtered} total={books.length} filter={filter} setFilter={setFilter} loading={loading} onAdd={() => setShowUpload(true)} onOpen={openBook} onRead={openReader} />}
        {view === "book" && active && <BookWorkspace rtl={rtl} book={active} onBack={() => setView("library")} onRead={(page) => openReader(active, page)} onChanged={refresh} />}
        {view === "reader" && <Reader rtl={rtl} savedBook={readerBook} onExitSavedBook={() => setView(active ? "book" : "library")} />}
      </main>

      <nav className="v11-mobile-nav"><button onClick={() => setView("home")}>⌂<small>{t.home}</small></button><button onClick={() => setView("library")}>▥<small>{t.library}</small></button><button onClick={() => setShowUpload(true)}>＋<small>{t.add}</small></button></nav>
      {showUpload && <UploadModal rtl={rtl} onClose={() => setShowUpload(false)} onDone={async (book) => { await refresh(); setActive(book); setShowUpload(false); setView("book"); }} />}
      {notice && <button className="v11-toast" onClick={() => setNotice("")}>{notice}</button>}
    </div>
  );
}

function Login({ rtl, loading, onLang, onDone }: { rtl: boolean; loading: boolean; onLang: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("aarahman70@gmail.com");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMessage("");
    try {
      if (mode === "up") {
        const result = await signUpLibraryAccount(email, password);
        if (result.session) onDone();
        else { setMode("in"); setMessage(rtl ? "أُنشئ الحساب. أكّد البريد مرة واحدة ثم سجّل الدخول." : "Account created. Confirm your email once, then sign in."); }
      } else { await signInLibraryAccount(email, password); onDone(); }
    } catch (error) { setMessage(friendlyError(error, rtl)); }
    finally { setBusy(false); }
  };
  return <div className="v11-login" dir={rtl ? "rtl" : "ltr"}><button className="v11-lang" onClick={onLang}>{rtl ? "EN" : "ع"}</button><form onSubmit={submit}><b className="v11-login-mark">ك</b><small>{rtl ? "المكتبة الشخصية الذكية — V0.11" : "Smart Personal Library — V0.11"}</small><h1>{mode === "in" ? (rtl ? "ادخل إلى مكتبتك" : "Enter your library") : (rtl ? "أنشئ حساب مكتبتك" : "Create your library account")}</h1><p>{rtl ? "حساب واحد على الهاتف والكمبيوتر. تقدم القراءة والملخصات والصوت مرتبطة بنفس المكتبة." : "One account across phone and desktop. Reading progress, summaries and audio stay with the same library."}</p><label>{rtl ? "البريد" : "Email"}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>{rtl ? "كلمة المرور" : "Password"}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{message && <div className="v11-message">{message}</div>}<button className="primary" disabled={loading || busy}>{busy ? (rtl ? "جارٍ التنفيذ…" : "Working…") : mode === "in" ? (rtl ? "دخول" : "Sign in") : (rtl ? "إنشاء الحساب" : "Create account")}</button><button type="button" className="text-button" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? (rtl ? "إنشاء حساب جديد" : "Create a new account") : (rtl ? "لدي حساب بالفعل" : "I already have an account")}</button></form></div>;
}

function Home({ rtl, books, stats, onAdd, onLibrary, onOpen, onRead }: { rtl: boolean; books: PilotBook[]; stats: LibraryStats; onAdd: () => void; onLibrary: () => void; onOpen: (b: PilotBook) => void; onRead: (b: PilotBook) => void }) {
  const latest = books[0];
  return <div className="v11-page"><section className="v11-hero"><div><span>{rtl ? "مكتبتك تنمو معك" : "Your library grows with you"}</span><h1>{rtl ? "كل كتاب له رحلة واضحة" : "Every book has a clear journey"}</h1><p>{rtl ? "من الرفع إلى القراءة والتحليل والملخص والصوت والأسئلة والتذكير — دون ضياع الخطوة التالية." : "From upload to reading, analysis, summary, audio, questions and reminders — without losing the next step."}</p><div><button className="primary" onClick={onAdd}>＋ {rtl ? "أضف كتابًا" : "Add a book"}</button><button className="secondary" onClick={onLibrary}>{rtl ? "افتح مكتبتي" : "Open my library"}</button></div></div><div className="v11-hero-stats"><b>{books.length}<small>{rtl ? "كتاب" : "books"}</small></b><b>{stats.analysedBooks}<small>{rtl ? "محلل" : "analyzed"}</small></b><b>{stats.audioParts}<small>{rtl ? "مقطع صوت" : "audio parts"}</small></b></div></section>{latest && <section className="v11-panel"><div className="v11-section-head"><div><small>{rtl ? "آخر كتاب" : "Latest book"}</small><h2>{rtl ? "تابع من حيث توقفت" : "Continue where you stopped"}</h2></div></div><BookRow rtl={rtl} book={latest} onOpen={() => onOpen(latest)} onRead={() => onRead(latest)} /></section>}<JourneyExplainer rtl={rtl} /></div>;
}

function Library({ rtl, books, total, filter, setFilter, loading, onAdd, onOpen, onRead }: { rtl: boolean; books: PilotBook[]; total: number; filter: Filter; setFilter: (f: Filter) => void; loading: boolean; onAdd: () => void; onOpen: (b: PilotBook) => void; onRead: (b: PilotBook) => void }) {
  return <div className="v11-page"><header className="v11-page-title"><div><small>{rtl ? "رفوفك الشخصية" : "Your shelves"}</small><h1>{rtl ? `مكتبتي (${total})` : `My library (${total})`}</h1><p>{rtl ? "واجهة مصممة لتبقى مرتبة عندما تصبح الكتب عشرات أو مئات." : "Designed to stay organized as the library grows to dozens or hundreds of books."}</p></div><button className="primary" onClick={onAdd}>＋ {rtl ? "أضف كتابًا" : "Add book"}</button></header><div className="v11-filters">{(["all","new","reading","ready"] as Filter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{rtl ? ({all:"الكل",new:"جديد",reading:"أقرأ الآن",ready:"جاهز"} as Record<Filter,string>)[item] : ({all:"All",new:"New",reading:"Reading",ready:"Ready"} as Record<Filter,string>)[item]}</button>)}</div>{loading ? <div className="v11-panel">{rtl ? "جارٍ تحديث المكتبة…" : "Refreshing library…"}</div> : books.length ? <div className="v11-book-grid">{books.map((book) => <BookCard key={book.id} rtl={rtl} book={book} onOpen={() => onOpen(book)} onRead={() => onRead(book)} />)}</div> : <div className="v11-empty"><b>＋</b><h2>{rtl ? "لا توجد كتب في هذا التصنيف" : "No books in this filter"}</h2><button className="secondary" onClick={onAdd}>{rtl ? "أضف كتابًا" : "Add a book"}</button></div>}</div>;
}

function BookCard({ rtl, book, onOpen, onRead }: { rtl: boolean; book: PilotBook; onOpen: () => void; onRead: () => void }) {
  const pages = Number(book.metadata?.page_count ?? 0);
  return <article className="v11-book-card"><button className="v11-cover" onClick={onOpen}><span>{rtl ? "مكتبتي" : "MY LIBRARY"}</span><strong>{book.title}</strong><small>{pages ? `${pages} ${rtl ? "صفحة" : "pages"}` : "PDF"}</small></button><div><span className={`v11-status ${book.status}`}>{book.status === "ready" ? (rtl ? "جاهز" : "Ready") : book.status === "processing" ? (rtl ? "جارٍ" : "Processing") : book.status === "failed" ? (rtl ? "يحتاج تدخل" : "Needs attention") : (rtl ? "جديد" : "New")}</span><h3>{book.title}</h3><p>{typeof book.metadata?.author === "string" && book.metadata.author ? book.metadata.author : (rtl ? "مؤلف غير محدد بعد" : "Author not identified yet")}</p><div className="v11-card-actions"><button className="primary compact" onClick={onOpen}>{rtl ? "مسار الكتاب" : "Book journey"}</button><button className="secondary compact" onClick={onRead}>{rtl ? "اقرأ" : "Read"}</button></div></div></article>;
}

function BookRow({ rtl, book, onOpen, onRead }: { rtl: boolean; book: PilotBook; onOpen: () => void; onRead: () => void }) {
  return <div className="v11-book-row"><div className="v11-mini-cover">ك</div><div><small>{rtl ? "كتابك" : "Your book"}</small><h3>{book.title}</h3><p>{rtl ? "افتح مسار الكتاب لترى ما اكتمل وما تبقى." : "Open the book journey to see what is complete and what comes next."}</p></div><button className="primary" onClick={onRead}>{rtl ? "واصل القراءة" : "Continue reading"}</button><button className="secondary" onClick={onOpen}>{rtl ? "المسار" : "Journey"}</button></div>;
}

function JourneyExplainer({ rtl }: { rtl: boolean }) {
  const items = rtl ? [["01","رفع","الكتاب محفوظ في مكتبتك الخاصة"],["02","قراءة","الموضع والإشارات محفوظة عبر الأجهزة"],["03","تحليل","محلي مجاني أو AI بعد تأكيدك"],["04","ملخص وصوت","النص أولاً ثم الصوت الاحترافي"],["05","اسأل الكتاب","إجابات مرتبطة بالكتاب"],["06","تذكير","العودة إلى الكتاب في الوقت الذي تختاره"]] : [["01","Upload","Private library storage"],["02","Read","Position and bookmarks sync"],["03","Analyze","Free local or confirmed AI"],["04","Summary & audio","Text first, then professional voice"],["05","Ask","Answers grounded in the book"],["06","Remind","Return at the time you choose"]];
  return <section className="v11-panel"><div className="v11-section-head"><div><small>{rtl ? "خريطة ثابتة" : "Stable map"}</small><h2>{rtl ? "رحلة الكتاب" : "Book journey"}</h2></div></div><div className="v11-journey-explainer">{items.map(([n,title,desc]) => <div key={n}><b>{n}</b><h3>{title}</h3><p>{desc}</p></div>)}</div></section>;
}

function BookWorkspace({ rtl, book, onBack, onRead, onChanged }: { rtl: boolean; book: PilotBook; onBack: () => void; onRead: (page?: number) => void; onChanged: () => Promise<void> }) {
  const [bundle, setBundle] = useState<BookBundle | null>(null);
  const [progress, setProgress] = useState<{ page: number; bookmarks: number[] } | null>(null);
  const [reminder, setReminder] = useState<BookReminder | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Record<string, unknown> | null>(null);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [localProgress, setLocalProgress] = useState<LocalAnalysisProgress | null>(null);
  const output = book.output_language === "en" ? "en" : "ar";

  const reload = async () => {
    const [data, read, reminders] = await Promise.all([getBookResults(book.id), getReadingProgress(book.id), listBookReminders(book.id)]);
    setBundle(data); setProgress(read); setReminder(reminders[0] ?? null);
    const aud = data.audio.filter((a) => a.language === output);
    setAudioUrls(await Promise.all(aud.map((a) => getPrivateAudioUrl(a.storage_path))));
  };
  useEffect(() => { reload().catch((e) => setError(friendlyError(e, rtl))); }, [book.id]);

  const paidAnalysis = bundle?.analyses.find((a) => a.kind === "overview" && (!a.source || a.source === "openai") && a.language === output);
  const localAnalysis = bundle?.analyses.find((a) => a.kind === "local_structural");
  const pageCount = Number(book.metadata?.page_count ?? 0);
  const readPercent = pageCount && progress ? Math.min(100, Math.round((progress.page / pageCount) * 100)) : 0;
  const stages = [
    { key: "upload", label: rtl ? "رفع الكتاب" : "Upload", done: true },
    { key: "read", label: rtl ? "القراءة" : "Reading", done: Boolean(progress), active: Boolean(progress) && readPercent < 100 },
    { key: "analysis", label: rtl ? "التحليل" : "Analysis", done: Boolean(paidAnalysis || localAnalysis), active: book.status === "processing" },
    { key: "summary", label: rtl ? "الملخص" : "Summary", done: Boolean(paidAnalysis) },
    { key: "audio", label: rtl ? "الصوت" : "Audio", done: audioUrls.length > 0 },
    { key: "ask", label: rtl ? "الأسئلة" : "Questions", done: Boolean(bundle?.questions.length) },
    { key: "reminder", label: rtl ? "التذكير" : "Reminder", done: Boolean(reminder) },
  ];

  const doAction = async (name: string, fn: () => Promise<void>) => { setBusy(name); setError(""); try { await fn(); await reload(); await onChanged(); } catch (e) { setError(friendlyError(e, rtl)); } finally { setBusy(""); } };

  return <div className="v11-page"><button className="text-button" onClick={onBack}>→ {rtl ? "العودة إلى مكتبتي" : "Back to library"}</button><header className="v11-book-title"><div><small>{rtl ? "مسار كتابك" : "Your book journey"}</small><h1>{book.title}</h1><p>{rtl ? `الحالة: ${book.status === "ready" ? "جاهز" : book.status === "processing" ? "جارٍ التنفيذ" : book.status === "failed" ? "يحتاج تدخل" : "محفوظ"}` : `Status: ${book.status}`}</p></div><button className="primary" onClick={() => onRead(progress?.page)}>{progress ? (rtl ? `تابع من ص ${progress.page}` : `Continue from p. ${progress.page}`) : (rtl ? "ابدأ القراءة" : "Start reading")}</button></header><section className="v11-journey-strip">{stages.map((stage, i) => <div key={stage.key} className={stage.done ? "done" : stage.active ? "active" : "pending"}><b>{stage.done ? "✓" : i + 1}</b><span>{stage.label}</span><small>{stage.done ? (rtl ? "مكتمل" : "Complete") : stage.active ? (rtl ? "جارٍ" : "In progress") : (rtl ? "لم يبدأ" : "Not started")}</small></div>)}</section>{error && <div className="v11-error">{error}</div>}<div className="v11-work-grid"><section className="v11-panel"><small>{rtl ? "القراءة" : "READ"}</small><h2>{rtl ? "تابع الكتاب الأصلي" : "Continue the original book"}</h2><p>{progress ? (rtl ? `آخر موضع محفوظ: صفحة ${progress.page}${pageCount ? ` من ${pageCount}` : ""}.` : `Saved position: page ${progress.page}${pageCount ? ` of ${pageCount}` : ""}.`) : (rtl ? "لم يبدأ سجل القراءة بعد." : "No reading progress yet.")}</p>{pageCount > 0 && <div className="v11-progress"><i style={{ width: `${readPercent}%` }} /></div>}<button className="secondary" onClick={() => onRead(progress?.page)}>{rtl ? "فتح القارئ" : "Open reader"}</button></section><section className="v11-panel"><small>{rtl ? "تحليل مجاني" : "FREE ANALYSIS"}</small><h2>{rtl ? "افهم بنية الكتاب بلا تكلفة" : "Understand the structure at zero AI cost"}</h2><p>{localAnalysis ? (rtl ? "التحليل المحلي محفوظ لهذا الكتاب." : "Local structural analysis is saved.") : (rtl ? "يعمل داخل المتصفح ولا يرسل الكتاب إلى OpenAI." : "Runs in the browser without sending the book to OpenAI.")}</p>{localProgress && <p>{rtl ? `صفحة ${localProgress.page} من ${localProgress.totalPages}` : `Page ${localProgress.page} of ${localProgress.totalPages}`}</p>}<button className="secondary" disabled={busy === "local"} onClick={() => doAction("local", async () => { const result = await runLocalStructuralAnalysis(book, setLocalProgress); if (Object.keys(result.appliedBookPatch).length) await onChanged(); })}>{busy === "local" ? (rtl ? "جارٍ…" : "Working…") : localAnalysis ? (rtl ? "إعادة التحليل المحلي" : "Re-run local analysis") : (rtl ? "شغّل التحليل المحلي" : "Run local analysis")}</button></section><section className="v11-panel v11-paid"><small>{rtl ? "AI اختياري" : "OPTIONAL AI"}</small><h2>{rtl ? "التحليل والملخص" : "Analysis and summary"}</h2>{paidAnalysis ? <><p>{rtl ? "الملخص الاحترافي جاهز ومحفوظ، ولن نعيد دفع تكلفته عند الفتح." : "The professional summary is saved and reused without paying again."}</p><details><summary>{rtl ? "عرض الملخص" : "Show summary"}</summary><p className="v11-summary">{String((paidAnalysis.content as { overview?: { summary?: string } })?.overview?.summary ?? (paidAnalysis.content as { summary?: string })?.summary ?? "")}</p></details></> : <p>{ZERO_COST_MODE ? (rtl ? "مقفل حاليًا من الخادم أثناء تجهيز V0.11." : "Server-locked while V0.11 is being prepared.") : (rtl ? "سيُنفذ مرة واحدة لهذا الكتاب بعد تأكيدك." : "Runs once for this book after your confirmation.")}</p>}<button className="primary" disabled={ZERO_COST_MODE || busy === "process" || Boolean(paidAnalysis)} onClick={() => doAction("process", async () => { await invokeBookAI(book.id, "process", { language: output }); })}>{paidAnalysis ? (rtl ? "الملخص محفوظ" : "Summary saved") : busy === "process" ? (rtl ? "جارٍ التحليل…" : "Analyzing…") : (rtl ? "تحليل AI للكتاب" : "Analyze with AI")}</button></section><section className="v11-panel"><small>{rtl ? "الصوت الاحترافي" : "PRO AUDIO"}</small><h2>{rtl ? "استمع إلى الملخص" : "Listen to the summary"}</h2>{audioUrls.length ? <div className="v11-audio-list">{audioUrls.map((url, i) => <audio key={url} controls preload="metadata" src={url}>Audio</audio>)}</div> : <p>{rtl ? "يُنشأ الصوت من الملخص فقط، وليس قراءة حرفية كاملة للكتاب." : "Audio is generated from the summary, not a verbatim full-book narration."}</p>}<button className="primary" disabled={ZERO_COST_MODE || !paidAnalysis || audioUrls.length > 0 || busy === "audio"} onClick={() => doAction("audio", async () => { await invokeBookAI(book.id, "audio", { language: output, voice: "marin" }); })}>{audioUrls.length ? (rtl ? "الصوت محفوظ" : "Audio saved") : busy === "audio" ? (rtl ? "جارٍ إنشاء الصوت…" : "Generating audio…") : (rtl ? "أنشئ الصوت العربي الاحترافي" : "Generate professional audio")}</button><p className="v11-note">{rtl ? "اعتماد الصوت النهائي يتطلب اختبار نطق عربي فعلي على الهاتف والكمبيوتر." : "Final voice acceptance requires a real Arabic pronunciation test on phone and desktop."}</p></section><section className="v11-panel"><small>{rtl ? "اسأل الكتاب" : "ASK THE BOOK"}</small><h2>{rtl ? "سؤال من محتوى الكتاب" : "Ask from the book"}</h2><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={rtl ? "اكتب سؤالك…" : "Type your question…"} />><button className="secondary" disabled={ZERO_COST_MODE || !paidAnalysis || !question.trim() || busy === "ask"} onClick={() => doAction("ask", async () => { const data = await invokeBookAI(book.id, "ask", { language: output, question }); setAnswer(data.answer); setQuestion(""); })}>{busy === "ask" ? (rtl ? "جارٍ…" : "Working…") : (rtl ? "اسأل" : "Ask")}</button>{answer && <div className="v11-answer">{String(answer.answer ?? "")}</div>}{bundle?.questions.slice(0,3).map((item) => <details key={item.id}><summary>{item.question}</summary><p>{String(item.answer?.answer ?? "")}</p></details>)}</section><ReminderCard rtl={rtl} book={book} reminder={reminder} onSaved={reload} /></div></div>;
}

function ReminderCard({ rtl, book, reminder, onSaved }: { rtl: boolean; book: PilotBook; reminder: BookReminder | null; onSaved: () => Promise<void> }) {
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const save = async () => { setBusy(true); setMessage(""); try { const when = new Date(Date.now() + hours * 3600_000); await saveBookReminder(book.id, when); try { await enablePushForThisDevice(); } catch (pushError) { setMessage(friendlyError(pushError, rtl)); } await onSaved(); setMessage((m) => m || (rtl ? "حُفظ التذكير. سيُزامن مع أجهزتك بعد تفعيل Web Push." : "Reminder saved. It will sync across devices once Web Push is configured.")); } catch (e) { setMessage(friendlyError(e, rtl)); } finally { setBusy(false); } };
  return <section className="v11-panel"><small>{rtl ? "التذكير" : "REMINDER"}</small><h2>{rtl ? "ارجع إلى الكتاب في الوقت المناسب" : "Return to the book at the right time"}</h2>{reminder ? <p>{rtl ? `التذكير القادم: ${new Date(reminder.remind_at).toLocaleString("ar")}` : `Next reminder: ${new Date(reminder.remind_at).toLocaleString("en")}`}</p> : <p>{rtl ? "اختر المدة، وسيحفظ التذكير مع حسابك." : "Choose a delay; the reminder is saved with your account."}</p>}<div className="v11-reminder-row"><select value={hours} onChange={(e) => setHours(Number(e.target.value))}><option value={1}>{rtl ? "بعد ساعة" : "In 1 hour"}</option><option value={6}>{rtl ? "بعد 6 ساعات" : "In 6 hours"}</option><option value={24}>{rtl ? "غدًا" : "Tomorrow"}</option><option value={72}>{rtl ? "بعد 3 أيام" : "In 3 days"}</option><option value={168}>{rtl ? "بعد أسبوع" : "In a week"}</option></select><button className="primary" disabled={busy} onClick={save}>{busy ? (rtl ? "جارٍ…" : "Saving…") : (rtl ? "حفظ التذكير" : "Save reminder")}</button>{reminder && <button className="secondary" onClick={async () => { await disableBookReminder(book.id); await onSaved(); }}>{rtl ? "إلغاء" : "Cancel"}</button>}</div><button className="text-button" onClick={async () => { try { await showLocalNotification(rtl ? "اختبار تنبيه المكتبة" : "Library notification test", rtl ? `اختبار: عد إلى «${book.title}».` : `Test: return to “${book.title}”.`, `./?book=${book.id}`); setMessage(rtl ? "أرسلنا تنبيه اختبار لهذا الجهاز." : "A test notification was sent to this device."); } catch (e) { setMessage(friendlyError(e, rtl)); } }}>{rtl ? "اختبر شكل التنبيه الآن" : "Test notification now"}</button>{message && <p className="v11-note">{message}</p>}</section>;
}

function UploadModal({ rtl, onClose, onDone }: { rtl: boolean; onClose: () => void; onDone: (book: PilotBook) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [rights1, setRights1] = useState(false);
  const [rights2, setRights2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => { if (!file || !rights1 || !rights2) return; setBusy(true); setError(""); try { const { book, deduped } = await uploadPilotBook(file, "ar"); if (!deduped) await saveLegalConsent(book.id, rights1, rights2); await onDone(book); } catch (e) { setError(friendlyError(e, rtl)); } finally { setBusy(false); } };
  return <div className="v11-modal"><div><button className="v11-close" onClick={onClose}>×</button><small>{rtl ? "إضافة كتاب" : "ADD BOOK"}</small><h2>{rtl ? "أضف كتابًا إلى مكتبتك" : "Add a book to your library"}</h2><p>{rtl ? "الرفع والحفظ لا يشغّلان OpenAI. أي خدمة مدفوعة تبقى خطوة منفصلة داخل مسار الكتاب." : "Upload and storage do not invoke OpenAI. Paid AI remains a separate step inside the book journey."}</p><label className="v11-file"><input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />{file ? file.name : (rtl ? "اختر ملف PDF" : "Choose PDF")}</label><label className="v11-check"><input type="checkbox" checked={rights1} onChange={(e) => setRights1(e.target.checked)} />{rtl ? "أملك حق استخدام الملف أو لدي تصريح لمعالجته شخصيًا." : "I have the right to use this file or permission to process it privately."}</label><label className="v11-check"><input type="checkbox" checked={rights2} onChange={(e) => setRights2(e.target.checked)} />{rtl ? "أفهم أن المنصة لا تنشئ قراءة حرفية كاملة لكتاب محمي." : "I understand the platform does not create a full verbatim narration of a protected book."}</label>{error && <div className="v11-error">{error}</div>}<div className="v11-modal-actions"><button className="primary" disabled={!file || !rights1 || !rights2 || busy} onClick={submit}>{busy ? (rtl ? "جارٍ الحفظ…" : "Saving…") : (rtl ? "احفظ الكتاب" : "Save book")}</button><button className="secondary" disabled={busy} onClick={onClose}>{rtl ? "إلغاء" : "Cancel"}</button></div></div></div>;
}
