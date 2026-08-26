import { useEffect, useMemo, useState } from "react";
import Reader from "./Reader";
import {
  getBookResults,
  getPrivateAudioUrl,
  invokeBookAI,
  listPilotBooks,
  rollbackPilotBook,
  saveLegalConsent,
  uploadPilotBook,
  type OutputLanguage,
  type PilotBook,
} from "./lib/library";
import { supabaseConfigured } from "./lib/supabase";

type Lang = "ar" | "en";
type View =
  | "home"
  | "library"
  | "book"
  | "pilot"
  | "reader"
  | "progress"
  | "librarian"
  | "feedback";

const text = {
  ar: {
    name: "المكتبة الشخصية الذكية",
    version: "النسخة المجانية أولًا — V0.6.3",
    search: "ابحث في كتبك وأفكارك…",
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
    choose: "اختر PDF أو EPUB",
    rights1:
      "أقرّ أنني أملك حق استخدام هذا الملف أو لدي تصريح بمعالجته للاستخدام الشخصي.",
    rights2:
      "أفهم أن المنصة لا تسمح بنشر الكتاب أو إنشاء قراءة حرفية كاملة لعمل محمي.",
    start: "احفظ الكتاب فقط — بلا تكلفة OpenAI",
    cancel: "إلغاء",
    journal: "سجل التجربة",
    journalSub:
      "ملاحظاتك هنا تساعدنا في تطوير المنتج وصياغة الدراسة العلمية لاحقًا.",
  },
  en: {
    name: "Smart Personal Library",
    version: "Free-first pilot — V0.6.3",
    search: "Search your books and ideas…",
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
    choose: "Choose PDF or EPUB",
    rights1:
      "I confirm that I own this file or have permission to process it for personal use.",
    rights2:
      "I understand that the platform does not allow publishing the book or generating a full verbatim narration of a protected work.",
    start: "Save book only — no OpenAI charge",
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
    ["progress", "التقدم والمراجعة", "◴"],
    ["librarian", "أمين المكتبة", "✦"],
    ["feedback", "سجل التجربة", "✎"],
  ],
  en: [
    ["home", "Home", "⌂"],
    ["library", "My library", "▥"],
    ["reader", "Free reader & voice", "◫"],
    ["upload", "Add a book", "＋"],
    ["progress", "Progress & review", "◴"],
    ["librarian", "Library assistant", "✦"],
    ["feedback", "Research journal", "✎"],
  ],
} as const;

