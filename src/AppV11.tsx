import { type FormEvent, useEffect, useState } from "react";
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

type View = "home" | "library" | "book" | "reader";
type Filter = "all" | "new" | "reading" | "ready";
type Lang = "ar" | "en";
type Bundle = Awaited<ReturnType<typeof getBookResults>>;

const labels = {
  ar: { name: "المكتبة الشخصية الذكية", version: "رحلة الكتاب — V0.11", home: "الرئيسية", library: "مكتبتي", add: "أضف كتابًا", search: "ابحث بعنوان الكتاب…" },
  en: { name: "Smart Personal Library", version: "Book Journey — V0.11", home: "Home", library: "My library", add: "Add a book", search: "Search by book title…" },
};

function errorText(error: unknown, rtl: boolean) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const known: Record<string, [string, string]> = {
    PAID_AI_DISABLED: ["الذكاء المدفوع مقفل من الخادم حاليًا؛ لا توجد تكلفة.", "Paid AI is server-locked; no cost can be charged."],
    PRIVATE_PILOT_EMAIL_REQUIRED: ["هذا الحساب غير مصرح له بالتجربة المدفوعة الخاصة.", "This account is not authorized for the private paid pilot."],
    V011_MIGRATION_REQUIRED: ["التذكيرات تحتاج تطبيق Migration V0.11 بعد المراجعة.", "Reminders need the reviewed V0.11 migration."],
    VAPID_NOT_CONFIGURED: ["Web Push جاهز في الكود لكن مفاتيحه لم تُضف بعد.", "Web Push is coded, but its keys are not configured yet."],
    IOS_HOME_SCREEN_REQUIRED: ["على iPhone/iPad: أضف المكتبة إلى الشاشة الرئيسية وافتحها كتطبيق، ثم اضغط الجرس لتفعيل الإشعارات.", "On iPhone/iPad: add the library to the Home Screen, open it as a web app, then tap the bell to enable notifications."],
    PUSH_PERMISSION_DENIED: ["لم يسمح الجهاز بالإشعارات.", "Notification permission was not granted."],
    PUSH_UNSUPPORTED: ["هذا المتصفح لا يدعم Web Push بهذه الطريقة.", "This browser does not support Web Push in this mode."],
    FILE_TOO_LARGE_20MB: ["الحد الحالي للملف 20MB.", "The current file limit is 20MB."],
    TOO_MANY_PAGES_250: ["النسخة الحالية تقبل حتى 250 صفحة.", "The current build accepts up to 250 pages."],
  };
  const found = Object.entries(known).find(([key]) => raw.includes(key));
  return found ? found[1][rtl ? 0 : 1] : raw;
}

