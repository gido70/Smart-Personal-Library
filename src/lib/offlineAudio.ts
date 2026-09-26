import { supabase, ensurePilotSession } from './supabase';
import { getPrivateAudioUrl, type PilotBook } from './library';
import { audioKey, complete, getLocalBook, sameAudio, saveLocalBook, positions, savePosition, type OfflineBook } from './offlineAudioStore';
export async function audioCatalogue(owner: string, books: PilotBook[]): Promise<OfflineBook[]> {
  const session = await ensurePilotSession(); if (session.user.id!==owner) throw new Error('OWNER_MISMATCH');
  const {data,error}=await supabase!.from('spl_audio_outputs').select('id,book_id,language,voice,part_no,storage_path,created_at').eq('user_id',owner).order('part_no');
  if(error) throw error;
  const groups = new Map<string,OfflineBook>();
  for(const p of data ?? []) {
    const book=books.find(b=>b.id===p.book_id); if(!book) continue;
    const key=audioKey(owner,p.book_id,p.language,p.voice);
    if(!groups.has(key)) groups.set(key,{key,owner,bookId:book.id,title:book.title,author:String(book.metadata?.author??''),voice:p.voice,language:p.language,parts:[]});
    groups.get(key)!.parts.push({id:p.id,path:p.storage_path,number:p.part_no,version:p.created_at});
  }
  const items=[...groups.values()].filter(b=>b.parts.every((p,i)=>p.number===i+1));
  for(const item of items) {
    const book=books.find(b=>b.id===item.bookId)!;
    const path=String(book.metadata?.archive_cover_path??book.storage_path.replace(/[^/]+$/,'cover-v2.jpg'));
    if(path.startsWith(owner+'/')) { const {data}=await supabase!.storage.from('spl-books').download(path);if(data?.size)item.cover=data; }
  }
  return items;
}
async function fileInfo(path: string) {
  const {data,error}=await supabase!.storage.from('spl-audio').info(path);
  if(error) throw error;
  return JSON.stringify([data.id,data.lastModified,data.size,data.etag]);
}
export async function checkVersion(book: OfflineBook) {
  const session=await ensurePilotSession(); if(session.user.id!==book.owner) throw new Error('OWNER_MISMATCH');
  const parts=[];
  for(const part of book.parts) { if(!part.path.startsWith(book.owner+'/')) throw new Error('OWNER_MISMATCH'); parts.push({...part,version:await fileInfo(part.path)}); }
  return {...book,parts};
}
export async function prepareOffline(book: OfflineBook, coverPath: string | undefined, progress: (n:number,total:number)=>void) {
  const remote=await checkVersion(book); const old=await getLocalBook(book.owner,book.key);
  if(old && complete(old) && sameAudio(old,remote)) return old;
  const estimate=await navigator.storage?.estimate?.();
  const needed=remote.parts.reduce((n,p)=>n+Number(JSON.parse(p.version)[2]??0),0);
  if(estimate?.quota && needed>(estimate.quota-(estimate.usage??0))) throw new Error('INSUFFICIENT_DEVICE_SPACE');
  const parts=[];
  for(const p of remote.parts) {
    const cached=old?.parts.find(x=>x.id===p.id && x.version===p.version && x.path===p.path && x.blob?.size);
    if(cached) parts.push({...p,blob:cached.blob});
    else {
      const url=await getPrivateAudioUrl(p.path); const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
      if(!response.ok) throw new Error('AUDIO_FETCH_FAILED');
      const blob=await response.blob(); if(!blob.size || /text|json|html/.test(blob.type)) throw new Error('INVALID_AUDIO');
      parts.push({...p,blob});
    }
    progress(parts.length,remote.parts.length);
  }
  // Detect replacements during transfer before committing the complete snapshot.
  if(!sameAudio(remote,await checkVersion(book))) throw new Error('AUDIO_CHANGED_RETRY');
  let cover=old?.cover;
  if(coverPath?.startsWith(book.owner+'/')) {
    const {data,error}=await supabase!.storage.from('spl-books').download(coverPath);
    if(!error && data?.size) cover=data;
  }
  const result={...remote,parts,cover}; await saveLocalBook(result);
  void navigator.storage?.persist?.().catch(()=>false);
  return result;
}
// The additive table is prepared for review; missing table leaves the local outbox intact.
export async function syncListening(owner:string) {
  const session=await ensurePilotSession(); if(session.user.id!==owner) throw new Error('OWNER_MISMATCH');
  const local=await positions(owner);
  for(const p of local.filter(x=>x.dirty)) {
    const {error}=await supabase!.rpc('spl_sync_listening_position',{p_audio_key:p.key,p_part:p.part,p_seconds:p.seconds,p_updated_at:p.updatedAt});
    if(error) throw error;
    // Never mark a newer locally-written position as synced.
    const current=(await positions(owner)).find(x=>x.key===p.key);
    if(current?.updatedAt===p.updatedAt) await savePosition({...p,dirty:false});
  }
  const {data,error}=await supabase!.from('spl_listening_positions').select('*').eq('user_id',owner);
  if(error) throw error;
  for(const row of data??[]) {
    const current=(await positions(owner)).find(x=>x.key===row.audio_key);
    if(!current || (!current.dirty && Date.parse(row.updated_at)>Date.parse(current.updatedAt))) await savePosition({owner,key:row.audio_key,part:row.part,seconds:row.seconds,updatedAt:row.updated_at,dirty:false});
  }
}
