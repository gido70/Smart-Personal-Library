// A real 102 MB PDF served locally with byte-range support; verifies the cheap
// cached-cover catalogue repair does not fetch the entire book.
const {chromium}=require('playwright');const http=require('node:http');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 assert.ok(process.env.SPL_TEST_PDF);const file=process.env.SPL_TEST_PDF,size=fs.statSync(file).size;let sent=0,ranges=0;
 const server=http.createServer((req,res)=>{
  const common={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Accept-Ranges,Content-Length,Content-Range','Accept-Ranges':'bytes','Content-Type':'application/pdf'};
  const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),size-1):size-1;
  if(match)ranges++;res.writeHead(match?206:200,{...common,'Content-Length':end-start+1,...(match?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});res.flushHeaders();
  const stream=fs.createReadStream(file,{start,end,highWaterMark:16384});stream.on('data',chunk=>{sent+=chunk.length});res.on('close',()=>stream.destroy());stream.pipe(res);
 });await new Promise(r=>server.listen(4197,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.SPL_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{const page=await browser.newPage();const base=process.env.SPL_TEST_BASE||'http://127.0.0.1:4183';await page.goto(base);
 const result=await page.evaluate(async()=>{
  const {pdfjs,workerUrl,pdfImageOptions}=await import('/scripts/pdf-cover-harness.ts');const {sampleCataloguePages}=await import('/src/lib/uploadPreparation.ts');const {buildIntakeCatalogue}=await import('/src/lib/autoCatalogue.ts');pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
  const task=pdfjs.getDocument({...pdfImageOptions(),url:'http://127.0.0.1:4197/book.pdf',disableStream:true,disableAutoFetch:true,rangeChunkSize:65536,disableFontFace:true});
  try{const pdf=await task.promise;return buildIntakeCatalogue('قصتي مع النوم',(await pdf.getMetadata()).info,await sampleCataloguePages(pdf));}finally{await task.destroy();}
 });assert.equal(result.author,'باهمام، أحمد سالم عمر');assert.ok(ranges>0);assert.ok(sent<size/10,`Repair fetched too much: ${sent}/${size}`);console.log(`PASS: actual catalogue via ${ranges} ranges, ${sent} bytes sent out of ${size}; correct author without full PDF download`);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
