import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64');
const coverUrl = moduleUrl(fs.readFileSync('src/lib/reportCover.ts', 'utf8'));
const { readReportCover } = await import(coverUrl);
const { buildPdfReport } = await import(moduleUrl(fs.readFileSync('src/lib/exports.ts', 'utf8').replace('"./reportCover"', JSON.stringify(coverUrl))));
const book = { title: 'التحول الرقمي في الإدارة والقيادة الحديثة', storage_path: 'owner/book/original.pdf', metadata: { author: 'د. سيف يوسف السويدي' } };
const blob = new Blob(['cover'], { type: 'image/jpeg' });
let paths = [];
assert.equal(await readReportCover(book, async path => { paths.push(path); return blob; }), blob);
assert.deepEqual(paths, ['owner/book/cover-v2.jpg']);
paths = [];
assert.equal(await readReportCover({ ...book, metadata: { archive_cover_path: 'owner/book/archive-cover.jpg' } }, async path => { paths.push(path); return blob; }), blob);
assert.deepEqual(paths, ['owner/book/archive-cover.jpg']);
paths = [];
assert.equal(await readReportCover({ ...book, metadata: { cover_path: 'other/book/secret.jpg', archive_cover_path: 'owner/book/original.pdf' } }, async path => { paths.push(path); throw Error('missing'); }), null);
assert(paths.every(path => path.startsWith('owner/book/') && path.endsWith('.jpg')));

globalThis.window = globalThis;
let drawn = [];
globalThis.Image = class {
  naturalWidth = 600; naturalHeight = 850;
  set src(value) { if(value) queueMicrotask(() => this.onload?.()); }
};
globalThis.document = { createElement() { return { getContext() { return { measureText: t => ({ width: t.length * 12 }), fillRect() {}, fillText() {}, drawImage(...args) { drawn.push(args); } }; }, toBlob(callback) { callback(new Blob(['jpeg'])); } }; } };
const result = { overview: { summary: 'ملخص تجريبي يحافظ على المحتوى الأصلي.' } };
const without = await (await buildPdfReport(book, result, true)).text();
const withCover = await (await buildPdfReport(book, result, true, [], blob)).text();
assert(without.includes('/Count 1'));
assert(withCover.includes('/Count 2'));
assert.equal(drawn.length, 1);
assert(Math.abs(drawn[0][3] / drawn[0][4] - 600 / 850) < 1e-10);
globalThis.Image = class { set src(value) { if(value) queueMicrotask(() => this.onerror?.()); } };
assert((await (await buildPdfReport(book, result, true, [], blob)).text()).includes('/Count 1'));

// Optional local visual proof uses the installed PDF.js canvas dependency.
if (process.argv[2]) {
  const { createCanvas, loadImage, GlobalFonts } = await import('@napi-rs/canvas');
  GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'Arial');
  GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'Arial');
  globalThis.document = { createElement() { const c = createCanvas(1, 1); c.toBlob = cb => cb(new Blob([c.toBuffer('image/jpeg')])); return c; } };
  globalThis.Image = class {
    set src(url) {
      if (!url) return;
      fetch(url).then(r=>r.arrayBuffer()).then(b=>loadImage(Buffer.from(b))).then(image=>{
        this.image=image; this.naturalWidth=image.width; this.naturalHeight=image.height; this.onload?.();
      }).catch(()=>this.onerror?.());
    }
  };
  const create = document.createElement;
  document.createElement = () => { const c=create(); const ctx=c.getContext('2d'); const draw=ctx.drawImage.bind(ctx); ctx.drawImage=(img,...args)=>draw(img.image??img,...args); return c; };
  const pdf = await buildPdfReport(book, result, true, [], new Blob([fs.readFileSync(process.argv[2])], {type:'image/png'}));
  fs.writeFileSync(process.argv[3], Buffer.from(await pdf.arrayBuffer()));
}
console.log('Report cover: stored-image-only, archived cover, isolation, fallback, aspect ratio and page preservation passed.');
