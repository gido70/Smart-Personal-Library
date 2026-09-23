const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const base=process.env.SPL_TEST_BASE||'http://127.0.0.1:4184';
 const browser=await chromium.launch({executablePath:process.env.SPL_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();
 const userId='11111111-1111-4111-8111-111111111111';
 let current={}, patches=0, authorName='', linkCount=0, conflict=false;
 await page.route(`${base}/harness`,r=>r.fulfill({contentType:'text/html',body:'test'}));
 await page.route('**/auth/v1/**',r=>r.fulfill({json:{id:userId,email:'test@example.invalid',aud:'authenticated',role:'authenticated'}}));
 await page.route('**/rest/v1/**',async r=>{
   const req=r.request(),url=new URL(req.url()),method=req.method();
   assert.ok(/\/(spl_books|spl_authors|spl_book_authors)$/.test(url.pathname),'No unrelated or paid tables');
   if(url.pathname.endsWith('/spl_books')){
     if(method==='PATCH'){
       assert.deepEqual(JSON.parse(url.searchParams.get('metadata').replace(/^eq\./, '')),current,'PostgREST JSON filter must contain actual JSON, not [object Object]');
       if(conflict)return r.fulfill({json:[]});
       patches++;current=JSON.parse(req.postData()).metadata;return r.fulfill({json:[{id:'book'}]});
     }
     return r.fulfill({json:{metadata:current}});
   }
   if(url.pathname.endsWith('/spl_authors')){authorName=JSON.parse(req.postData()).authorized_name;return r.fulfill({json:{id:'author'}});}
   if(method==='POST'){linkCount++;return r.fulfill({json:[]});}
   return r.fulfill({json:[]});
 });
 await page.goto(`${base}/harness`);
 await page.evaluate(async({userId})=>{
   const client=await import('/src/lib/supabase.ts');
   const enc=x=>btoa(JSON.stringify(x)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
   await client.supabase.auth.setSession({access_token:enc({alg:'HS256'})+'.'+enc({sub:userId,exp:Math.floor(Date.now()/1000)+3600})+'.dGVzdA',refresh_token:'local-only'});
   window.lib=await import('/src/lib/library.ts');
 },{userId});
 const repair=()=>page.evaluate(async()=>{
   const text='باهـمام ، أحمد سالم عمر\nعنوان /\nباهـمام ، أحمد سالم عمر .- الرياض\nردمك: 123';
   const pdf={numPages:1,getMetadata:async()=>({info:{}}),getPage:async()=>({getTextContent:async()=>({items:[{str:text,hasEOL:true}]}),cleanup:()=>{}})};
   await window.lib.repairIntakeCatalogue({id:'book',title:'قصتي مع النوم',metadata:{}},pdf);
 });
 current={paid_outputs:'retained'};await repair();assert.equal(current.author,'باهمام، أحمد سالم عمر');assert.equal(current.dewey_branch,'610');assert.equal(current.paid_outputs,'retained');assert.equal(authorName,current.author);assert.equal(linkCount,1);
 await repair();assert.equal(patches,1,'Repair is idempotent');
 current={author:'اسم محرر محفوظ',dewey_main:'900',dewey_branch:'920',catalog_corrected_at:'today',classification_corrected_at:'today'};await repair();assert.equal(current.author,'اسم محرر محفوظ');assert.equal(current.dewey_branch,'920');
 current={catalog_corrected_at:'today',author:null};await repair();assert.equal(current.author,null,'Explicit manual blank stays blank');
 conflict=true;current={};const before=patches;await repair();assert.equal(patches,before,'Concurrent edit wins');
 await browser.close();console.log('PASS: saved book repaired, author linked, paid metadata retained, idempotent, manual corrections and concurrent edit protected');
})().catch(e=>{console.error(e);process.exit(1)});
