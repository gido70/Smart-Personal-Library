import json
L5=["لا أوافق بشدة","لا أوافق","محايد","أوافق","أوافق بشدة"]
def lik5(code,text,**k): return dict(code=code,type="likert",scale=dict(min=1,max=5,labels=L5),text=text,required=True,**k)
def single(code,text,opts,**k): return dict(code=code,type="single",text=text,options=opts,required=k.pop('required',True),**k)
def multi(code,text,opts,**k): return dict(code=code,type="multi",text=text,options=opts,required=k.pop('required',True),**k)
def txt(code,text,**k): return dict(code=code,type="text",text=text,required=k.pop('required',True),**k)
def rng(code,text,lo,hi,**k): return dict(code=code,type="likert",scale=dict(min=1,max=5,labels=[lo,"","","",hi]),text=text,required=True,**k)
YN=["نعم","لا"]

consent=dict(key="consent",version="0.3",title="دعوة للمشاركة في دراسة بحثية",sections=[dict(id="info",title="معلومات الدراسة",blocks=[
 ["عنوان الدراسة","الكتاب مصدرًا للمعرفة في زمن المعلومة السريعة: تصميم منصة عربية مدعومة بالذكاء الاصطناعي وتقييم دقة الفهم المستمد منها."],
 ["الباحث","[الاسم]، [البرنامج والجامعة]. المشرف: [الاسم والصفة]."],
 ["هدف الدراسة","نختبر منصة تساعد القارئ على فهم معرفة كتاب يملكه، عبر خريطة ذهنية وخلاصة وأسئلة ومقاطع صوتية مولّدة بالذكاء الاصطناعي، مع ربطها بمواضعها في الكتاب. نريد أن نعرف هل هي سهلة الاستخدام، وهل يأتي الفهم المستمد منها دقيقًا، وهل تدفع إلى الرجوع للكتاب نفسه."],
 ["ما المطلوب منك","(١) استبيان قبلي نحو ١٠ دقائق. (٢) رفع كتاب واحد تملك نسخة مشروعة منه، لا يزيد على ٤٠٠ صفحة، واستخدام المنصة معه خلال ٧ أيام بالقدر الذي تريده. (٣) استبيان بعدي بعد ٧ أيام، نحو ١٥ دقيقة. (٤) سؤال متابعة قصير بعد ١٤ يومًا أخرى، نحو ٣ دقائق. (٥) قد ندعوك لاحقًا إلى مقابلة اختيارية، ولك أن ترفض."],
 ["ما نجمعه","إجاباتك عن الاستبيانات، وسجلات استخدامك للمنصة (مثل فتح الخلاصة ومدة الاستماع وفتح الكتاب الأصلي). لا نطلب اسمك ولا بريدك. لا نسألك عن عنوان الكتاب، لكن اسم ملفه يُحفظ معه لتشغيل المنصة ويُحذف معه. تُعرَّف برمز فقط."],
 ["ملف الكتاب","يُعالَج لتوليد المخرجات لك، ولا يُشارك مع أي جهة. يطّلع عليه الباحث ومصحح ثانٍ ملتزم بالسرية فقط، لغرض واحد: مقارنة إجاباتك عن أسئلة الفهم بالكتاب نفسه. تُرسل نصوص الكتاب إلى خدمة OpenAI لتوليد المخرجات وفق شروط واجهتها البرمجية. يُحذف الملف في نهاية الدراسة."],
 ["التخزين والاطلاع","تُحفظ البيانات في قاعدة بيانات محمية، ولا يطّلع على البيانات المرمّزة إلا الباحث [والمشرف]. تُنشر النتائج مجمّعة فقط، وقد تُقتبس عبارات من إجاباتك المفتوحة دون ما يعرّف بك. تُحذف البيانات الخام بعد [المدة]."],
 ["الطوعية والانسحاب","مشاركتك طوعية تمامًا. يمكنك الانسحاب في أي وقت دون ذكر سبب، وطلب حذف بياناتك قبل [تاريخ بدء التحليل]."],
 ["المخاطر والفوائد","لا نتوقع مخاطر تتجاوز استخدامك المعتاد للإنترنت. قد تحتوي المخرجات المولّدة على أخطاء، والكتاب الأصلي هو المرجع. لا يوجد مقابل مادي."],
 ["للتواصل","[بريد الباحث]. للاستفسار عن حقوقك: [جهة الأخلاقيات]."]])],
 checks=[dict(code="CONSENT_AGE",text="عمري ١٨ سنة أو أكثر.",required=True),dict(code="CONSENT_BOOK",text="أملك نسخة مشروعة من الكتاب الذي سأرفعه.",required=True),dict(code="CONSENT_AGREE",text="قرأت ما سبق، وأوافق على المشاركة.",required=True),dict(code="CONSENT_INTERVIEW",text="أوافق على أن أُدعى إلى مقابلة لاحقة (اختياري).",required=False)])