export default function AppV11() {
  const [lang, setLang] = useState<Lang>(() => localStorage.getItem("spl-lang") === "en" ? "en" : "ar");
  const rtl = lang === "ar";
  const t = labels[lang];
  const [auth, setAuth] = useState<"loading" | "out" | "in">("loading");
  const [email, setEmail] = useState("");
  const [view, setView] = useState<View>("home");
  const [books, setBooks] = useState<PilotBook[]>([]);
  const [stats, setStats] = useState<LibraryStats>({ analysedBooks: 0, questions: 0, audioParts: 0 });
  const [active, setActive] = useState<PilotBook | null>(null);
  const [readerBook, setReaderBook] = useState<SavedBookRef | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [readingIds, setReadingIds] = useState<Set<string>>(new Set());
  const [recentBookId, setRecentBookId] = useState<string | null>(null);

  const switchLang = () => {
    const next = lang === "ar" ? "en" : "ar";
    setLang(next);
    localStorage.setItem("spl-lang", next);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextBooks, nextStats, progressResult] = await Promise.all([
        listPilotBooks(),
        getLibraryStats(),
        supabase!.from("spl_reading_progress").select("book_id,updated_at").order("updated_at", { ascending: false }),
      ]);
      setBooks(nextBooks);
      setStats(nextStats);
      const progressRows = progressResult.data ?? [];
      setReadingIds(new Set(progressRows.map((row) => String(row.book_id))));
      setRecentBookId(progressRows.length ? String(progressRows[0].book_id) : null);
      setActive((current) => current ? nextBooks.find((book) => book.id === current.id) ?? current : current);
    } catch (error) {
      setNotice(errorText(error, rtl));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!supabase) { setAuth("out"); return; }
    supabase.auth.getSession().then(({ data }) => {
      const ok = Boolean(data.session && !(data.session.user as { is_anonymous?: boolean }).is_anonymous);
      setAuth(ok ? "in" : "out");
      setEmail(ok ? data.session?.user.email ?? "" : "");
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const ok = Boolean(session && !(session.user as { is_anonymous?: boolean }).is_anonymous);
      setAuth(ok ? "in" : "out");
      setEmail(ok ? session?.user.email ?? "" : "");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (auth === "in") refresh(); }, [auth]);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("SPL_SW_REGISTER_FAILED", error));
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("book");
    if (!id || books.length === 0) return;
    const found = books.find((book) => book.id === id);
    if (found) { setActive(found); setView("book"); }
  }, [books]);

  if (auth !== "in") return <Login rtl={rtl} loading={auth === "loading"} onLang={switchLang} onDone={() => setAuth("in")} />;

  const filtered = books.filter((book) => {
    const queryOk = !search.trim() || book.title.toLowerCase().includes(search.trim().toLowerCase());
    const filterOk = filter === "all" || (filter === "new" && book.status === "uploaded" && !readingIds.has(book.id)) || (filter === "ready" && book.status === "ready") || (filter === "reading" && readingIds.has(book.id));
    return queryOk && filterOk;
  });
  const openBook = (book: PilotBook) => { setActive(book); setView("book"); };
  const readBook = (book: PilotBook, page?: number) => { setActive(book); setReaderBook({ id: book.id, title: book.title, storagePath: book.storage_path, initialPage: page }); setView("reader"); };

  return <div className="v11-app" dir={rtl ? "rtl" : "ltr"} lang={lang}>
    <aside className="v11-sidebar">
      <button className="v11-brand" onClick={() => setView("home")}><b>ك</b><span><strong>{t.name}</strong><small>{t.version}</small></span></button>
      <nav><button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>⌂ <span>{t.home}</span></button><button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>▥ <span>{t.library}</span></button><button onClick={() => setUploadOpen(true)}>＋ <span>{t.add}</span></button></nav>
      <div className="v11-account"><small>{rtl ? "حسابك الموحد" : "Unified account"}</small><strong>{email}</strong><button onClick={() => signOutLibraryAccount()}>↪</button></div>
    </aside>
    <main className="v11-main">
      <header className="v11-topbar"><form onSubmit={(event) => { event.preventDefault(); setView("library"); }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search} /><button>⌕</button></form><button onClick={switchLang}>{rtl ? "EN" : "ع"}</button><button className="v11-bell" title={rtl ? "تفعيل التنبيهات" : "Enable notifications"} onClick={async () => { try { await enablePushForThisDevice(); setNotice(rtl ? "تم تفعيل إشعارات هذا الجهاز." : "Notifications enabled for this device."); } catch (error) { setNotice(errorText(error, rtl)); } }}>🔔</button></header>
      {view === "home" && <Home rtl={rtl} books={books} stats={stats} recentBookId={recentBookId} onAdd={() => setUploadOpen(true)} onLibrary={() => setView("library")} onOpen={openBook} onRead={readBook} />}
      {view === "library" && <Library rtl={rtl} books={filtered} total={books.length} filter={filter} setFilter={setFilter} loading={loading} onAdd={() => setUploadOpen(true)} onOpen={openBook} onRead={readBook} />}
      {view === "book" && active && <BookWorkspace rtl={rtl} book={active} onBack={() => setView("library")} onRead={(page) => readBook(active, page)} onChanged={refresh} />}
      {view === "reader" && <Reader rtl={rtl} savedBook={readerBook} onExitSavedBook={() => setView(active ? "book" : "library")} />}
    </main>
    <nav className="v11-mobile-nav"><button onClick={() => setView("home")}>⌂<small>{t.home}</small></button><button onClick={() => setView("library")}>▥<small>{t.library}</small></button><button onClick={() => setUploadOpen(true)}>＋<small>{t.add}</small></button></nav>
    {uploadOpen && <UploadModal rtl={rtl} onClose={() => setUploadOpen(false)} onDone={async (book) => { await refresh(); setActive(book); setUploadOpen(false); setView("book"); }} />}
    {notice && <button className="v11-toast" onClick={() => setNotice("")}>{notice}</button>}
  </div>;
}

