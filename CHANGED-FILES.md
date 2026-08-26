# الملفات المتغيّرة — V0.7.2 → V0.7.3-candidate

كل تغيير هنا يعالج سببًا جذريًا موثقًا في `CLAUDE-AUDIT-REPORT.md`. لا تغيير بصري عام، ولا Migration مُنفَّذة، ولا نشر.

## ملفات جديدة

- **`src/lib/polyfills.ts`** — polyfill لـ `Promise.withResolvers` (ES2024). السبب الجذري الموحّد لعطل التحليل المحلي على iPhone وعطل استخراج نص الصوت المجاني (القسم 1 من التقرير).
- **`KNOWN-LIMITATIONS.md`** — ما لا يعمل مجانًا (OCR) وما لم يُختبر على جهاز حقيقي (iPhone، تأكيد بريد الترقية).

## ملفات مُعدَّلة

### `src/main.tsx`
استيراد `./lib/polyfills` كأول سطر، قبل React وقبل أي استيراد آخر — يضمن تركيب الـ polyfill قبل أي `import("pdfjs-dist")` ديناميكي لاحق.

### `src/lib/textAnalysis.ts`
- `stripRepeatedLines(pages)` جديدة: تحذف ترويسات/تذييلات متكررة عبر الصفحات قبل توليد العناوين المرشحة والخلاصة الاستخراجية (يصلح تكرار «Claude 5: كزميل عمل» عبر صفحات 60-67 في الدليل).
- `searchInsideBook(pagesText, query)` جديدة: بحث محلي حرفي (بدون ذكاء اصطناعي) يعيد صفحات ومقتطفات حقيقية.
- `LocalStructuralAnalysis` type: حقل اختياري جديد `pages_text?: string[]` (نص كل صفحة، محدود الطول، يغذّي البحث فقط).
- `buildLocalStructuralAnalysis`: يستخدم النص المُنظَّف (بعد `stripRepeatedLines`) لتوليد العناوين والخلاصة فقط؛ عدّ الكلمات/الأحرف يبقى على النص الأصلي الكامل لدقة الإحصاءات.

### `src/lib/localAnalysis.ts`
- `runLocalStructuralAnalysis` يعيد الآن `{ analysis, appliedBookPatch }` بدل `analysis` وحدها — يستدعي `backfillBookMetadataFromLocalAnalysis` بعد نجاح التحليل ويُعيد أي تعديل فعلي طُبِّق على الكتاب (لغة مكتشفة/عنوان أفضل)، حتى تُحدِّث الواجهة حالتها فورًا.

### `src/lib/library.ts`
- `backfillBookMetadataFromLocalAnalysis(book, analysis)` جديدة: تكتب `source_language` المكتشفة رجوعًا إلى `spl_books` فقط إذا كانت لا تزال `unknown`، وتُحدّث العنوان فقط إن وجدت عنوانًا حقيقيًا في `pdf_metadata.Title` مختلفًا عن الحالي. لا تلمس عمود `metadata` الحالي (تجنّب الكتابة فوق أي شيء كتبه المسار المدفوع سابقًا).
- `groupDuplicateBooks(books)` و`DuplicateGroup` type جديدان: تجميع آمن للسجلات المكررة (مؤكد بواسطة `content_sha256`، أو غير مؤكد بواسطة عنوان+حجم للسجلات الأقدم من الـ hash) — بلا أي حذف. الحذف يبقى حصريًا عبر `rollbackPilotBook` الموجودة أصلًا، ومن نقرتين تأكيد صريحتين في الواجهة.

### `src/lib/supabase.ts`
- `isCurrentSessionAnonymous()` و`upgradeAnonymousSessionToEmail(email)` جديدتان: مسار ترقية الحساب المجهول إلى دائم عبر `auth.updateUser({ email })` — يحافظ على نفس `auth.uid()`، بلا Migration وبلا نقل ملكية.

