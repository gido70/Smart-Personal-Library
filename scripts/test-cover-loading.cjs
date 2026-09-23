// Browser integration: existing JPEGs, legacy Samsung fallback and account checks.
// Auth/storage are intercepted; no real account or production changes.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const base=process.env.SPL_TEST_BASE||'http://127.0.0.1:4184';
 const browser=await chromium.launch({executablePath:process.env.SPL_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const [name,ua] of [['iphone','Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'],['samsung','Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36 SamsungBrowser/26.0']]){
  const page=await browser.newPage({viewport:{width:390,height:844},userAgent:ua});const requests=[];let bytes=0,jpeg;
  const userId='11111111-1111-4111-8111-111111111111';
  await page.route(`${base}/harness`,r=>r.fulfill({contentType:'text/html',body:'test'}));
  await page.route('**/auth/v1/**',r=>r.fulfill({json:{id:userId,email:'test@example.invalid',aud:'authenticated',role:'authenticated'}}));
  await page.route('**/storage/v1/**',r=>{
   const path=new URL(r.request().url()).pathname;requests.push(path);
   assert.ok(!path.endsWith('.pdf'),'Cached shelf MUST NOT download original PDF');
   if(path.includes('/legacy/')&&path.endsWith('/cover-v2.jpg'))return r.fulfill({status:404,json:{message:'not found'}});
   bytes+=jpeg.length;return r.fulfill({status:200,contentType:'image/jpeg',body:jpeg});
  });
  await page.goto(`${base}/harness`);
  const image=await page.evaluate(async({userId})=>{
   const client=await import('/src/lib/supabase.ts');const enc=x=>btoa(JSON.stringify(x)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
   await client.supabase.auth.setSession({access_token:enc({alg:'HS256'})+'.'+enc({sub:userId,exp:Math.floor(Date.now()/1000)+3600})+'.dGVzdA',refresh_token:'local-only'});
   window.cover=await import('/src/lib/bookCovers.ts');
   const c=document.createElement('canvas');c.width=420;c.height=594;const ctx=c.getContext('2d');ctx.fillStyle='#081a36';ctx.fillRect(0,0,420,594);ctx.fillStyle='#d1a546';ctx.fillRect(40,60,320,80);
   return c.toDataURL('image/jpeg',.82).split(',')[1];
  },{userId});jpeg=Buffer.from(image,'base64');
  const result=await page.evaluate(async({userId})=>{
   const book={id:'new',title:'Test',storage_path:`${userId}/new/book.pdf`,file_size:101968893,metadata:{catalogue_version:1}};
   const begin=performance.now();const [a,b]=await Promise.all([window.cover.loadOriginalCover(book),window.cover.loadOriginalCover(book)]);
   const img=new Image();img.src=URL.createObjectURL(a);await img.decode();document.body.append(img);
   await window.cover.loadOriginalCover(book);
   await window.cover.loadOriginalCover({...book,id:'legacy',storage_path:`${userId}/legacy/book.pdf`});
   await window.cover.loadOriginalCover({...book,id:'archive',storage_path:`${userId}/archive/book.pdf`,metadata:{archived_at:'today',archive_cover_path:`${userId}/archive/archive-cover.jpg`}});
   let denied=false;try{await window.cover.loadOriginalCover({...book,storage_path:'other-user/new/book.pdf'})}catch{denied=true;}
   return {same:a===b,decoded:img.naturalWidth,denied,ms:performance.now()-begin};
  },{userId});
  assert.ok(result.same);assert.ok(result.denied);assert.equal(result.decoded,420);assert.equal(requests.length,4,'One modern thumbnail, two legacy lookups, one archive thumbnail');
  assert.ok(bytes<200000);console.log(`PASS ${name} UA: ${requests.length} small-image requests, ${bytes} bytes, zero PDF downloads, hero/shelf shared, image decoded; ${Math.round(result.ms)} ms mocked transport`);
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
