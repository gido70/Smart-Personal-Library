-- SPL study: completion reward (keep platform outputs after the post questionnaire) and consent v0.4.
alter table public.spl_study_participants add column if not exists reward_granted_at timestamptz;

update public.spl_study_instruments set active = false where key = 'consent' and version <> '0.4';
insert into public.spl_study_instruments(key,version,title,definition,active)
values ('consent','0.4','دعوة للمشاركة في دراسة بحثية',$j${"key":"consent","version":"0.4","title":"دعوة للمشاركة في دراسة بحثية","sections":[{"id":"info","title":"معلومات الدراسة","blocks":[["عنوان الدراسة","الكتاب مصدرًا للمعرفة في زمن المعلومة السريعة: تصميم منصة عربية مدعومة بالذكاء الاصطناعي وتقييم دقة الفهم المستمد منها."],["الباحث","[الاسم]، [البرنامج والجامعة]. المشرف: [الاسم والصفة]."],["هدف الدراسة","نختبر منصة تساعد القارئ على فهم معرفة كتاب يملكه، عبر خريطة ذهنية وخلاصة وأسئلة ومقاطع صوتية مولّدة بالذكاء الاصطناعي، مع ربطها بمواضعها في الكتاب. نريد أن نعرف هل هي سهلة الاستخدام، وهل يأتي الفهم المستمد منها دقيقًا، وهل تدفع إلى الرجوع للكتاب نفسه."],["ما المطلوب منك","(١) استبيان قبلي نحو ١٠ دقائق. (٢) رفع كتاب واحد تملك نسخة مشروعة منه، لا يزيد على ٤٠٠ صفحة، واستخدام المنصة معه خلال ٧ أيام بالقدر الذي تريده. (٣) استبيان بعدي بعد ٧ أيام، نحو ١٥ دقيقة. (٤) سؤال متابعة قصير بعد ١٤ يومًا أخرى، نحو ٣ دقائق. (٥) قد ندعوك لاحقًا إلى مقابلة اختيارية، ولك أن ترفض."],["ما نجمعه","إجاباتك عن الاستبيانات، وسجلات استخدامك للمنصة (مثل فتح الخلاصة ومدة الاستماع وفتح الكتاب الأصلي). لا نطلب اسمك ولا بريدك. لا نسألك عن عنوان الكتاب، لكن اسم ملفه يُحفظ معه لتشغيل المنصة ويُحذف معه. تُعرَّف برمز فقط."],["ملف الكتاب","يُعالَج لتوليد المخرجات لك، ولا يُشارك مع أي جهة. يطّلع عليه الباحث ومصحح ثانٍ ملتزم بالسرية فقط، لغرض واحد: مقارنة إجاباتك عن أسئلة الفهم بالكتاب نفسه. تُرسل نصوص الكتاب إلى خدمة OpenAI لتوليد المخرجات وفق شروط واجهتها البرمجية. يُحذف من المنصة في نهاية الدراسة، فنزّل الخلاصة والصوت قبل ذلك إن أردت الاحتفاظ بهما."],["التخزين والاطلاع","تُحفظ البيانات في قاعدة بيانات محمية، ولا يطّلع على البيانات المرمّزة إلا الباحث [والمشرف]. تُنشر النتائج مجمّعة فقط، وقد تُقتبس عبارات من إجاباتك المفتوحة دون ما يعرّف بك. تُحذف البيانات الخام بعد [المدة]."],["الطوعية والانسحاب","مشاركتك طوعية تمامًا. يمكنك الانسحاب في أي وقت دون ذكر سبب، وطلب حذف بياناتك قبل [تاريخ بدء التحليل]."],["المخاطر والفوائد","لا نتوقع مخاطر تتجاوز استخدامك المعتاد للإنترنت. قد تحتوي المخرجات المولّدة على أخطاء، والكتاب الأصلي هو المرجع. لا يوجد مقابل مادي. عند إرسال الاستبيان البعدي تحتفظ بمخرجات المنصة لكتابك (الخلاصة والصوت) مجانًا ويمكنك تنزيلها. لا يتوقف ذلك على مضمون إجاباتك، ويُمنح حتى لو لم تدخل بياناتك في التحليل."],["للتواصل","[بريد الباحث]. للاستفسار عن حقوقك: [جهة الأخلاقيات]."]]}],"checks":[{"code":"CONSENT_AGE","text":"عمري ١٨ سنة أو أكثر.","required":true},{"code":"CONSENT_BOOK","text":"أملك نسخة مشروعة من الكتاب الذي سأرفعه.","required":true},{"code":"CONSENT_AGREE","text":"قرأت ما سبق، وأوافق على المشاركة.","required":true},{"code":"CONSENT_INTERVIEW","text":"أوافق على أن أُدعى إلى مقابلة لاحقة (اختياري).","required":false}]}$j$::jsonb,true)
on conflict (key,version) do update set definition=excluded.definition, active=true, updated_at=now();

create or replace function public.spl_study_grant_reward()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The reward is granted on submitting the post questionnaire, independent of answers or attention checks.
  if new.status = 'post_done' and old.status is distinct from 'post_done' and new.reward_granted_at is null then
    new.reward_granted_at := now();
  end if;
  return new;
end; $$;
drop trigger if exists spl_study_grant_reward on public.spl_study_participants;
create trigger spl_study_grant_reward before update of status on public.spl_study_participants
for each row execute function public.spl_study_grant_reward();