function Login({ rtl, loading, onLang, onDone }: { rtl: boolean; loading: boolean; onLang: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("aarahman70@gmail.com");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      if (mode === "up") {
        const result = await signUpLibraryAccount(email, password);
        if (result.session) onDone(); else { setMode("in"); setMessage(rtl ? "أُنشئ الحساب. أكّد البريد مرة واحدة ثم سجّل الدخول." : "Account created. Confirm your email once, then sign in."); }
      } else { await signInLibraryAccount(email, password); onDone(); }
    } catch (error) { setMessage(errorText(error, rtl)); }
    finally { setBusy(false); }
  };
  return <div className="v11-login" dir={rtl ? "rtl" : "ltr"}><button className="v11-lang" onClick={onLang}>{rtl ? "EN" : "ع"}</button><form onSubmit={submit}><b className="v11-login-mark">ك</b><small>{rtl ? "المكتبة الشخصية الذكية — V0.11" : "Smart Personal Library — V0.11"}</small><h1>{mode === "in" ? (rtl ? "ادخل إلى مكتبتك" : "Enter your library") : (rtl ? "أنشئ حساب مكتبتك" : "Create your library account")}</h1><p>{rtl ? "حساب واحد على الهاتف والكمبيوتر؛ تقدم القراءة والملخصات والصوت تبقى في مكتبتك." : "One account across phone and desktop; reading progress, summaries and audio stay in your library."}</p><label>{rtl ? "البريد" : "Email"}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>{rtl ? "كلمة المرور" : "Password"}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{message && <div className="v11-message">{message}</div>}<button className="primary" disabled={loading || busy}>{busy ? (rtl ? "جارٍ التنفيذ…" : "Working…") : mode === "in" ? (rtl ? "دخول" : "Sign in") : (rtl ? "إنشاء الحساب" : "Create account")}</button><button type="button" className="text-button" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? (rtl ? "إنشاء حساب جديد" : "Create a new account") : (rtl ? "لدي حساب بالفعل" : "I already have an account")}</button></form></div>;
}

