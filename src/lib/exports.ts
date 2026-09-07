import type { PilotBook } from "./library";

type ReportSection = { heading: string; body: string };
type ExportQuestion = { question: string; answer: Record<string, unknown> };

const asText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(asText).filter(Boolean).join("\n");
  return value == null ? "" : String(value);
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char] ?? char));

const safeFileName = (value: string) => value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 90) || "book";

function reportSections(result: Record<string, unknown>, rtl: boolean, questions: ExportQuestion[] = []): ReportSection[] {
  const overview = (result.overview ?? {}) as Record<string, unknown>;
  const critical = (result.critical ?? {}) as Record<string, unknown>;
  const chapters = Array.isArray(result.chapters) ? result.chapters as Array<Record<string, unknown>> : [];
  const sections: ReportSection[] = [
    { heading: rtl ? "الخلاصة الذكية" : "Smart summary", body: asText(overview.summary ?? result.summary) },
    { heading: rtl ? "الأفكار المحورية" : "Key ideas", body: asText(overview.key_ideas) },
    { heading: rtl ? "الفصول" : "Chapters", body: chapters.map((chapter, index) => `${index + 1}. ${asText(chapter.title)}\n${asText(chapter.summary)}`).join("\n\n") },
    { heading: rtl ? "نقاط القوة" : "Strengths", body: asText(critical.strengths) },
    { heading: rtl ? "الحدود والملاحظات النقدية" : "Limitations", body: asText(critical.limitations) },
    { heading: rtl ? "مواضع العودة إلى الكتاب" : "Return to the source", body: asText(overview.return_to_source) },
    {
      heading: rtl ? "الأسئلة والإجابات المحفوظة" : "Saved questions and answers",
      body: questions.map((item, index) => `${index + 1}. ${item.question}\n${asText(item.answer.answer ?? item.answer)}`).join("\n\n"),
    },
  ];
  return sections.filter((section) => section.body.trim());
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadWordReport(book: PilotBook, result: Record<string, unknown>, rtl: boolean, questions: ExportQuestion[] = []) {
  const direction = rtl ? "rtl" : "ltr";
  const resultMetadata = ((result.overview ?? {}) as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
  const author = asText(book.metadata?.author ?? resultMetadata?.author) || (rtl ? "غير محدد" : "Not specified");
  const sections = reportSections(result, rtl, questions);
  const html = `<!doctype html><html dir="${direction}" lang="${rtl ? "ar" : "en"}"><head><meta charset="utf-8"><style>
  @page{size:A4;margin:20mm}body{font-family:Arial,"Traditional Arabic",sans-serif;color:#173b31;line-height:1.9;direction:${direction};text-align:${rtl ? "right" : "left"}}
  .cover{border:2px solid #124e3b;border-radius:18px;padding:36px;margin-bottom:28px;background:#f7f1e3}.brand{color:#b5822a;font-weight:bold}.title{font-size:28pt;color:#124e3b;margin:16px 0 8px}.meta{font-size:11pt;color:#5c6964}h2{font-size:18pt;color:#124e3b;border-bottom:1px solid #d9cba9;padding-bottom:7px;margin-top:26px}p{white-space:pre-wrap;font-size:12pt}.note{background:#eaf4ef;border-${rtl ? "right" : "left"}:4px solid #b5822a;padding:12px 16px;margin-top:30px;color:#40534c}
  </style></head><body><section class="cover"><div class="brand">${rtl ? "المكتبة الشخصية الذكية" : "Smart Personal Library"}</div><div class="title">${escapeHtml(book.title)}</div><div class="meta">${rtl ? "المؤلف" : "Author"}: ${escapeHtml(author)}</div></section>${sections.map((section) => `<section><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p></section>`).join("")}<p class="note">${rtl ? "هذه مخرجات تحليلية مساعدة. يُرجع إلى الكتاب الأصلي للتحقق والقراءة الكاملة." : "These are supporting analytical outputs. Return to the original book for verification and full reading."}</p></body></html>`;
  downloadBlob(new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }), `${safeFileName(book.title)}-المخرجات.doc`);
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) line = next;
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    lines.push("");
  }
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

async function canvasToJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((item) => item ? resolve(item) : reject(new Error("PDF_PAGE_EXPORT_FAILED")), "image/jpeg", .9));
  return new Uint8Array(await blob.arrayBuffer());
}