TRUST_NOTE=dict(name="S-TIAS",cite="McGrath, M. J., Lack, O., Tisch, J., & Duenser, A. (2025). Frontiers in Artificial Intelligence, 8, 1582880; Jian, J.-Y., Bisantz, A. M., & Drury, C. G. (2000). International Journal of Cognitive Ergonomics, 4(1), 53–71.",status="ترجمة مؤقتة من الباحث؛ تنتظر الترجمة الأمامية والعكسية")
def trust(target):
  L7=["لا إطلاقًا","","","","","","إلى أقصى حد"]
  return [dict(code="TRUST1",type="likert",scale=dict(min=1,max=7,labels=L7),text=f"أنا واثق من {target}.",required=True),
          dict(code="TRUST2",type="likert",scale=dict(min=1,max=7,labels=L7),text=f"{target} موثوقة في أدائها.",required=True),
          dict(code="TRUST3",type="likert",scale=dict(min=1,max=7,labels=L7),text=f"أستطيع أن أثق ب{target}.",required=True)]
SRC=[lik5("SRC1","أثق بما أعرفه من كتاب كامل أكثر مما أعرفه من إجابات سريعة على الإنترنت."),
     lik5("SRC2","حين أريد فهم موضوع فهمًا عميقًا، أرجع إلى كتاب."),
     lik5("SRC3","تكفيني المقاطع القصيرة والإجابات السريعة لفهم معظم الموضوعات.",reverse=True),
     lik5("SRC4","حين أستشهد بفكرة، أحرص على معرفة الكتاب الذي جاءت منه.")]
def attn(code): return lik5(code,"للتأكد من انتباهك، اختر «لا أوافق» في هذا البند.",attention=2)
DEV=dict(name="مُطوَّر من الباحث",status="يحتاج تحكيمًا (CVR) وتجربة وألفا كرونباخ")
CATS=["فكر وفلسفة","دين","تاريخ وسير","علوم","تطوير ذات","إدارة واقتصاد","أدب","تقنية","أخرى"]