function Home({ rtl, books, stats, recentBookId, onAdd, onLibrary, onOpen, onRead }: { rtl: boolean; books: PilotBook[]; stats: LibraryStats; recentBookId: string | null; onAdd: () => void; onLibrary: () => void; onOpen: (book: PilotBook) => void; onRead: (book: PilotBook) => void }) {
  const latest = books.find((book) => book.id === recentBookId) ?? books[0];
  return <div className="v11-page"><section className="v11-hero"><div><span>{rtl ? "مكتبتك تنمو معك" : "Your library grows with you"}</span><h1>{rtl ? "كل كتاب له رحلة واضحة" : "Every book has a clear journey"}</h1><p>{rtl ? "رفع، قراءة، تحليل، ملخص، صوت، أسئلة وتذكير — وكل مرحلة تظهر حالتها بوضوح." : "Upload, read, analyze, summarize, listen, ask and return — with a clear status for every stage."}</p><div><button className="primary" onClick={onAdd}>＋ {rtl ? "أضف كتابًا" : "Add a book"}</button><button className="secondary" onClick={onLibrary}>{rtl ? "افتح مكتبتي" : "Open my library"}</button></div></div><div className="v11-hero-stats"><b>{books.length}<small>{rtl ? "كتاب" : "books"}</small></b><b>{stats.analysedBooks}<small>{rtl ? "محلل" : "analyzed"}</small></b><b>{stats.audioParts}<small>{rtl ? "مقطع صوت" : "audio parts"}</small></b></div></section>{latest && <section className="v11-panel"><div className="v11-section-head"><div><small>{rtl ? "آخر كتاب" : "Latest book"}</small><h2>{rtl ? "تابع من حيث توقفت" : "Continue where you stopped"}</h2></div></div><div className="v11-book-row"><div className="v11-mini-cover">ك</div><div><small>{rtl ? "كتابك" : "Your book"}</small><h3>{latest.title}</h3><p>{rtl ? "افتح مسار الكتاب لتعرف ما اكتمل وما تبقى." : "Open the journey to see what is complete and what comes next."}</p></div><button className="primary" onClick={() => onRead(latest)}>{rtl ? "واصل القراءة" : "Continue reading"}</button><button className="secondary" onClick={() => onOpen(latest)}>{rtl ? "المسار" : "Journey"}</button></div></section>}<JourneyInfo rtl={rtl} /></div>;
}

function JourneyInfo({ rtl }: { rtl: boolean }) {
  const items = rtl ? [["01","رفع","الكتاب محفوظ"],["02","قراءة","الموضع محفوظ"],["03","تحليل","مجاني أو AI"],["04","ملخص وصوت","نتيجة قابلة للاستماع"],["05","أسئلة","إجابات من الكتاب"],["06","تذكير","ارجع في الوقت المختار"]] : [["01","Upload","Book saved"],["02","Read","Position saved"],["03","Analyze","Free or AI"],["04","Summary & audio","Listen to the result"],["05","Ask","Grounded answers"],["06","Remind","Return on schedule"]];
  return <section className="v11-panel"><div className="v11-section-head"><div><small>{rtl ? "الخريطة الثابتة" : "Stable map"}</small><h2>{rtl ? "رحلة الكتاب" : "Book journey"}</h2></div></div><div className="v11-journey-explainer">{items.map(([n,title,desc]) => <div key={n}><b>{n}</b><h3>{title}</h3><p>{desc}</p></div>)}</div></section>;
}

function Library({ rtl, books, total, filter, setFilter, loading, onAdd, onOpen, onRead }: { rtl: boolean; books: PilotBook[]; total: number; filter: Filter; setFilter: (filter: Filter) => void; loading: boolean; onAdd: () => void; onOpen: (book: PilotBook) => void; onRead: (book: PilotBook) => void }) {
  const text = rtl ? { all:"الكل", new:"جديد", reading:"أقرأ الآن", ready:"جاهز" } : { all:"All", new:"New", reading:"Reading", ready:"Ready" };
  return <div className="v11-page"><header className="v11-page-title"><div><small>{rtl ? "رفوفك الشخصية" : "Your shelves"}</small><h1>{rtl ? `مكتبتي (${total})` : `My library (${total})`}</h1><p>{rtl ? "مصممة لتظل مرتبة عندما تكبر المكتبة." : "Designed to stay organized as your library grows."}</p></div><button className="primary" onClick={onAdd}>＋ {rtl ? "أضف كتابًا" : "Add book"}</button></header><div className="v11-filters">{(["all","new","reading","ready"] as Filter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{text[item]}</button>)}</div>{loading ? <div className="v11-panel">{rtl ? "جارٍ تحديث المكتبة…" : "Refreshing library…"}</div> : books.length ? <div className="v11-book-grid">{books.map((book) => <BookCard key={book.id} rtl={rtl} book={book} onOpen={() => onOpen(book)} onRead={() => onRead(book)} />)}</div> : <div className="v11-empty"><b>＋</b><h2>{rtl ? "لا توجد كتب في هذا التصنيف" : "No books in this filter"}</h2><button className="secondary" onClick={onAdd}>{rtl ? "أضف كتابًا" : "Add a book"}</button></div>}</div>;
}