const books = [
  {
    title: "مدخل إلى إدارة المعرفة",
    en: "Introduction to Knowledge Management",
    author: "نموذج تجريبي",
    subject: "إدارة المعرفة",
    progress: 68,
    tone: "emerald",
    status: "أقرأ الآن",
    pages: 284,
  },
  {
    title: "The Future of Libraries",
    en: "The Future of Libraries",
    author: "Demo Edition",
    subject: "المكتبات الرقمية",
    progress: 34,
    tone: "navy",
    status: "ملخص جاهز",
    pages: 216,
  },
  {
    title: "التفكير النقدي والقراءة",
    en: "Critical Thinking and Reading",
    author: "كتاب تجريبي",
    subject: "مهارات التفكير",
    progress: 0,
    tone: "gold",
    status: "لم أبدأ",
    pages: 192,
  },
];

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
  const [activePilotBook, setActivePilotBook] = useState<PilotBook | null>(
    null,
  );
  const [processing, setProcessing] = useState(false);
  const [percent, setPercent] = useState(0);
  const [notice, setNotice] = useState("");
  const t = text[lang];
  const rtl = lang === "ar";
  useEffect(() => {
    const saved = localStorage.getItem("spl-lang");
    if (saved === "ar" || saved === "en") setLang(saved);
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (supabaseConfigured)
      listPilotBooks()
        .then(setPilotBooks)
        .catch(() => undefined);
  }, []);
  const switchLang = () => {
    const next = lang === "ar" ? "en" : "ar";
    setLang(next);
    localStorage.setItem("spl-lang", next);
  };
  const pageTitle = useMemo(
    () => navigation[lang].find((x) => x[0] === view)?.[1] || t.name,
    [lang, view, t.name],
  );
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
      const book = await uploadPilotBook(file, outputLanguage);
      setPercent(75);
      try {
        await saveLegalConsent(book.id, rights1, rights2);
      } catch (consentError) {
        await rollbackPilotBook(book);
        throw consentError;
      }
      setPercent(100);
      const all = await listPilotBooks();
      const refreshed = all.find((item) => item.id === book.id) ?? book;
      setPilotBooks(all);
      setActivePilotBook(refreshed);
      setUpload(false);
      setView("pilot");
      setNotice(
        rtl
          ? "حُفظ الكتاب فقط. لم يُرسل إلى OpenAI ولم يُخصم من رصيدك."
          : "Book saved only. Nothing was sent to OpenAI and no API credit was used.",
      );
      setFile(null);
      setRights1(false);
      setRights2(false);
    } catch (error) {
      setNotice(
        `${rtl ? "تعذر حفظ الكتاب" : "Could not save the book"}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setProcessing(false);
      setTimeout(() => setNotice(""), 7000);
    }
  };
  const go = (id: string) =>
    id === "upload" ? setUpload(true) : setView(id as View);
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
              onClick={() => go(id)}
            >
              <i>{icon}</i>
              <span>{label}</span>
              {id === "progress" && <b>3</b>}
            </button>
          ))}
        </nav>
        <div className="prototype-note">
          <strong>
            {rtl ? "قارئ الجهاز المجاني V0.6.3" : "Free on-device reader V0.6.3"}
          </strong>
          <p>
            {rtl
              ? "القراءة وصوت الجهاز لا يستخدمان OpenAI. الخدمات المدفوعة منفصلة وواضحة."
              : "Reading and device voice do not use OpenAI. Paid AI services are clearly separated."}
          </p>
        </div>
        <div className="profile">
          <span>ع</span>
          <div>
            <strong>عبدالرحمن</strong>
            <small>{rtl ? "المكتبة الخاصة" : "Private library"}</small>
          </div>
          <button>⋮</button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button className="mobile-brand" onClick={() => setView("home")}>
            ك
          </button>
          <label className="search">
            <span>⌕</span>
            <input placeholder={t.search} />
          </label>
          <div className="top-actions">
            <button onClick={switchLang} className="lang-switch">
              {rtl ? "EN" : "ع"}
            </button>
            <button onClick={() => setDark(!dark)}>{dark ? "☀" : "◐"}</button>
            <button className="bell">
              ♧<b>2</b>
            </button>
          </div>
        </header>
        {view === "home" && (
          <Dashboard
            rtl={rtl}
            t={t}
            onUpload={() => setUpload(true)}
            setView={setView}
          />
        )}
        {view === "library" && (
          <Library
            rtl={rtl}
            title={pageTitle}
            onUpload={() => setUpload(true)}
            onOpen={() => setView("book")}
            pilotBooks={pilotBooks}
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
            onOpenReader={() => setView("reader")}
          />
        )}
        {view === "reader" && <Reader rtl={rtl} />}
        {view === "progress" && <Progress rtl={rtl} title={pageTitle} />}
        {view === "librarian" && <Librarian rtl={rtl} title={pageTitle} />}
        {view === "feedback" && <Feedback rtl={rtl} t={t} />}
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

function Dashboard({
  rtl,
  t,
  onUpload,
  setView,
}: {
  rtl: boolean;
  t: typeof text.ar;
  onUpload: () => void;
  setView: (v: View) => void;
}) {
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
            <button className="primary" onClick={() => setView("reader")}>
              ◫ {rtl ? "اقرأ واستمع مجانًا" : "Read & listen for free"}
            </button>
            <button className="secondary" onClick={onUpload}>
              ＋ {rtl ? "أضف كتابًا" : "Add a book"}
            </button>
            <button className="secondary" onClick={() => setView("progress")}>
              ◴ {t.continue}
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
          value="3"
          label={t.books}
          note={rtl ? "مكتبتك التجريبية" : "Demo collection"}
        />
        <Metric
          icon="✓"
          value="2"
          label={t.ready}
          note={rtl ? "كتاب واحد قيد القراءة" : "One in progress"}
        />
        <Metric
          icon="◖"
          value="47"
          label={t.minutes}
          note={rtl ? "+18 هذا الأسبوع" : "+18 this week"}
        />
        <Metric
          icon="↗"
          value="6"
          label={t.streak}
          note={rtl ? "أفضل سلسلة: 11" : "Best streak: 11"}
        />
      </section>
      <section className="split-grid">
        <article className="panel continue-card">
          <SectionHead
            over={rtl ? "القراءة الحالية" : "Current reading"}
            title={t.current}
          />
          <div className="current-book">
            <BookCover
              tone="emerald"
              title={rtl ? "إدارة المعرفة" : "Knowledge Management"}
            />
            <div className="book-copy">
              <span className="status">
                {rtl ? "أقرأ الآن" : "In progress"}
              </span>
              <h4>{rtl ? books[0].title : books[0].en}</h4>
              <p>
                {rtl
                  ? "الفصل الرابع — تحويل الخبرة إلى معرفة مؤسسية"
                  : "Chapter 4 — Turning experience into organizational knowledge"}
              </p>
              <Bar value={68} />
              <div className="progress-meta">
                <span>68%</span>
                <span>{rtl ? "صفحة 193 من 284" : "Page 193 of 284"}</span>
              </div>
              <button
                className="primary compact"
                onClick={() => setView("book")}
              >
                ▶ {rtl ? "افتح الكتاب ونتائجه" : "Open book & results"}
              </button>
            </div>
          </div>
        </article>
        <article className="panel librarian-card">
          <div className="librarian-icon">✦</div>
          <span className="eyebrow">
            {rtl ? "توصية شخصية" : "Personal recommendation"}
          </span>
          <h3>{t.suggestion}</h3>
          <p>
            {rtl
              ? "لديك كتابان يتناولان إدارة المعرفة. اقرأ الفصل الثاني من «مستقبل المكتبات» بعد إنهاء الفصل الحالي؛ فهو يضيف منظور التحول الرقمي دون تكرار."
              : "Two books discuss knowledge management. Read chapter two of ‘The Future of Libraries’ next for a complementary digital perspective."}
          </p>
          <div className="source-note">
            <b>{rtl ? "سبب الاقتراح" : "Why this suggestion"}</b>
            <span>
              {rtl
                ? "مقارنة موضوعية داخل مكتبتك فقط"
                : "A topical comparison within your library only"}
            </span>
          </div>
          <button className="text-button" onClick={() => setView("librarian")}>
            {rtl ? "افتح أمين المكتبة" : "Open AI librarian"} ←
          </button>
        </article>
      </section>
      <section className="panel library-preview">
        <SectionHead
          over={rtl ? "رفوفك الشخصية" : "Your shelves"}
          title={t.myLibrary}
          action={t.all}
          onAction={() => setView("library")}
        />
        <div className="book-grid">
          {books.map((b) => (
            <BookCard
              key={b.title}
              book={b}
              rtl={rtl}
              onOpen={() => setView("book")}
            />
          ))}
          <button className="add-book-card" onClick={onUpload}>
            <i>＋</i>
            <strong>{rtl ? "أضف كتابًا جديدًا" : "Add a new book"}</strong>
            <span>PDF / EPUB</span>
          </button>
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
              rtl ? "PDF أو EPUB خاص بك" : "Your PDF or EPUB",
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
function BookCard({
  book,
  rtl,
  onOpen,
}: {
  book: (typeof books)[number];
  rtl: boolean;
  onOpen?: () => void;
}) {
  return (
    <button className="book-card" onClick={onOpen}>
      <BookCover
        tone={book.tone}
        title={
          rtl
            ? book.title.split(" ").slice(0, 3).join(" ")
            : book.en.split(" ").slice(0, 3).join(" ")
        }
      />
      <div>
        <span className="tag">{book.subject}</span>
        <h4>{rtl ? book.title : book.en}</h4>
        <p>{book.author}</p>
        <Bar value={book.progress} />
        <small>
          {book.progress
            ? `${book.progress}% — ${book.status}`
            : rtl
              ? "جاهز للبدء"
              : "Ready to start"}
        </small>
      </div>
    </button>
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

function Library({
  rtl,
  title,
  onUpload,
  onOpen,
  pilotBooks,
  onOpenPilot,
}: {
  rtl: boolean;
  title: string;
  onUpload: () => void;
  onOpen: () => void;
  pilotBooks: PilotBook[];
  onOpenPilot: (book: PilotBook) => void;
}) {
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
      {pilotBooks.length > 0 && (
        <section className="panel live-books">
          <span className="eyebrow">
            {rtl ? "كتب V0.5 المحفوظة" : "Saved V0.5 books"}
          </span>
          <h3>{rtl ? "مكتبتك الفعلية" : "Your live library"}</h3>
          <p className="pilot-session-warning">
            {rtl
              ? "تنبيه النسخة التجريبية: دخولك مرتبط بهذا المتصفح حاليًا؛ لا تمسح بيانات المتصفح حتى نضيف الحساب الدائم والاسترجاع."
              : "Pilot notice: access is currently tied to this browser. Do not clear browser data until permanent accounts and recovery are added."}
          </p>
          <div className="live-book-list">
            {pilotBooks.map((book) => (
              <button key={book.id} onClick={() => onOpenPilot(book)}>
                <i>▤</i>
                <span>
                  <strong>{book.title}</strong>
                  <small>
                    {book.source_language.toUpperCase()} · {book.status}
                  </small>
                </span>
                <b>←</b>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="filters">
        <button className="active">
          {rtl
            ? `الكل ${pilotBooks.length + 3}`
            : `All ${pilotBooks.length + 3}`}
        </button>
        <button>{rtl ? "نماذج العرض" : "Display samples"}</button>
      </div>
      <div className="library-full">
        {books.map((b) => (
          <BookCard key={b.title} book={b} rtl={rtl} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function PilotWorkspace({
  rtl,
  book,
  onBack,
  onOpenReader,
}: {
  rtl: boolean;
  book: PilotBook;
  onBack: () => void;
  onOpenReader: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<Record<string, unknown> | null>(null);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<
    "process" | "ask" | "audio" | ""
  >("");
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
    const data = await getBookResults(book.id);
    const first = data.analyses[0]?.content as
      | Record<string, unknown>
      | undefined;
    setResults(first ?? null);
    if (data.audio.length)
      setAudioUrls(
        await Promise.all(
          data.audio.map((item) => getPrivateAudioUrl(item.storage_path)),
        ),
      );
  };
  useEffect(() => {
    reload()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [book.id]);
  const process = async () => {
    setBusy("process");
    setError("");
    try {
      await invokeBookAI(book.id, "process");
      await reload();
      setConfirming("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setBusy("");
    }
  };
  const ask = async () => {
    if (!q.trim()) return;
    setBusy("ask");
    setError("");
    try {
      const data = await invokeBookAI(book.id, "ask", {
        question: q,
        language: rtl ? "ar" : "en",
      });
      setAnswer(data.answer);
      setConfirming("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Question failed");
    } finally {
      setBusy("");
    }
  };
  const audio = async () => {
    setBusy("audio");
    setError("");
    try {
      const data = await invokeBookAI(book.id, "audio", {
        language: rtl ? "ar" : "en",
        voice: "marin",
      });
      setAudioUrls(
        await Promise.all(
          data.audio.map((item: { storage_path: string }) =>
            getPrivateAudioUrl(item.storage_path),
          ),
        ),
      );
      setConfirming("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audio failed");
    } finally {
      setBusy("");
    }
  };
  const audioUrl = audioUrls[0] ?? "";
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
          <button className="secondary" onClick={onOpenReader}>
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
              ? `لغة النتيجة: ${book.output_language === "ar" ? "العربية" : book.output_language === "en" ? "الإنجليزية" : "العربية والإنجليزية"}. لا تبدأ الخدمة إلا بعد تأكيدك.`
              : `Output: ${book.output_language === "ar" ? "Arabic" : book.output_language === "en" ? "English" : "Arabic and English"}. The service starts only after confirmation.`}
          </p>
        </div>
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
              10 * (estimates.analysis[0] + estimates.audio[0]),
              10 * (estimates.analysis[1] + estimates.audio[1]),
            ])}
            <small>
              {rtl ? "تقدير عشرة كتب مماثلة" : "estimate for 10 similar books"}
            </small>
          </b>
        </div>
        <small>
          {rtl
            ? `حجم الملف: ${sizeMb.toFixed(1)} MB · الشحن التلقائي مغلق؛ عند نفاد الرصيد تتوقف طلبات API.`
            : `File size: ${sizeMb.toFixed(1)} MB · Auto-reload is off; API requests stop when credit runs out.`}
        </small>
      </section>
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
            {!results && (
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
                      disabled={busy === "process"}
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
            )}
            <pre className="result-json">
              {results ? JSON.stringify(results, null, 2) : ""}
            </pre>
          </article>
          <aside className="detail-aside">
            <section className="panel">
              <h3>{rtl ? "اسأل الكتاب — مدفوع" : "Ask the book — paid"}</h3>
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
                    disabled={busy === "ask"}
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
              {answer && (
                <pre className="answer-live">
                  {JSON.stringify(answer, null, 2)}
                </pre>
              )}
            </section>
            <section className="panel">
              <h3>
                {rtl ? "الصوت الاحترافي — مدفوع" : "Professional voice — paid"}
              </h3>
              <p>
                {rtl
                  ? `تقدير الخلاصة الصوتية: ${money(estimates.audio)}. صوت الجهاز المجاني موجود في القارئ.`
                  : `Estimated audio summary: ${money(estimates.audio)}. Free device voice is available in the reader.`}
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
                  <button
                    className="primary"
                    disabled={busy === "audio"}
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
              {audioUrl && (
                <>
                  <audio controls src={audioUrl} />
                  <small>
                    {rtl
                      ? "هذا الصوت مولد بالذكاء الاصطناعي."
                      : "This voice is AI-generated."}
                  </small>
                </>
              )}
            </section>
            {error && <div className="reader-error inline">{error}</div>}
          </aside>
        </div>
      )}
    </div>
  );
}

function BookDetail({ rtl, onBack }: { rtl: boolean; onBack: () => void }) {
  const [tab, setTab] = useState("summary");
  const [playing, setPlaying] = useState(false);
  const tabs = rtl
    ? [
        ["summary", "الخلاصة"],
        ["chapters", "الفصول"],
        ["analysis", "التحليل"],
        ["return", "العودة للكتاب"],
        ["audio", "الاستماع"],
      ]
    : [
        ["summary", "Overview"],
        ["chapters", "Chapters"],
        ["analysis", "Analysis"],
        ["return", "Return to source"],
        ["audio", "Listen"],
      ];
  return (
    <div className="page book-detail">
      <button className="back" onClick={onBack}>
        → {rtl ? "العودة إلى مكتبتي" : "Back to my library"}
      </button>
      <section className="book-hero panel">
        <BookCover
          tone="emerald"
          title={rtl ? "إدارة المعرفة" : "Knowledge Management"}
        />
        <div className="book-identity">
          <span className="tag">
            {rtl ? "إدارة المعرفة" : "Knowledge management"}
          </span>
          <h2>
            {rtl
              ? "مدخل إلى إدارة المعرفة"
              : "Introduction to Knowledge Management"}
          </h2>
          <p>
            {rtl
              ? "نموذج تجريبي • 284 صفحة • العربية"
              : "Demo edition • 284 pages • Arabic"}
          </p>
          <div className="book-badges">
            <span>✓ {rtl ? "التحليل جاهز" : "Analysis ready"}</span>
            <span>⌁ {rtl ? "12 فصلًا" : "12 chapters"}</span>
            <span>◖ 18:42</span>
            <span>◎ {rtl ? "موثق بالصفحات" : "Page cited"}</span>
          </div>
        </div>
        <div className="trust-score">
          <strong>92%</strong>
          <span>{rtl ? "ثقة المخرجات" : "Output confidence"}</span>
          <small>
            {rtl
              ? "يحتاج إلى مراجعة بشرية قبل الاستشهاد الأكاديمي"
              : "Human review required before academic citation"}
          </small>
        </div>
      </section>
      <nav className="book-tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="book-content">
        <article className="panel reading-surface">
          {tab === "summary" && (
            <>
              <ContentTitle
                n="01"
                over={rtl ? "خلاصة 18 دقيقة" : "18-minute overview"}
                title={
                  rtl
                    ? "خريطة الكتاب في قراءة واحدة"
                    : "The book map in one reading"
                }
              />
              <TrustLabel rtl={rtl} />
              <p className="lead-copy">
                {rtl
                  ? "ينطلق الكتاب من أن المعرفة ليست مجرد معلومات محفوظة، بل قدرة المؤسسة على تحويل خبرات الأفراد إلى مورد يمكن مشاركته وتطويره واستخدامه في اتخاذ القرار. ويعرض الفرق بين المعرفة الصريحة القابلة للتوثيق والمعرفة الضمنية المرتبطة بالتجربة."
                  : "The book argues that knowledge is more than stored information: it is an organization’s ability to turn individual experience into a resource that can be shared, developed, and used in decisions."}
              </p>
              <h3>{rtl ? "الأفكار المحورية" : "Core ideas"}</h3>
              <div className="key-ideas">
                <Idea
                  n="1"
                  title={rtl ? "المعرفة أصل متجدد" : "Knowledge is renewable"}
                  text={
                    rtl
                      ? "تزداد قيمتها بالمشاركة المنظمة، لا بالاحتفاظ الفردي."
                      : "Its value grows through structured sharing."
                  }
                />
                <Idea
                  n="2"
                  title={
                    rtl ? "التقنية ليست كافية" : "Technology is not enough"
                  }
                  text={
                    rtl
                      ? "نجاح النظام يعتمد على الثقافة والحوافز والثقة."
                      : "Success depends on culture, incentives, and trust."
                  }
                />
                <Idea
                  n="3"
                  title={
                    rtl
                      ? "الفهرسة جسر الاسترجاع"
                      : "Cataloguing enables retrieval"
                  }
                  text={
                    rtl
                      ? "ما لا يوصف وينظم يصعب العثور عليه وإعادة استخدامه."
                      : "What is not described and organized is hard to reuse."
                  }
                />
              </div>
              <blockquote>
                {rtl
                  ? "هذه صياغة تلخيصية للمنصة وليست اقتباسًا حرفيًا من المؤلف."
                  : "This is a platform-generated summary, not a verbatim quotation from the author."}
              </blockquote>
            </>
          )}
          {tab === "chapters" && (
            <>
              <ContentTitle
                n="02"
                over={rtl ? "12 فصلًا مكتشفًا" : "12 detected chapters"}
                title={
                  rtl
                    ? "مرور أعمق على بنية الكتاب"
                    : "A deeper pass through the book"
                }
              />
              <div className="chapters">
                {[1, 2, 3, 4, 5].map((n) => (
                  <details key={n} open={n === 1}>
                    <summary>
                      <b>{String(n).padStart(2, "0")}</b>
                      <span>
                        {rtl
                          ? [
                              "من البيانات إلى المعرفة",
                              "المعرفة الصريحة والضمنية",
                              "ثقافة المشاركة",
                              "دورة حياة المعرفة",
                              "قياس الأثر",
                            ][n - 1]
                          : [
                              "From data to knowledge",
                              "Explicit and tacit knowledge",
                              "A culture of sharing",
                              "The knowledge lifecycle",
                              "Measuring impact",
                            ][n - 1]}
                      </span>
                      <em>
                        {6 + n} {rtl ? "دقائق" : "min"}
                      </em>
                    </summary>
                    <div>
                      <TrustLabel rtl={rtl} />
                      <p>
                        {rtl
                          ? "يعرض الفصل المفاهيم الأساسية والحجج والأمثلة، مع فصل واضح بين ما ورد في النص وما استنتجته المنصة."
                          : "The chapter presents its main concepts, arguments, and examples, clearly separating source content from platform inference."}
                      </p>
                      <button className="text-button">
                        {rtl
                          ? `افتح الفصل عند الصفحة ${18 + n * 12}`
                          : `Open chapter at page ${18 + n * 12}`}{" "}
                        ←
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            </>
          )}
          {tab === "analysis" && (
            <>
              <ContentTitle
                n="03"
                over={rtl ? "قراءة نقدية" : "Critical reading"}
                title={
                  rtl
                    ? "ما الذي يضيفه الكتاب وما حدوده؟"
                    : "What the book adds — and where it stops"
                }
              />
              <div className="analysis-grid">
                <div>
                  <h3>✓ {rtl ? "نقاط القوة" : "Strengths"}</h3>
                  <ul>
                    <li>
                      {rtl
                        ? "يربط إدارة المعرفة بالعمل اليومي."
                        : "Connects knowledge management to daily work."}
                    </li>
                    <li>
                      {rtl
                        ? "يقدم إطارًا واضحًا للتحويل والمشاركة."
                        : "Offers a clear sharing framework."}
                    </li>
                    <li>
                      {rtl
                        ? "أمثلته قابلة للتطبيق المؤسسي."
                        : "Examples transfer well to institutions."}
                    </li>
                  </ul>
                </div>
                <div>
                  <h3>△ {rtl ? "الحدود" : "Limitations"}</h3>
                  <ul>
                    <li>
                      {rtl
                        ? "لا يناقش الذكاء الاصطناعي الحديث بعمق."
                        : "Modern AI is not explored deeply."}
                    </li>
                    <li>
                      {rtl
                        ? "بعض الأمثلة تحتاج تحديثًا."
                        : "Some examples need updating."}
                    </li>
                    <li>
                      {rtl
                        ? "القياس العملي مختصر."
                        : "Practical measurement is brief."}
                    </li>
                  </ul>
                </div>
              </div>
              <div className="inference">
                <b>{rtl ? "تحليل المنصة" : "Platform analysis"}</b>
                <p>
                  {rtl
                    ? "يمكن تطبيق الإطار على المكتبات المتخصصة، لكن ذلك استنتاج تطبيقي وليس رأيًا منسوبًا إلى المؤلف."
                    : "The framework can be applied to specialist libraries, but this is a platform inference—not a view attributed to the author."}
                </p>
              </div>
            </>
          )}
          {tab === "return" && (
            <>
              <ContentTitle
                n="04"
                over={rtl ? "جسر العودة إلى الأصل" : "Bridge back to source"}
                title={
                  rtl
                    ? "خمسة مواضع تستحق القراءة بنفسك"
                    : "Five passages worth reading yourself"
                }
              />
              <p className="lead-copy">
                {rtl
                  ? "الخلاصة لا تكفي لفهم هذه المواضع؛ افتحها في سياقها الأصلي."
                  : "The overview is not enough for these passages; read them in their original context."}
              </p>
              <div className="return-list">
                {[
                  [42, "تعريف المعرفة الضمنية"],
                  [74, "نموذج تحويل المعرفة"],
                  [121, "مقاومة المشاركة داخل المؤسسات"],
                  [166, "بناء ذاكرة مؤسسية"],
                  [231, "مؤشرات قياس الأثر"],
                ].map(([p, s], i) => (
                  <button key={p}>
                    <b>{i + 1}</b>
                    <span>
                      {rtl
                        ? s
                        : [
                            "Defining tacit knowledge",
                            "The knowledge conversion model",
                            "Resistance to organizational sharing",
                            "Building institutional memory",
                            "Impact indicators",
                          ][i]}
                    </span>
                    <em>{rtl ? `صفحة ${p}` : `Page ${p}`} ←</em>
                  </button>
                ))}
              </div>
            </>
          )}
          {tab === "audio" && (
            <>
              <ContentTitle
                n="05"
                over={rtl ? "النسخة الصوتية للخلاصة" : "Audio overview"}
                title={
                  rtl ? "استمع إلى خريطة الكتاب" : "Listen to the book map"
                }
              />
              <div className="audio-player">
                <button onClick={() => setPlaying(!playing)}>
                  {playing ? "Ⅱ" : "▶"}
                </button>
                <div>
                  <strong>
                    {rtl
                      ? "خلاصة الكتاب — صوت عربي"
                      : "Book overview — Arabic voice"}
                  </strong>
                  <Bar value={playing ? 38 : 0} />
                  <span>06:58 / 18:42</span>
                </div>
                <select aria-label="Speed">
                  <option>1×</option>
                  <option>1.25×</option>
                  <option>1.5×</option>
                </select>
              </div>
              <div className="audio-note">
                <b>◉ {rtl ? "ما الذي يُقرأ؟" : "What is narrated?"}</b>
                <p>
                  {rtl
                    ? "الخلاصة وملخصات الفصول التي أنشأتها المنصة فقط؛ وليست قراءة حرفية كاملة للكتاب المحمي."
                    : "Only platform-generated overview and chapter summaries—not a complete verbatim narration of a protected book."}
                </p>
              </div>
            </>
          )}
        </article>
        <aside className="detail-aside">
          <div className="panel">
            <h3>{rtl ? "بطاقة الثقة" : "Trust card"}</h3>
            <p className="trust-row">
              <b className="dot source" />
              <span>{rtl ? "معلومة من الكتاب" : "From the book"}</span>
              <em>8</em>
            </p>
            <p className="trust-row">
              <b className="dot analysis" />
              <span>{rtl ? "تحليل المنصة" : "Platform analysis"}</span>
              <em>3</em>
            </p>
            <p className="trust-row">
              <b className="dot verify" />
              <span>{rtl ? "يحتاج تحققًا" : "Needs verification"}</span>
              <em>1</em>
            </p>
          </div>
          <div className="panel">
            <h3>{rtl ? "لغات المخرجات" : "Output languages"}</h3>
            <label className="select-label">
              {rtl ? "لغة التحليل" : "Analysis language"}
              <select>
                <option>{rtl ? "العربية" : "Arabic"}</option>
                <option>English</option>
                <option>{rtl ? "عرض ثنائي" : "Bilingual"}</option>
              </select>
            </label>
            <label className="select-label">
              {rtl ? "لغة الصوت" : "Audio language"}
              <select>
                <option>{rtl ? "العربية" : "Arabic"}</option>
                <option>English</option>
              </select>
            </label>
          </div>
          <button className="feedback-mini">
            ✎ {rtl ? "سجّل ملاحظتك عن هذا الكتاب" : "Log feedback on this book"}
          </button>
        </aside>
      </div>
    </div>
  );
}

function ContentTitle({
  n,
  over,
  title,
}: {
  n: string;
  over: string;
  title: string;
}) {
  return (
    <header className="content-title">
      <b>{n}</b>
      <div>
        <span>{over}</span>
        <h2>{title}</h2>
      </div>
    </header>
  );
}
function TrustLabel({ rtl }: { rtl: boolean }) {
  return (
    <span className="trust-label">
      <b className="dot source" />{" "}
      {rtl
        ? "مستند إلى الكتاب مع إحالات"
        : "Grounded in the book with citations"}
    </span>
  );
}
function Idea({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div className="idea">
      <b>{n}</b>
      <div>
        <h4>{title}</h4>
        <p>{text}</p>
      </div>
    </div>
  );
}

function Progress({ rtl, title }: { rtl: boolean; title: string }) {
  return (
    <div className="page">
      <PageTitle
        title={title}
        description={
          rtl
            ? "تذكيرات هادئة تعيدك إلى ما بدأت، دون إزعاج."
            : "Gentle reminders that bring you back without becoming noise."
        }
      />
      <div className="progress-layout">
        <article className="panel">
          <h3>{rtl ? "خطة هذا الأسبوع" : "This week’s plan"}</h3>
          <div className="week">
            {["س", "ح", "ن", "ث", "ر", "خ", "ج"].map((d, i) => (
              <span className={i < 4 ? "done" : i === 4 ? "today" : ""} key={i}>
                {d}
                <b>{i < 4 ? "✓" : i === 4 ? "•" : ""}</b>
              </span>
            ))}
          </div>
          <div className="goal">
            <strong>47 / 90</strong>
            <span>
              {rtl ? "دقيقة قراءة واستماع" : "reading & listening minutes"}
            </span>
            <Bar value={52} />
          </div>
        </article>
        <article className="panel reminders">
          <h3>{rtl ? "تنبيهات قادمة" : "Upcoming reminders"}</h3>
          <Reminder
            time={rtl ? "اليوم، 8:00 م" : "Today, 8:00 PM"}
            value={
              rtl
                ? "أكمل الفصل الرابع — إدارة المعرفة"
                : "Continue chapter four — Knowledge Management"
            }
          />
          <Reminder
            time={rtl ? "الخميس، 7:30 م" : "Thursday, 7:30 PM"}
            value={
              rtl
                ? "راجع خلاصة مستقبل المكتبات"
                : "Review The Future of Libraries summary"
            }
          />
          <Reminder
            time={rtl ? "الأحد" : "Sunday"}
            value={rtl ? "موجز أسبوعي لمكتبتك" : "Your weekly library digest"}
          />
        </article>
      </div>
    </div>
  );
}
function Reminder({ time, value }: { time: string; value: string }) {
  return (
    <div className="reminder">
      <i>◴</i>
      <div>
        <strong>{value}</strong>
        <span>{time}</span>
      </div>
      <button>⋮</button>
    </div>
  );
}

function Librarian({ rtl, title }: { rtl: boolean; title: string }) {
  const [q, setQ] = useState("");
  const [a, setA] = useState(false);
  return (
    <div className="page">
      <PageTitle
        title={title}
        description={
          rtl
            ? "يساعدك من داخل مجموعتك، ويربط الإجابات بالمصادر الأصلية."
            : "An assistant grounded in your collection and linked back to original sources."
        }
      />
      <div className="librarian-workspace">
        <div className="chat panel">
          <div className="chat-intro">
            <i>✦</i>
            <h3>
              {rtl
                ? "ماذا تريد أن تفهم اليوم؟"
                : "What would you like to understand today?"}
            </h3>
            <p>
              {rtl
                ? "اسأل كتابًا واحدًا أو قارن فكرة بين كتبك."
                : "Ask one book or compare an idea across your library."}
            </p>
          </div>
          {a && (
            <div className="answer">
              <span>{rtl ? "إجابة تجريبية" : "Demo answer"}</span>
              <p>
                {rtl
                  ? "تظهر الإجابة هنا مع فصل الكتاب ورقم الصفحة وبطاقة توضح ما إذا كانت من النص أو من تحليل المنصة."
                  : "The answer appears with chapter, page, and a trust card identifying source text versus platform analysis."}
              </p>
              <button>{rtl ? "افتح في الصفحة 74" : "Open at page 74"} ←</button>
            </div>
          )}
          <div className="chat-input">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                rtl
                  ? "مثال: ما الفرق بين المعرفة الضمنية والصريحة؟"
                  : "Example: What is the difference between tacit and explicit knowledge?"
              }
            />
            <button onClick={() => q.trim() && setA(true)}>↑</button>
          </div>
        </div>
        <aside className="panel trust">
          <h3>{rtl ? "بطاقة الثقة" : "Trust card"}</h3>
          <p>
            <b className="dot source" />
            {rtl ? "من الكتاب — موثق بالصفحة" : "From the book — page cited"}
          </p>
          <p>
            <b className="dot analysis" />
            {rtl ? "تحليل المنصة — استنتاج" : "Platform analysis — inference"}
          </p>
          <p>
            <b className="dot verify" />
            {rtl ? "يحتاج إلى تحقق" : "Needs verification"}
          </p>
          <small>
            {rtl
              ? "لا تُنسب استنتاجات المنصة إلى المؤلف."
              : "Platform inferences are never attributed to the author."}
          </small>
        </aside>
      </div>
    </div>
  );
}

function Feedback({ rtl, t }: { rtl: boolean; t: typeof text.ar }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="page">
      <PageTitle title={t.journal} description={t.journalSub} />
      <form
        className="feedback panel"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(true);
        }}
      >
        <label>
          {rtl ? "ما الذي جربته؟" : "What did you test?"}
          <select>
            <option>
              {rtl ? "رفع كتاب وتحليله" : "Upload and analyse a book"}
            </option>
            <option>{rtl ? "الملخص العام" : "Book overview"}</option>
            <option>{rtl ? "ملخصات الفصول" : "Chapter summaries"}</option>
            <option>{rtl ? "الاستماع" : "Audio"}</option>
            <option>{rtl ? "أمين المكتبة" : "AI librarian"}</option>
          </select>
        </label>
        <label>
          {rtl ? "هل ساعدك على الفهم؟" : "Did it improve understanding?"}
          <div className="rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" key={n}>
                {n}
              </button>
            ))}
          </div>
        </label>
        <label>
          {rtl ? "ملاحظتك بالتفصيل" : "Your detailed note"}
          <textarea
            placeholder={
              rtl
                ? "ما الذي نجح؟ ما الذي أربكك؟ وما الذي أعادك إلى الكتاب؟"
                : "What worked, what confused you, and what led you back to the book?"
            }
          />
        </label>
        <button className="primary" type="submit">
          {rtl ? "حفظ الملاحظة" : "Save note"}
        </button>
        {saved && (
          <span className="saved">
            ✓{" "}
            {rtl
              ? "حُفظت الملاحظة في هذه الجلسة التجريبية"
              : "Note saved for this demo session"}
          </span>
        )}
      </form>
    </div>
  );
}

function Upload({
  rtl,
  t,
  file,
  setFile,
  outputLanguage,
  setOutputLanguage,
  rights1,
  rights2,
  setRights1,
  setRights2,
  processing,
  percent,
  close,
  start,
}: {
  rtl: boolean;
  t: typeof text.ar;
  file: File | null;
  setFile: (v: File | null) => void;
  outputLanguage: OutputLanguage;
  setOutputLanguage: (v: OutputLanguage) => void;
  rights1: boolean;
  rights2: boolean;
  setRights1: (v: boolean) => void;
  setRights2: (v: boolean) => void;
  processing: boolean;
  percent: number;
  close: () => void;
  start: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section className="modal">
        <button className="modal-close" onClick={close}>
          ×
        </button>
        <div className="modal-icon">⇧</div>
        <span className="eyebrow">
          {rtl ? "الخطوة الأولى — مجانية" : "Step one — free"}
        </span>
        <h2>{t.uploadTitle}</h2>
        <p>{t.uploadSub}</p>
        {!processing ? (
          <>
            <div className="free-notice">
              <b>
                ✓{" "}
                {rtl
                  ? "لا استخدام لـ OpenAI في هذه الخطوة"
                  : "No OpenAI usage in this step"}
              </b>
              <span>
                {rtl
                  ? "سنحفظ الملف فقط. التحليل والترجمة والصوت الاحترافي تبقى خيارات منفصلة تحتاج تأكيدًا."
                  : "We only store the file. Analysis, translation and professional audio remain separate, confirmed options."}
              </span>
            </div>
            <label className="dropzone">
              <input
                type="file"
                accept=".pdf,.epub"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <i>▤</i>
              <strong>{file?.name || t.choose}</strong>
              <span>
                {rtl
                  ? "حتى 50 ميجابايت في النموذج"
                  : "Up to 50 MB in this prototype"}
              </span>
            </label>
            <label className="select-label output-language">
              {rtl
                ? "لغة الملخص والتحليل إذا طلبتهما لاحقًا"
                : "Summary and analysis language, if requested later"}
              <select
                value={outputLanguage}
                onChange={(e) =>
                  setOutputLanguage(e.target.value as OutputLanguage)
                }
              >
                <option value="ar">
                  {rtl
                    ? "العربية — ومنها ترجمة ملخص الكتاب الإنجليزي"
                    : "Arabic — including summaries of English books"}
                </option>
                <option value="en">
                  {rtl
                    ? "الإنجليزية — ومنها ترجمة ملخص الكتاب العربي"
                    : "English — including summaries of Arabic books"}
                </option>
                <option value="bilingual">
                  {rtl ? "العربية والإنجليزية" : "Arabic and English"}
                </option>
              </select>
            </label>
            <div className="rights-box">
              <h3>{rtl ? "بوابة الثقة والحقوق" : "Trust & rights gate"}</h3>
              <label>
                <input
                  type="checkbox"
                  checked={rights1}
                  onChange={(e) => setRights1(e.target.checked)}
                />
                <span>{t.rights1}</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={rights2}
                  onChange={(e) => setRights2(e.target.checked)}
                />
                <span>{t.rights2}</span>
              </label>
              <small>
                {rtl
                  ? "لن يبدأ الرفع قبل التأشير على الإقرارين."
                  : "Upload cannot start until both declarations are accepted."}
              </small>
            </div>
            <div className="modal-actions">
              <button className="secondary" onClick={close}>
                {t.cancel}
              </button>
              <button
                className="primary"
                disabled={!file || !rights1 || !rights2}
                onClick={start}
              >
                {t.start}
              </button>
            </div>
          </>
        ) : (
          <div className="processing">
            <div className="processing-ring">
              <strong>{percent}%</strong>
            </div>
            <h3>{rtl ? "نحفظ كتابك بأمان…" : "Saving your book securely…"}</h3>
            <p>
              {percent < 55
                ? rtl
                  ? "رفع الملف إلى مساحتك الخاصة"
                  : "Uploading to your private storage"
                : rtl
                  ? "حفظ الإقرار وبيانات الكتاب"
                  : "Saving consent and book details"}
            </p>
            <Bar value={percent} />
            <small>
              {rtl
                ? "لا يوجد اتصال بـ OpenAI ولا خصم مالي."
                : "No OpenAI call and no API charge."}
            </small>
          </div>
        )}
      </section>
    </div>
  );
}