### `src/Reader.tsx`
- `findNextTextPage(fromPage, doc, gen)` جديدة: تبحث عن أقرب صفحة فيها نص فعلي (أمامًا ثم خلفًا، حتى 25 صفحة) عند اكتشاف صفحة غلاف/مصوَّرة بلا طبقة نص.
- `jumpToSuggestedTextPage()` جديدة + حالة `suggestedTextPage`/`scanningForText` + زر «انتقل إليها» في الواجهة.
- `catch` في `speakPage` يسجّل الاستثناء الحقيقي في console بدل ابتلاعه بصمت (كان هذا الـ catch هو ما كان يُخفي خطأ `Promise.withResolvers` خلف رسالة عامة).
- نص شارة الإصدار حُدِّث من V0.7.2 إلى V0.7.3-candidate.

### `src/App.tsx`
- `Library`: استبدال `.live-book-list` (أزرار مسطّحة تعرض `UNKNOWN · uploaded`) بمكوّن جديد `LiveBookCard` يعيد استخدام أصناف `book-card`/`book-cover` الموجودة أصلًا للنماذج، مع غلاف مولَّد محليًا (لون حتمي من عنوان الكتاب، بلا صورة، بلا API مدفوعة).
- مكوّنات جديدة: `LiveBookCard`, `DuplicateReviewPanel`, `AccountUpgradePanel`, ودالتا مساعدة على مستوى الوحدة `coverToneFor`, `languageLabel`.
- `PilotWorkspace`: prop جديد `onBookPatched` لتحديث حالة الكتاب في `Home` عند نجاح التعبئة الرجعية للغة/العنوان؛ حالة وواجهة جديدتان للبحث داخل الكتاب (`bookSearchTerm`, `bookSearchResults`, `runBookSearch`)؛ `runLocalAnalysis` مُحدَّثة للشكل الجديد لقيمة الإرجاع.
- `Home`: `patchPilotBook(bookId, patch)` جديدة لتحديث `pilotBooks`/`activePilotBook` محليًا بلا إعادة تحميل كاملة؛ `onBooksChanged` جديد يُمرَّر لـ `Library` لتحديث القائمة بعد حذف نسخة مكررة.
- شارات الإصدار النصية حُدِّثت من V0.7.2 إلى V0.7.3-candidate.

### `src/pilot.css`
قواعد جديدة فقط (إضافة، لا حذف): `.live-book-grid`, `.account-upgrade*`, `.duplicate-review`, `.duplicate-group*`, `.dup-confirmed/unconfirmed`, `button.danger`, `.book-search*` — كلها تستخدم متغيرات الألوان الموجودة أصلًا (`--ink`, `--soft`, `--line`, `--card`, `--card2`, `--gold`, `--red`).

### `src/reader.css`
قاعدة جديدة واحدة: `.text-page-hint` (لعرض اقتراح القفز لأقرب صفحة نصية).

### `scripts/test-text-analysis.mjs`
9 اختبارات جديدة (23 → 32، كلها ناجحة): إعادة إنتاج سيناريو تكرار الترويسة من صور الدليل والتحقق من إزالته، والتحقق من `searchInsideBook` (نتائج صحيحة، أرقام صفحات صحيحة، تعامل آمن مع غياب البيانات).

### `VERSION`, `package.json`
`0.7.2` → `0.7.3-candidate`.

## ملفات لم تتغيّر (فُحصت وأُقرَّت سليمة)

- `supabase/functions/spl-ai/index.ts` — الأمان (RLS، فحص ملكية، القفل الافتراضي) سليم كما هو.
- `supabase/migrations/20260826_0002_spl_v07_zero_cost.sql` — لا حاجة لأي Migration جديدة في V0.7.3؛ كل الإصلاحات الجديدة إما تستخدم أعمدة موجودة أصلًا في مخطط V0.5 (`source_language`, `title`)، أو تُخزَّن داخل `content` jsonb الموجود أصلًا (`pages_text`)، أو تعتمد آلية Supabase Auth المدمجة (ترقية الحساب) التي لا تحتاج SQL. الملف يبقى **غير مُنفَّذ** تمامًا كما تسلَّمته.
- منطق تسجيل الموافقة القانونية بعد الرفع في `startProcessing` (`App.tsx`) — التراجع (rollback) الموجود من V0.7.1 سليم، لم يتغيّر.
