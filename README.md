# المكتبة الشخصية الذكية — V0.5

نموذج وظيفي تجريبي مهيأ للنشر على GitHub Pages، مع قاعدة بيانات وتخزين خاصين داخل مشروع Supabase الخاص بأكاديمية الفلاح، ووظيفة خلفية للتحليل الثنائي اللغة والأسئلة والصوت.

## التشغيل محليًا

```bash
npm install
npm run dev
```

## النشر

يدفع المستودع إلى فرع `main`، ثم ينشر GitHub Actions مجلد `dist` تلقائيًا عبر GitHub Pages.

## الخصوصية

قارئ الأصل المحلي ما زال يفتح PDF داخل ذاكرة المتصفح. أما مسار «تحليل كتاب» فيتطلب الموافقة القانونية ثم يحفظ الملف في bucket خاص `spl-books` ويعالج النتائج تحت سياسات RLS الخاصة بصاحب الحساب.

## تفعيل V0.5

1. راجع ثم نفّذ `supabase/migrations/20260825_0001_spl_v05_pilot.sql`.
2. فعّل Anonymous Sign-ins في Supabase Auth للنموذج التجريبي.
3. انشر الوظيفة `supabase/functions/spl-ai`.
4. أضف `OPENAI_API_KEY` و`OPENAI_TEXT_MODEL` إلى أسرار Supabase Functions.
5. أضف `VITE_SUPABASE_URL` و`VITE_SUPABASE_PUBLISHABLE_KEY` إلى GitHub Actions secrets.