function BookCard({ rtl, book, onOpen, onRead }: { rtl: boolean; book: PilotBook; onOpen: () => void; onRead: () => void }) {
  const pages = Number(book.metadata?.page_count ?? 0);
  const status = book.status === "ready" ? (rtl ? "جاهز" : "Ready") : book.status === "processing" ? (rtl ? "جارٍ" : "Processing") : book.status === "failed" ? (rtl ? "يحتاج تدخل" : "Needs attention") : (rtl ? "جديد" : "New");
  return <article className="v11-book-card"><button className="v11-cover" onClick={onOpen}><span>{rtl ? "مكتبتي" : "MY LIBRARY"}</span><strong>{book.title}</strong><small>{pages ? `${pages} ${rtl ? "صفحة" : "pages"}` : "PDF"}</small></button><div><span className={`v11-status ${book.status}`}>{status}</span><h3>{book.title}</h3><p>{typeof book.metadata?.author === "string" && book.metadata.author ? book.metadata.author : (rtl ? "مؤلف غير محدد بعد" : "Author not identified yet")}</p><div className="v11-card-actions"><button className="primary compact" onClick={onOpen}>{rtl ? "مسار الكتاب" : "Book journey"}</button><button className="secondary compact" onClick={onRead}>{rtl ? "اقرأ" : "Read"}</button></div></div></article>;
}