pre=dict(key="pre",version="0.3",title="الاستبيان القبلي",minutes="٨–١٠",sections=[
 dict(id="demo",title="بيانات أساسية",items=[
  single("PRE_AGE","الفئة العمرية",["١٨–٢٤","٢٥–٣٤","٣٥–٤٤","٤٥–٥٤","٥٥ فأكثر"]),
  single("PRE_GENDER","الجنس",["ذكر","أنثى","أفضّل عدم الإجابة"],required=False),
  single("PRE_EDU","أعلى مؤهل دراسي",["ثانوي أو أقل","دبلوم","بكالوريوس","ماجستير","دكتوراه"]),
  single("PRE_FIELD","مجال التخصص أو العمل",["علوم إنسانية واجتماعية","شرعية","تربوية","صحية","هندسية وتقنية","علوم طبيعية","إدارية واقتصادية","أخرى"],other=True),
  dict(code="PRE_COUNTRY",type="country",text="بلد الإقامة",required=True),
  single("PRE_L1","اللغة الأولى",["العربية","أخرى"],other=True),
  rng("PRE_EN","ما مستوى قراءتك للإنجليزية؟","لا أقرأ بها","أقرأ بها كتبًا متخصصة بسهولة")]),
 dict(id="habits",title="عادات القراءة",items=[
  single("PRE_BOOKS12","كم كتابًا قرأته كاملًا في آخر ١٢ شهرًا؟",["لا شيء","١–٢","٣–٥","٦–١٢","أكثر من ١٢"]),
  multi("PRE_FORMATS","بأي الأشكال تقرأ عادة؟",["ورقي","PDF أو كتاب إلكتروني","كتب صوتية","تطبيقات ملخصات","لا أقرأ كتبًا حاليًا"]),
  single("PRE_HOURS","كم ساعة تقرأ أسبوعيًا تقريبًا؟",["أقل من ساعة","١–٢","٣–٥","٦–١٠","أكثر من ١٠"]),
  dict(code="PRE_AIUSE",type="likert",scale=dict(min=1,max=5,labels=["أبدًا","نادرًا","أحيانًا","غالبًا","دائمًا"]),text="كم مرة تستخدم أدوات الذكاء الاصطناعي في القراءة أو فهم الكتب؟",required=True)]),
 dict(id="deferred",title="المكتبة المؤجلة",items=[
  single("PRE_UNREAD","كم كتابًا اقتنيته بنية قراءته ولم تقرأه بعد؟",["لا شيء","١–٥","٦–١٥","١٦–٥٠","أكثر من ٥٠"]),
  multi("PRE_REASONS","ما أسباب تأجيلك قراءتها؟",["ضيق الوقت","طول الكتاب","لغة الكتاب","صعوبة المحتوى","ضعف الدافع","انشغالي بالمحتوى الرقمي","أفضّل أشكالًا أخرى (صوتي، ملخصات، فيديو)","أخرى"],other=True),
  dict(code="PRE_REASONS_TOP3",type="rank",text="رتّب أهم ثلاثة أسباب مما اخترت",from_code="PRE_REASONS",pick=3,required=True,show_if=dict(code="PRE_REASONS",min_count=3)),
  txt("PRE_LASTBOOK","صف آخر كتاب نويت قراءته ولم تقرأه، ولماذا لم تقرأه.",required=False)]),
 dict(id="book",title="الكتاب المختار",items=[
  single("PRE_BOOK_CAT","تصنيف الكتاب",CATS,other=True),
  single("PRE_BOOK_LANG","لغة الكتاب",["العربية","الإنجليزية","أخرى"]),
  dict(code="PRE_BOOK_PAGES",type="number",text="عدد صفحاته تقريبًا",min=1,max=400,required=True),
  single("PRE_BOOK_WHY","لماذا اخترت هذا الكتاب؟",["أنوي قراءته منذ مدة","أحتاجه لعمل أو دراسة","فضول تجاه موضوعه","أريد أن أقرر هل يستحق القراءة","أخرى"],other=True),
  rng("PRE_BOOK_PRIOR","ما معرفتك المسبقة بموضوعه؟","لا أعرف عنه شيئًا","أعرفه جيدًا"),
  rng("PRE_BOOK_INTENT","لو توفر لك الوقت، ما مدى نيتك قراءته كاملًا؟","لا أنوي إطلاقًا","أنوي بالتأكيد"),
  single("PRE_BOOK_READ","هل قرأت منه شيئًا قبل اليوم؟",["لا","صفحات قليلة","فصلًا أو أكثر","معظمه"])]),
 dict(id="attitudes",title="اتجاهاتك قبل الاستخدام",source=[TRUST_NOTE,DEV],items=
  trust("أدوات الذكاء الاصطناعي التي تلخّص الكتب")+SRC[:3]+[attn("ATTN1")]+SRC[3:]+[
  lik5("EXP1","أتوقع أن تساعدني المنصة على فهم أفكار الكتاب الذي اخترته."),
  lik5("EXP2","أتوقع أن توفر عليّ المنصة وقتًا مقارنة بقراءة الكتاب وحده."),
  lik5("EXP3","أتوقع أن تزيد المنصة رغبتي في قراءة الكتاب نفسه.")])])