function makeImagePdf(images: Uint8Array[], pixelWidth: number, pixelHeight: number) {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = []; const offsets: number[] = [0]; let length = 0;
  const push = (part: string | Uint8Array) => { const bytes = typeof part === "string" ? enc.encode(part) : part; parts.push(bytes); length += bytes.length; };
  push("%PDF-1.4\n%âãÏÓ\n");
  const objectCount = 2 + images.length * 3;
  const addObject = (id: number, chunks: Array<string | Uint8Array>) => { offsets[id] = length; push(`${id} 0 obj\n`); chunks.forEach(push); push("\nendobj\n"); };
  addObject(1,["<< /Type /Catalog /Pages 2 0 R >>"]);
  const pageIds = images.map((_,i) => 3 + i*3);
  addObject(2,[`<< /Type /Pages /Count ${images.length} /Kids [${pageIds.map((id)=>`${id} 0 R`).join(" ")}] >>`]);
  images.forEach((image,index) => {
    const pageId=3+index*3, imageId=pageId+1, contentId=pageId+2;
    addObject(pageId,[`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`]);
    addObject(imageId,[`<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,image,"\nendstream"]);
    const content=`q\n595 0 0 842 0 0 cm\n/Im${index} Do\nQ\n`; const contentBytes=enc.encode(content);
    addObject(contentId,[`<< /Length ${contentBytes.length} >>\nstream\n`,contentBytes,"endstream"]);
  });
  const xref=length; push(`xref\n0 ${objectCount+1}\n0000000000 65535 f \n`);
  for(let id=1;id<=objectCount;id++) push(`${String(offsets[id]).padStart(10,"0")} 00000 n \n`);
  push(`trailer\n<< /Size ${objectCount+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const blobParts = parts.map((part) => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer);
  return new Blob(blobParts,{type:"application/pdf"});
}

export async function downloadPdfReport(book: PilotBook, result: Record<string, unknown>, rtl: boolean, questions: ExportQuestion[] = []) {
  const W=1240,H=1754,margin=92,maxWidth=W-margin*2;
  const pages: HTMLCanvasElement[]=[]; const contentPages=new WeakSet<HTMLCanvasElement>(); let canvas!:HTMLCanvasElement; let ctx!:CanvasRenderingContext2D; let y=0;
  const newPage=()=>{ canvas=document.createElement("canvas"); canvas.width=W; canvas.height=H; ctx=canvas.getContext("2d")!; ctx.fillStyle="#fffdf8"; ctx.fillRect(0,0,W,H); ctx.direction=rtl?"rtl":"ltr"; ctx.textAlign=rtl?"right":"left"; y=110; pages.push(canvas); };
  const x=rtl?W-margin:margin;
  const ensure=(height:number)=>{ if(y+height>H-120)newPage(); };
  const write=(text:string,size:number,color:string,bold=false,lineHeight=size*1.7)=>{ if(!text.trim())return; const font=`${bold?"700":"400"} ${size}px Arial`; ctx.font=font; ctx.fillStyle=color; const lines=wrapCanvasText(ctx,text,maxWidth); for(const line of lines){ if(!line){ if(y+lineHeight<=H-120)y+=lineHeight; continue; } ensure(lineHeight); /* newPage() replaces the context, so restore text styles after every page break. */ ctx.font=font; ctx.fillStyle=color; ctx.direction=rtl?"rtl":"ltr"; ctx.textAlign=rtl?"right":"left"; ctx.fillText(line,x,y,maxWidth); contentPages.add(canvas); y+=lineHeight; } };
  newPage(); ctx.fillStyle="#124e3b"; ctx.fillRect(0,0,W,235); ctx.fillStyle="#f4d79b"; ctx.font="700 32px Arial"; ctx.fillText(rtl?"المكتبة الشخصية الذكية":"Smart Personal Library",x,85,maxWidth); ctx.fillStyle="#ffffff"; ctx.font="700 50px Arial"; ctx.fillText(book.title,x,165,maxWidth); contentPages.add(canvas); y=300;
  const resultMetadata = ((result.overview ?? {}) as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
  write(`${rtl?"المؤلف":"Author"}: ${asText(book.metadata?.author ?? resultMetadata?.author)||(rtl?"غير محدد":"Not specified")}`,28,"#5c6964",false);
  for(const section of reportSections(result,rtl,questions)){ ensure(120); y+=26; write(section.heading,34,"#124e3b",true,56); ctx.fillStyle="#d9cba9"; ctx.fillRect(margin,y-18,maxWidth,2); y+=12; write(section.body,25,"#173b31",false,44); }
  const renderedPages=pages.filter((page)=>contentPages.has(page));
  renderedPages.forEach((page,index)=>{ const c=page.getContext("2d")!; c.direction=rtl?"rtl":"ltr"; c.textAlign=rtl?"right":"left"; c.font="22px Arial"; c.fillStyle="#7b847f"; c.fillText(rtl?`الصفحة ${index+1} من ${renderedPages.length}`:`Page ${index+1} of ${renderedPages.length}`,rtl?W-margin:margin,H-55,maxWidth); });
  const images=await Promise.all(renderedPages.map(canvasToJpeg));
  downloadBlob(makeImagePdf(images,W,H),`${safeFileName(book.title)}-المخرجات.pdf`);
}

export async function downloadSavedAudio(url: string, bookTitle: string, index: number) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("AUDIO_DOWNLOAD_FAILED");
  const blob = await response.blob();
  const ext = blob.type.includes("wav") ? "wav" : blob.type.includes("ogg") ? "ogg" : "mp3";
  downloadBlob(blob, `${safeFileName(bookTitle)}-الصوت-${String(index+1).padStart(2,"0")}.${ext}`);
}