function BookWorkspace({ rtl, book, onBack, onRead, onChanged }: { rtl: boolean; book: PilotBook; onBack: () => void; onRead: (page?: number) => void; onChanged: () => Promise<void> }) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [progress, setProgress] = useState<{ page: number; bookmarks: number[] } | null>(null);
  const [reminder, setReminder] = useState<BookReminder | null>(null);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [localProgress, setLocalProgress] = useState<LocalAnalysisProgress | null>(null);
  const output = book.output_language === "en" ? "en" : "ar";

  const reload = async () => {
    const [data, read, reminders] = await Promise.all([getBookResults(book.id), getReadingProgress(book.id), listBookReminders(book.id)]);
    setBundle(data); setProgress(read); setReminder(reminders[0] ?? null);
    const audio = data.audio.filter((item) => item.language === output);
    setAudioUrls(await Promise.all(audio.map((item) => getPrivateAudioUrl(item.storage_path))));
  };
  useEffect(() => { reload().catch((error) => setError(errorText(error, rtl))); }, [book.id]);

  const paid = bundle?.analyses.find((item) => item.kind === "overview" && (!item.source || item.source === "openai") && item.language === output);
  const local = bundle?.analyses.find((item) => item.kind === "local_structural");
  const pageCount = Number(book.metadata?.page_count ?? 0);
  const readPercent = pageCount && progress ? Math.min(100, Math.round(progress.page / pageCount * 100)) : 0;
  const stages = [
    [rtl ? "رفع" : "Upload", true], [rtl ? "قراءة" : "Read", Boolean(progress)], [rtl ? "تحليل" : "Analyze", Boolean(paid || local)], [rtl ? "ملخص" : "Summary", Boolean(paid)], [rtl ? "صوت" : "Audio", audioUrls.length > 0], [rtl ? "أسئلة" : "Ask", Boolean(bundle?.questions.length)], [rtl ? "تذكير" : "Remind", Boolean(reminder)],
  ] as const;
  const run = async (name: string, action: () => Promise<void>) => { setBusy(name); setError(""); try { await action(); await reload(); await onChanged(); } catch (error) { setError(errorText(error, rtl)); } finally { setBusy(""); } };
  const summary = String((paid?.content as { overview?: { summary?: string }; summary?: string } | undefined)?.overview?.summary ?? (paid?.content as { summary?: string } | undefined)?.summary ?? "");

  return <div className="v11-page"><button className="text-button" onClick={onBack}>→ {rtl ? "العودة إلى مكتبتي" : "Back to library"}</button><header className="v11-book-title"><div><small>{rtl ? "مسار كتابك" : "Your book journey"}</small><h1>{book.title}</h1><p>{rtl ? "كل مرحلة تقول لك بوضوح: لم تبدأ، جارية، أو مكتملة." : "Every stage is clearly marked as not started, in progress, or complete."}</p></div><button className="primary" onClick={() => onRead(progress?.page)}>{progress ? (rtl ? `تابع من ص ${progress.page}` : `Continue from p. ${progress.page}`) : (rtl ? "ابدأ القراءة" : "Start reading")}</button></header><section className="v11-journey-strip">{stages.map(([label, done], index) => <div key={label} className={done ? "done" : "pending"}><b>{done ? "✓" : index + 1}</b><span>{label}</span><small>{done ? (rtl ? "مكتمل" : "Complete") : (rtl ? "لم يبدأ" : "Not started")}</small></div>)}</section>{error && <div className="v11-error">{error}</div>}<div className="v11-work-grid">
    <section className="v11-panel"><small>{rtl ? "القراءة" : "READ"}</small><h2>{rtl ? "تابع الكتاب الأصلي" : "Continue the original book"}</h2><p>{progress ? (rtl ? `آخر موضع محفوظ: صفحة ${progress.page}${pageCount ? ` من ${pageCount}` : ""}.` : `Saved position: page ${progress.page}${pageCount ? ` of ${pageCount}` : ""}.`) : (rtl ? "لم تبدأ القراءة بعد." : "Reading has not started yet.")}</p>{pageCount > 0 && <div className="v11-progress"><i style={{ width: `${readPercent}%` }} /></div>}<button className="secondary" onClick={() => onRead(progress?.page)}>{rtl ? "فتح القارئ" : "Open reader"}</button></section>
    <section className="v11-panel"><small>{rtl ? "تحليل مجاني" : "FREE ANALYSIS"}</small><h2>{rtl ? "افهم بنية الكتاب بلا تكلفة" : "Understand the structure at zero AI cost"}</h2><p>{local ? (rtl ? "التحليل المحلي محفوظ لهذا الكتاب." : "Local structural analysis is saved.") : (rtl ? "يعمل في المتصفح ولا يرسل الكتاب إلى OpenAI." : "Runs in the browser without sending the book to OpenAI.")}</p>{localProgress && <p>{rtl ? `صفحة ${localProgress.page} من ${localProgress.totalPages}` : `Page ${localProgress.page} of ${localProgress.totalPages}`}</p>}<button className="secondary" disabled={busy === "local"} onClick={() => run("local", async () => { await runLocalStructuralAnalysis(book, setLocalProgress); })}>{busy === "local" ? (rtl ? "جارٍ…" : "Working…") : local ? (rtl ? "إعادة التحليل المحلي" : "Re-run local analysis") : (rtl ? "شغّل التحليل المحلي" : "Run local analysis")}</button></section>
    <section className="v11-panel v11-paid"><small>{rtl ? "AI اختياري" : "OPTIONAL AI"}</small><h2>{rtl ? "التحليل والملخص" : "Analysis and summary"}</h2>{paid ? <><p>{rtl ? "الملخص محفوظ ولن نعيد دفع تكلفته عند الفتح." : "The summary is saved and reused without paying again."}</p><details><summary>{rtl ? "عرض الملخص" : "Show summary"}</summary><p className="v11-summary">{summary}</p></details></> : <p>{ZERO_COST_MODE ? (rtl ? "مقفل الآن أثناء تجهيز V0.11." : "Locked while V0.11 is being prepared.") : (rtl ? "سيُنفذ مرة واحدة بعد تأكيدك." : "Runs once after your confirmation.")}</p>}<button className="primary" disabled={ZERO_COST_MODE || Boolean(paid) || busy === "process"} onClick={() => run("process", async () => { await invokeBookAI(book.id, "process", { language: output }); })}>{paid ? (rtl ? "الملخص محفوظ" : "Summary saved") : busy === "process" ? (rtl ? "جارٍ التحليل…" : "Analyzing…") : (rtl ? "تحليل AI للكتاب" : "Analyze with AI")}</button></section>
    <section className="v11-panel"><small>{rtl ? "الصوت الاحترافي" : "PRO AUDIO"}</small><h2>{rtl ? "استمع إلى الملخص" : "Listen to the summary"}</h2>{audioUrls.length ? <div className="v11-audio-list">{audioUrls.map((url) => <audio key={url} controls preload="metadata" src={url}>Audio</audio>)}</div> : <p>{rtl ? "الصوت يُنشأ من الملخص فقط وليس قراءة حرفية كاملة للكتاب." : "Audio is generated from the summary, not a verbatim full-book narration."}</p>}<button className="primary" disabled={ZERO_COST_MODE || !paid || audioUrls.length > 0 || busy === "audio"} onClick={() => run("audio", async () => { await invokeBookAI(book.id, "audio", { language: output, voice: "marin" }); })}>{audioUrls.length ? (rtl ? "الصوت محفوظ" : "Audio saved") : busy === "audio" ? (rtl ? "جارٍ إنشاء الصوت…" : "Generating audio…") : (rtl ? "أنشئ الصوت الاحترافي" : "Generate professional audio")}</button><p className="v11-note">{rtl ? "لا يُعتمد الصوت نهائيًا إلا بعد اختبار نطق عربي فعلي على الهاتف والكمبيوتر." : "Final voice acceptance requires a real Arabic pronunciation test on phone and desktop."}</p></section>
    <section className="v11-panel"><small>{rtl ? "اسأل الكتاب" : "ASK THE BOOK"}</small><h2>{rtl ? "سؤال من محتوى الكتاب" : "Ask from the book"}</h2><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={rtl ? "اكتب سؤالك…" : "Type your question…"} /><button className="secondary" disabled={ZERO_COST_MODE || !paid || !question.trim() || busy === "ask"} onClick={() => run("ask", async () => { const data = await invokeBookAI(book.id, "ask", { language: output, question }); setAnswer(data.answer); setQuestion(""); })}>{busy === "ask" ? (rtl ? "جارٍ…" : "Working…") : (rtl ? "اسأل" : "Ask")}</button>{answer && <div className="v11-answer">{String(answer.answer ?? "")}</div>}{bundle?.questions.slice(0, 3).map((item) => <details key={item.id}><summary>{item.question}</summary><p>{String(item.answer?.answer ?? "")}</p></details>)}</section>
    <ReminderPanel rtl={rtl} book={book} reminder={reminder} onSaved={reload} />
  </div></div>;
}