SUS_EN=["I think that I would like to use this system frequently.","I found the system unnecessarily complex.","I thought the system was easy to use.","I think that I would need the support of a technical person to be able to use this system.","I found the various functions in this system were well integrated.","I thought there was too much inconsistency in this system.","I would imagine that most people would learn to use this system very quickly.","I found the system very cumbersome to use.","I felt very confident using the system.","I needed to learn a lot of things before I could get going with this system."]
sus=[dict(code=f"SUS{i+1}",type="likert",scale=dict(min=1,max=5,labels=L5),text=None,text_en=e,reverse=(i%2==1),required=True) for i,e in enumerate(SUS_EN)]
COMPS=[("SUM","الخلاصة"),("MAP","الخريطة الذهنية"),("CH","الفصول والأفكار"),("Q","أسئلة الفهم"),("AUDIO","المقاطع الصوتية"),("JUMP","الانتقال إلى الصفحة في الكتاب الأصلي")]
comp=[]
for c,n in COMPS:
  comp.append(single(f"COMP_{c}_USED",f"هل استخدمت: {n}؟",YN))
  comp.append(rng(f"COMP_{c}_USEFUL",f"ما مدى فائدة «{n}» لفهم الكتاب؟","غير مفيد","مفيد جدًا") | dict(show_if=dict(code=f"COMP_{c}_USED",eq="نعم")))
