// Real-PDF rendering regression. SPL_TEST_PDF is an external private fixture;
// no book, credentials, or production data are committed or uploaded.
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.SPL_TEST_BASE || 'http://127.0.0.1:4183';
(async () => {
  assert.ok(process.env.SPL_TEST_PDF, 'Set SPL_TEST_PDF to a JPEG 2000 cover PDF');
  const engines = process.env.SPL_TEST_BROWSER === 'webkit' ? [['webkit', webkit]] : [['chromium', chromium]];
  for (const [name, engine] of engines) {
    const browser = await engine.launch({ headless: true, ...(name === 'chromium' && process.env.SPL_CHROMIUM_PATH ? { executablePath: process.env.SPL_CHROMIUM_PATH, args: ['--no-sandbox','--disable-dev-shm-usage'] } : {}) });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const warnings = [];
    page.on('console', msg => { if (/Warning|Error|OpenJPEG/.test(msg.text())) warnings.push(msg.text()); });
    await page.route(`${base}/cover-test`, r => r.fulfill({ contentType: 'text/html', body: '<input type="file"><canvas></canvas>' }));
    await page.goto(`${base}/cover-test`);
    await page.locator('input').setInputFiles(process.env.SPL_TEST_PDF);
    const render = async (fixed, fallback = false) => page.evaluate(async ({fixed, fallback}) => {
      const { pdfjs, workerUrl, pdfImageOptions } = await import('/scripts/pdf-cover-harness.ts');
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const data = new Uint8Array(await document.querySelector('input').files[0].arrayBuffer());
      const task = pdfjs.getDocument({ data, disableFontFace: true, ...(fixed ? pdfImageOptions() : {}), ...(fallback ? {useWasm:false} : {}) });
      try {
        const pdf = await task.promise;
        if(fixed && !fallback) {
          const { sampleCataloguePages } = await import('/src/lib/uploadPreparation.ts');
          const { buildIntakeCatalogue } = await import('/src/lib/autoCatalogue.ts');
          const pages = await sampleCataloguePages(pdf);
          window.intakeCatalogue = buildIntakeCatalogue('قصتي مع النوم', (await pdf.getMetadata()).info, pages);
        }
        const first = await pdf.getPage(1);
        const viewport = first.getViewport({scale:420/first.getViewport({scale:1}).width});
        const canvas = document.querySelector('canvas'); canvas.width=viewport.width;canvas.height=viewport.height;
        const context = canvas.getContext('2d', {alpha:false});
        await first.render({canvas,canvasContext:context,viewport}).promise;
        const rgba = context.getImageData(0,0,canvas.width,canvas.height).data;
        let dark=0;for(let i=0;i<rgba.length;i+=4)if(rgba[i]<80&&rgba[i+1]<80&&rgba[i+2]<100)dark++;
        return dark/(rgba.length/4);
      } finally { await task.destroy(); }
    }, {fixed, fallback});
    const old = await render(false);
    assert.ok(old < 0.02, `Old setup should reproduce missing image, got ${old}`);
    assert.ok(warnings.some(x=>/wasm|OpenJPEG|Jpx/i.test(x)), 'Expected decoder warning');
    warnings.length=0;
    const fixed = await render(true);
    assert.ok(fixed > 0.3, `Real navy cover should render, got ${fixed}`);
    assert.ok(!warnings.some(x=>/OpenJPEG|JpxError|Unable to decode/.test(x)), warnings.join('\n'));
    await page.locator('canvas').screenshot({path:process.env.SPL_COVER_SCREENSHOT || '/tmp/spl-cover-fixed.png'});
    const catalogue = await page.evaluate(() => window.intakeCatalogue);
    assert.equal(catalogue.dewey_branch, '610');
    assert.equal(catalogue.author, 'باهـمام، أحمد سالم عمر'.replace('ـ','')); // Printed CIP heading, not guessed from filename.
    assert.equal(catalogue.author_evidence.page, 4);
    const fallback = await render(true,true);
    assert.ok(Math.abs(fixed-fallback)<0.02, 'JS fallback must match wasm rendering');
    console.log(`PASS ${name}: missing-image reproduced (${old.toFixed(3)}); fixed JPEG2000 (${fixed.toFixed(3)}); non-WASM fallback (${fallback.toFixed(3)})`);
    const prepared = await page.evaluate(async () => {
      const { pdfjs, workerUrl, pdfImageOptions } = await import('/scripts/pdf-cover-harness.ts');
      const { prepareUpload } = await import('/src/lib/uploadPreparation.ts');
      const { renderCoverFromPdf, usableCover } = await import('/src/lib/coverRendering.ts');
      const file=document.querySelector('input').files[0];let reads=0;
      pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
      const result=await prepareUpload({arrayBuffer:()=>{reads++;return file.arrayBuffer();}},data=>pdfjs.getDocument({...pdfImageOptions(),data,disableFontFace:true,isOffscreenCanvasSupported:false,isImageDecoderSupported:false}),()=>{},25000,renderCoverFromPdf);
      const blank=document.createElement('canvas');blank.width=420;blank.height=594;const c=blank.getContext('2d');c.fillStyle='#f0f0ed';c.fillRect(0,0,420,594);c.fillStyle='#aaa';c.font='4px sans-serif';c.fillText('245',200,580);
      const empty=await new Promise(resolve=>blank.toBlob(resolve,'image/jpeg'));
      return {reads,pages:result.inspection.pageCount,size:result.coverBlob?.size,valid:await usableCover(result.coverBlob,true),blank:await usableCover(empty,true),archivedBlank:await usableCover(empty,false)};
    });
    assert.equal(prepared.reads,1);assert.equal(prepared.pages,244);assert.ok(prepared.size>20000&&prepared.size<150000);assert.ok(prepared.valid);assert.equal(prepared.blank,false);assert.equal(prepared.archivedBlank,true);
    console.log(`PASS real intake: one local file read; ${prepared.size}-byte JPEG prepared before network transfer; empty legacy image rejected; archived minimalist image retained`);
    await browser.close();
  }
})().catch(error => { console.error(error);process.exit(1); });