function ReminderPanel({ rtl, book, reminder, onSaved }: { rtl: boolean; book: PilotBook; reminder: BookReminder | null; onSaved: () => Promise<void> }) {
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const save = async () => {
    setBusy(true); setMessage("");
    try {
      await saveBookReminder(book.id, new Date(Date.now() + hours * 3600_000));
      try { await enablePushForThisDevice(); } catch (error) { setMessage(errorText(error, rtl)); }
      await onSaved();
      setMessage((current) => current || (rtl ? "حُفظ التذكير مع حسابك." : "Reminder saved with your account."));
    } catch (error) { setMessage(errorText(error, rtl)); }
    finally { setBusy(false); }
  };
  return <section className="v11-panel"><small>{rtl ? "التذكير" : "REMINDER"}</small><h2>{rtl ? "ارجع إلى الكتاب في الوقت المناسب" : "Return to the book at the right time"}</h2>{reminder && <p>{rtl ? `التذكير القادم: ${new Date(reminder.remind_at).toLocaleString("ar")}` : `Next reminder: ${new Date(reminder.remind_at).toLocaleString("en")}`}</p>}<div className="v11-reminder-row"><select value={hours} onChange={(event) => setHours(Number(event.target.value))}><option value={1}>{rtl ? "بعد ساعة" : "In 1 hour"}</option><option value={6}>{rtl ? "بعد 6 ساعات" : "In 6 hours"}</option><option value={24}>{rtl ? "غدًا" : "Tomorrow"}</option><option value={72}>{rtl ? "بعد 3 أيام" : "In 3 days"}</option><option value={168}>{rtl ? "بعد أسبوع" : "In a week"}</option></select><button className="primary" disabled={busy} onClick={save}>{busy ? (rtl ? "جارٍ…" : "Saving…") : (rtl ? "حفظ التذكير" : "Save reminder")}</button>{reminder && <button className="secondary" onClick={async () => { await disableBookReminder(book.id); await onSaved(); }}>{rtl ? "إلغاء" : "Cancel"}</button>}</div><button className="text-button" onClick={async () => { try { await showLocalNotification(rtl ? "اختبار تنبيه المكتبة" : "Library notification test", rtl ? `اختبار: عد إلى «${book.title}».` : `Test: return to “${book.title}”.`, `./?book=${book.id}`); setMessage(rtl ? "أرسلنا تنبيه اختبار لهذا الجهاز." : "A test notification was sent to this device."); } catch (error) { setMessage(errorText(error, rtl)); } }}>{rtl ? "اختبر شكل التنبيه الآن" : "Test notification now"}</button>{message && <p className="v11-note">{message}</p>}</section>;
}