comp.append(dict(code="COMP_BEST",type="single",text="أي مكوّن كان الأنفع؟",options_from_used=[n for _,n in COMPS],required=True))
NA="لم أستخدمها"
post=dict(key="post",version="0.3",title="الاستبيان البعدي",minutes="١٢–١٥",instructions="أجب عن أسئلة الفهم من ذاكرتك، دون فتح المنصة أو الكتاب. لا توجد إجابة صحيحة واحدة، ونريد فهمك أنت.",sections=[
 dict(id="und",title="فهمك للكتاب",timed=True,source=[dict(name="الاسترجاع الحر + معيار التصحيح",status="يُصحح بمعيار الوثيقة؛ اتفاق مصححين بكابا الموزون")],items=[
  txt("UND_IDEA1","الفكرة الأولى من أهم ثلاث أفكار في الكتاب، بكلماتك.",min_words=10),
  txt("UND_IDEA2","الفكرة الثانية.",min_words=10),
  txt("UND_IDEA3","الفكرة الثالثة.",min_words=10),
  txt("UND_THESIS","ما الرسالة أو الحجة الرئيسة للكتاب؟ في جملة أو جملتين."),
  txt("UND_APPLY","اذكر موقفًا في حياتك أو عملك يمكن أن تطبق فيه فكرة من الكتاب، وما الفكرة."),
  rng("UND_SELF","إلى أي مدى تشعر أنك فهمت أفكار الكتاب الرئيسة؟","لم أفهمها","فهمتها جيدًا")]),
 dict(id="sus",title="سهولة الاستخدام",source=[dict(name="A-SUS",cite="AlGhannam, B. A., Albustan, S. A., Al-Hassan, A. A., & Albustan, L. A. (2018). International Journal of Human–Computer Interaction, 34(9), 799–804; Brooke, J. (1996). SUS: A quick and dirty usability scale.",status="النص العربي المنشور لم يُدخل بعد؛ لا يُفعَّل القسم قبل إدخاله حرفيًا")],pending=True,items=sus),
 dict(id="comp",title="فائدة مكونات المنصة",source=[DEV],items=comp),
 dict(id="acc",title="الدقة والثقة",source=[TRUST_NOTE,DEV],items=[
  single("ACC1","هل وجدت في مخرجات المنصة معلومة تخالف ما في الكتاب؟",["نعم","لا","لم أتحقق"]),
  txt("ACC1_DETAIL","صف ما وجدته باختصار.",show_if=dict(code="ACC1",eq="نعم")),
  lik5("ACC2","نقلت الخلاصة أفكار الكتاب نقلًا دقيقًا.",na=NA),
  lik5("ACC3","كانت الإحالات إلى الصفحات تقودني إلى الموضع الصحيح.",na=NA)]+trust("هذه المنصة")+SRC[:2]+[attn("ATTN2")]+SRC[2:]),
 dict(id="ret",title="العودة إلى الكتاب",source=[DEV],items=[
  single("RET1","كم مرة فتحت الكتاب الأصلي خلال الأيام السبعة؟",["لا مرة","مرة","٢–٥","أكثر من ٥"]),
  multi("RET2","لماذا فتحته؟",["التحقق من معلومة","التوسع في فكرة","قراءة فصل كامل","الفضول","أخرى"],other=True,show_if=dict(code="RET1",ne="لا مرة")),
  rng("RET3","بعد استخدام المنصة، ما مدى نيتك قراءة الكتاب كاملًا؟","لا أنوي إطلاقًا","أنوي بالتأكيد"),
  lik5("RET4","ساعدتني المنصة على معرفة أي أجزاء الكتاب تستحق القراءة.")]),
 dict(id="open",title="ملاحظات (اختيارية)",items=[
  txt("OPEN_BEST","ما أكثر ما أفادك في المنصة؟",required=False),
  txt("OPEN_WORST","ما أكثر ما أزعجك أو أربكك؟",required=False),
  txt("OPEN_SUGGEST","ما الذي تقترح تغييره؟",required=False)])])

fu=dict(key="followup",version="0.3",title="المتابعة",minutes="٣",sections=[dict(id="fu",title="بعد أسبوعين",source=[DEV],items=[
  txt("FU_IDEA1","من ذاكرتك: أهم فكرة تتذكرها من الكتاب."),
  txt("FU_IDEA2","فكرة ثانية تتذكرها."),
  single("FU_RETURN","منذ الاستبيان السابق، إلى ماذا رجعت؟",["لم أرجع","المنصة فقط","الكتاب الأصلي فقط","كلاهما"]),
  single("FU_READ","كم قرأت من الكتاب الأصلي حتى الآن؟",["لا شيء","أقل من ربعه","ربعه إلى نصفه","أكثر من نصفه","كاملًا"]),
  single("FU_CITE","هل استشهدت بفكرة من الكتاب أو ناقشتها مع أحد؟",YN),
  single("FU_CITE_SRC","حين ذكرتها، إلى أي مصدر نسبتها؟",["الكتاب ومؤلفه","المنصة","لم أذكر مصدرًا"],show_if=dict(code="FU_CITE",eq="نعم")),
  rng("FU_INTENT","ما مدى نيتك قراءة الكتاب كاملًا الآن؟","لا أنوي إطلاقًا","أنوي بالتأكيد")])])

allI=[consent,pre,post,fu]
def count(i): return sum(len(s.get('items',[])) for s in i.get('sections',[]))+len(i.get('checks',[]))
codes=[it['code'] for i in allI for s in i.get('sections',[]) for it in s.get('items',[])]
dup=[c for c in set(codes) if codes.count(c)>1]
print({i['key']:count(i) for i in allI}, 'dups across:',sorted(dup))
json.dump(allI,open('/home/claude/study/instruments-v0.3.json','w'),ensure_ascii=False,indent=1)
