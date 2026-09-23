/* Local browser integration test: real PDF parsing, hashing and TUS client;
   all Auth/Database/Storage traffic is intercepted. No production writes. */
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const base = process.env.SPL_TEST_BASE || 'http://127.0.0.1:4179';
const userId = '11111111-1111-4111-8111-111111111111';
const oldId = '22222222-2222-4222-8222-222222222222';
function samplePdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> >>'];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${obj}\nendobj\n`; });
  // Valid PDF comment padding before xref makes the fixture span two chunks.
  pdf += '%' + ' '.repeat(7 * 1024 * 1024) + '\n';
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 4\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10,'0')+' 00000 n \n').join('') + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
(async () => {
  const realPdf = process.env.SPL_TEST_PDF ? fs.readFileSync(process.env.SPL_TEST_PDF) : samplePdf();
  const realHash = crypto.createHash('sha256').update(realPdf).digest('hex');
  for (const [name, engine] of [['chromium',chromium],['webkit',webkit]].filter(([name]) => !process.env.SPL_TEST_BROWSER || process.env.SPL_TEST_BROWSER === name)) {
    const browser = await engine.launch({headless:true, ...(name === "chromium" && process.env.SPL_CHROMIUM_PATH ? {executablePath:process.env.SPL_CHROMIUM_PATH,args:["--no-sandbox","--disable-dev-shm-usage"]} : {})});
    const page = await browser.newPage({viewport:{width:390,height:844}});
    let mode, record, uploaded, inserts, patches, requests, failures, maxChunk, offset, hash;
    const reset = value => { mode=value;record=null;uploaded=0;inserts=0;patches=0;requests=0;failures=0;maxChunk=0;offset=0;hash=crypto.createHash('sha256'); };
    await page.route(`${base}/harness`, r=>r.fulfill({contentType:'text/html',body:'<input type="file" id="pdf">'}));
    await page.route('**/auth/v1/**', r=>r.fulfill({json:{id:userId,email:'local-test@example.invalid',aud:'authenticated',role:'authenticated'}}));
    await page.route('**/rest/v1/**', async route => {
      const req=route.request(), url=new URL(req.url());
      assert.ok(url.pathname.endsWith('/spl_books'), 'upload must not touch paid outputs or other tables');
      const method=req.method();
      if (method==='POST') { inserts++;record=JSON.parse(req.postData()); return route.fulfill({json:record}); }
      if (method==='PATCH') { record={...record,...JSON.parse(req.postData())};return route.fulfill({json:record}); }
      if (url.searchParams.has('content_sha256')) {
        if (['duplicate','archived','full-archive','restore-denied'].includes(mode)) {
          record={id:oldId,title:'Saved title',storage_path:`${userId}/${oldId}/book.pdf`,content_sha256:realHash,metadata:mode==='duplicate'?{paid_outputs:'retained'}:{archived_at:'2026-09-23',original_removed:true,paid_outputs:'retained'}};
          return route.fulfill({json:record});
        }
        return route.fulfill({json:null});
      }
      return route.fulfill({json:mode==='full-archive'?Array.from({length:6},(_,i)=>({id:String(i),metadata:{}})):[]});
    });
    await page.route('**/storage/v1/upload/**', async route => {
      const req=route.request();requests++;
      assert.match(req.headers().authorization || '', /^Bearer /);
      const headers={'Tus-Resumable':'1.0.0','Upload-Offset':String(offset)};
      if (mode==='restore-denied') return route.fulfill({status:403,body:'denied',headers});
      if (mode==='stall') return; // client idle watchdog must abort this request
      if (req.method()==='HEAD') return route.fulfill({status:200,headers:{...headers,'Upload-Length':String(realPdf.length)}});
      if (req.method()==='PATCH' && failures===0 && mode==='retry') {failures++;return route.fulfill({status:503,body:'temporary',headers});}
      const body=req.postDataBuffer() || Buffer.alloc(0);
      maxChunk=Math.max(maxChunk,body.length);assert.ok(body.length<=6*1024*1024);
      if (req.method()==='PATCH') {patches++;assert.equal(Number(req.headers()['upload-offset']),offset);}
      if (req.method()==='POST') {
        const metadata=Object.fromEntries(req.headers()['upload-metadata'].split(',').map(pair=>{const [k,v]=pair.trim().split(' ');return [k,Buffer.from(v,'base64').toString()];}));
        assert.equal(metadata.bucketName,'spl-books');assert.ok(metadata.objectName.startsWith(userId+'/'));
        assert.equal(req.headers()['x-upsert'],mode==='archived'?'true':'false');
      }
      hash.update(body);offset+=body.length;uploaded+=body.length;
      return route.fulfill({status:req.method()==='POST'?201:204,headers:{...headers,'Upload-Offset':String(offset),Location:`${base}/storage/v1/upload/resumable/test-id`}});
    });
    await page.goto(`${base}/harness`);
    await page.evaluate(async ({userId})=>{
      const client=await import('/src/lib/supabase.ts');
      const encode = value => btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
      const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:userId,exp:Math.floor(Date.now()/1000)+3600})+'.dGVzdA';
      const result=await client.supabase.auth.setSession({access_token:token,refresh_token:'local-only'});
      if(result.error)throw result.error;
      window.uploadLibrary=await import('/src/lib/library.ts');
      const OriginalWorker=window.Worker; window.workersDestroyed=0;
      window.Worker=class extends OriginalWorker {terminate(){window.workersDestroyed++;super.terminate();}};
    },{userId});
    await page.locator('#pdf').setInputFiles(process.env.SPL_TEST_PDF || {name:'test-book.pdf',mimeType:'application/pdf',buffer:realPdf});
    const run=()=>page.evaluate(async()=>{
      const events=[];try {
        const result=await window.uploadLibrary.uploadPilotBook(document.querySelector('#pdf').files[0],'ar',e=>events.push(e));
        return {result,events,workersDestroyed:window.workersDestroyed};
      }catch(e){return {error:e.message,events};}
    });
    reset('retry');const first=await run();assert.ok(first.result,JSON.stringify(first));
    assert.equal(uploaded,realPdf.length);assert.equal(hash.digest('hex'),realHash);assert.equal(inserts,1);assert.equal(failures,1);assert.ok(patches>0);
    assert.equal(first.result.book.content_sha256,realHash);assert.ok(first.workersDestroyed>0);
    assert.ok(first.events.some(e=>e.stage==='uploading'&&e.percent>0&&e.percent<100));
    console.log(`PASS ${name}: ${realPdf.length} bytes, exact SHA-256, 6 MiB chunks, retry/HEAD resume, PDF worker released, page count ${first.result.book.metadata.page_count}`);
    reset('duplicate');const duplicate=await run();assert.equal(duplicate.result.book.id,oldId);assert.equal(requests,0);assert.equal(inserts,0);
    reset('archived');const archived=await run();assert.equal(archived.result.book.id,oldId);assert.equal(archived.result.book.metadata.paid_outputs,'retained');assert.equal(archived.result.book.metadata.archived_at,undefined);assert.equal(inserts,0);assert.equal(uploaded,realPdf.length);
    reset('full-archive');assert.equal((await run()).error,'ACTIVE_BOOK_LIMIT_REACHED');assert.equal(requests,0);assert.equal(inserts,0);
    reset('restore-denied');assert.equal((await run()).error,'BOOK_UPLOAD_AUTH');assert.equal(inserts,0);
    reset('size');const tooLarge=await page.evaluate(async()=>{try{await window.uploadLibrary.uploadPilotBook(new File([new Uint8Array(150*1024*1024+1)],'big.pdf',{type:'application/pdf'}),'ar');}catch(e){return e.message;}});assert.equal(tooLarge,'FILE_TOO_LARGE_150MB');assert.equal(requests,0);
    reset('stall');const stalled=await page.evaluate(async(base)=>{
      const {uploadBookChunks}=await import('/src/lib/bookUpload.ts');
      try{await uploadBookChunks(new File(['test'],'test.pdf'),{baseUrl:base,storagePath:'test',upsert:false,getAccessToken:async()=>'test',idleTimeoutMs:200});}catch(e){return e.message;}
    },base);assert.equal(stalled,'BOOK_UPLOAD_STALLED');
    console.log(`PASS ${name}: duplicate reuse, archive restoration retains record/outputs, full shelf blocked, restoration failure cannot create duplicate, 150 MiB boundary, stalled transfer stops`);
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exit(1);});