function UploadModal({ rtl, onClose, onDone }: { rtl: boolean; onClose: () => void; onDone: (book: PilotBook) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [rights1, setRights1] = useState(false);
  const [rights2, setRights2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!file || !rights1 || !rights2) return;
    setBusy(true); setError("");
    try {
      const { book, deduped } = await uploadPilotBook(file, "ar");
      if (!deduped) await saveLegalConsent(book.id, rights1, rights2);
      await onDone(book);
    } catch (error) { setError(errorText(error, rtl)); }
    finally { setBusy(false); }
  };
  return <div className="v11-modal"><div><button className="v11-close" onClick={onClose}>×</button><small>{rtl ? "إضافة كتاب" : "ADD BOOK"}</small><h2>{rtl ? "أضف كتابًا إلى مكتبتك" : "Add a book to your library"}</h2><p>{rtl ? "الرفع والحفظ لا يشغّلان OpenAI؛ أي خدمة مدفوعة تبقى خطوة منفصلة داخل مسار الكتاب." : "Upload and storage do not invoke OpenAI; paid AI stays a separate step inside the journey."}</p><label className="v11-file"><input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />{file ? file.name : (rtl ? "اختر ملف PDF" : "Choose PDF")}</label><label className="v11-check"><input type="checkbox" checked={rights1} onChange={(event) => setRights1(event.target.checked)} />{rtl ? "أملك حق استخدام الملف أو لدي تصريح لمعالجته شخصيًا." : "I have the right to use this file or permission to process it privately."}</label><label className="v11-check"><input type="checkbox" checked={rights2} onChange={(event) => setRights2(event.target.checked)} />{rtl ? "أفهم أن المنصة لا تنشئ قراءة حرفية كاملة لكتاب محمي." : "I understand the platform does not create a full verbatim narration of a protected book."}</label>{error && <div className="v11-error">{error}</div>}<div className="v11-modal-actions"><button className="primary" disabled={!file || !rights1 || !rights2 || busy} onClick={submit}>{busy ? (rtl ? "جارٍ الحفظ…" : "Saving…") : (rtl ? "احفظ الكتاب" : "Save book")}</button><button className="secondary" disabled={busy} onClick={onClose}>{rtl ? "إلغاء" : "Cancel"}</button></div></div></div>;
}
