import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractAnalysisSource, type PreparedSource } from '../../supabase/functions/spl-ai/analysisSource';
import { pdfImageOptions } from './pdfAssets';
import { withUploadDeadline } from './uploadPreparation';
// No paid requests, no persistent source copy, no change to the original PDF.
export async function prepareLargeBookSource(file:Blob,onProgress?:(page:number,total:number)=>void):Promise<PreparedSource>{
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
  const bytes=await withUploadDeadline(file.arrayBuffer(),60000,'ANALYSIS_SOURCE_TIMEOUT');
  const task=pdfjs.getDocument({...pdfImageOptions(),data:new Uint8Array(bytes),disableFontFace:true});
  try{return await withUploadDeadline(task.promise.then(pdf=>extractAnalysisSource(pdf,onProgress)),180000,'ANALYSIS_SOURCE_TIMEOUT')}
  finally{await task.destroy()}
}
