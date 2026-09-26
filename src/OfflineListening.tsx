import { useEffect, useRef, useState } from 'react';
import { type PilotBook, getPrivateAudioUrl } from './lib/library';
import { audioCatalogue, checkVersion, prepareOffline, syncListening } from './lib/offlineAudio';
import { nextTrack, listLocalBooks, getTrip, saveTrip, positions, savePosition, deleteLocalBook, complete, sameAudio, type OfflineBook } from './lib/offlineAudioStore';
import './offline-listening.css';
function Cover({blob,title}:{blob?:Blob;title:string}) {
  const [url,setUrl]=useState('');
  useEffect(()=>{ if(!blob) return; const u=URL.createObjectURL(blob);setUrl(u);return()=>URL.revokeObjectURL(u); },[blob]);
  return url?<img src={url} alt={title}/>:<span aria-hidden="true">📖</span>;
}
export default function OfflineListening({owner,books,rtl}:{owner:string;books:PilotBook[];rtl:boolean}) {
  const [local,setLocal]=useState<OfflineBook[]>([]),[remote,setRemote]=useState<OfflineBook[]>([]),[queue,setQueue]=useState<string[]>([]);
  const [tripCurrent,setTripCurrent]=useState('');
  const [busy,setBusy]=useState(''),[message,setMessage]=useState(''),[sync,setSync]=useState(''),[changed,setChanged]=useState<string[]>([]);
  const [online,setOnline]=useState(navigator.onLine),[current,setCurrent]=useState<{key:string;part:number}|null>(null);
  const audio=useRef<HTMLAudioElement>(null),objectUrl=useRef(''),generation=useRef(0),lastSave=useRef(0);
  const playingRef=useRef<{key:string;part:number}|null>(null),queueRef=useRef(queue),catalogueRef=useRef<OfflineBook[]>([]);
  const all=[...local,...remote.filter(b=>!local.some(l=>l.key===b.key))]; catalogueRef.current=all;queueRef.current=queue;
  const words=(ar:string,en:string)=>rtl?ar:en;
  const reload=async()=>setLocal(await listLocalBooks(owner));
  useEffect(()=>{
    let alive=true;
    void Promise.all([listLocalBooks(owner),getTrip(owner)]).then(([b,t])=>{if(alive){setLocal(b);setQueue(t.keys);setTripCurrent(t.current??'');}}).catch(e=>setMessage(String(e)));
    const on=()=>setOnline(navigator.onLine);window.addEventListener('online',on);window.addEventListener('offline',on);
    return()=>{alive=false;window.removeEventListener('online',on);window.removeEventListener('offline',on);generation.current++;audio.current?.pause();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);};
  },[owner]);
  useEffect(()=>{
    if(!online) return;let alive=true;
    void audioCatalogue(owner,books).then(async items=>{
      if(!alive)return;setRemote(items);
      const saved=await listLocalBooks(owner),updates=[];
      for(const b of items.filter(x=>saved.some(s=>s.key===x.key))) {try{const v=await checkVersion(b);if(!sameAudio(saved.find(s=>s.key===b.key)!,v))updates.push(b.key);}catch{/* no update claim on network failure */}}
      if(alive)setChanged(updates);
    }).catch(()=>{if(alive)setMessage(words('تعذّر تحديث قائمة الحساب؛ التسجيلات المحلية متاحة.','Account refresh failed; local recordings remain available.'));});
    void syncListening(owner).then(()=>{if(alive)setSync(words('تمت مزامنة موضع الاستماع','Listening position synced'));}).catch(()=>{if(alive)setSync(words('الموضع محفوظ على الجهاز؛ المزامنة السحابية معلّقة حتى تفعيل خدمتها أو عودة الاتصال.','Position saved on device; cloud sync awaits service activation or connection.'));});
    return()=>{alive=false;};
  },[owner,online,books,rtl]);
  const persist=()=>{
    const c=playingRef.current,p=audio.current;if(!c||!p)return;
    void savePosition({owner,key:c.key,part:c.part,seconds:p.currentTime||0,updatedAt:new Date().toISOString(),dirty:true}).catch(()=>setMessage(words('تعذّر حفظ موضع الاستماع على الجهاز.','Could not save listening position.')));
  };
  useEffect(()=>{const save=()=>persist();window.addEventListener('pagehide',save);document.addEventListener('visibilitychange',save);return()=>{save();window.removeEventListener('pagehide',save);document.removeEventListener('visibilitychange',save);};},[owner]);
  const setTrip=(keys:string[])=>{setQueue(keys);void saveTrip({owner,keys}).catch(()=>setMessage(words('تعذّر حفظ قائمة الرحلة','Could not save trip')));};
  const start=async(key:string,part:number,resume=0)=>{
    persist(); const token=++generation.current;const player=audio.current;if(!player)return;
    player.pause();setMessage('');
    try{
      const book=catalogueRef.current.find(b=>b.key===key),p=book?.parts[part];if(!book||!p)throw new Error('MISSING_PART');
      let src=''; if(p.blob?.size)src=URL.createObjectURL(p.blob);else {if(!navigator.onLine)throw new Error('NOT_SAVED_OFFLINE');src=await getPrivateAudioUrl(p.path);}
      if(token!==generation.current){if(src.startsWith('blob:'))URL.revokeObjectURL(src);return;}
      if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=src.startsWith('blob:')?src:'';
      playingRef.current={key,part};setCurrent({key,part});setTripCurrent(key);void saveTrip({owner,keys:queueRef.current,current:key});player.src=src;
      player.onloadedmetadata=()=>{if(token===generation.current && resume>0)player.currentTime=Math.min(resume,Number.isFinite(player.duration)?Math.max(0,player.duration-.1):resume);};
      await player.play();
      if('mediaSession' in navigator && typeof MediaMetadata!=='undefined') navigator.mediaSession.metadata=new MediaMetadata({title:book.title,artist:book.author,album:words(`الجزء ${part+1}`,`Part ${part+1}`)});
    }catch{setMessage(words('تعذّر التشغيل. تأكد من تجهيز هذا الكتاب دون إنترنت، أو أعد الاتصال واضغط تشغيل.','Playback failed. Prepare this book offline or reconnect and press play.'));}
  };
  const resumeBook=async(key:string)=>{const p=(await positions(owner)).find(p=>p.key===key);void start(key,p?.part??0,p?.seconds??0);};
  const next=()=>{
    const c=playingRef.current;if(!c)return;
    const upcoming=nextTrack(c,catalogueRef.current,queueRef.current);
    if(upcoming)void start(upcoming.key,upcoming.part);
    else {persist();setMessage(words('اكتملت قائمة الاستماع','Listening queue finished'));}
  };
  useEffect(()=>{
    if(!('mediaSession' in navigator))return;
    const handlers: [MediaSessionAction,MediaSessionActionHandler][]=[['play',()=>{void audio.current?.play().catch(()=>setMessage(words('اضغط تشغيل داخل التطبيق','Press play in the app')));}],['pause',()=>audio.current?.pause()],['nexttrack',next],['seekbackward',()=>{if(audio.current)audio.current.currentTime=Math.max(0,audio.current.currentTime-15);}],['seekforward',()=>{const p=audio.current;if(p&&Number.isFinite(p.duration))p.currentTime=Math.min(p.duration,p.currentTime+15);}]];
    for(const [action,handler] of handlers)try{navigator.mediaSession.setActionHandler(action,handler);}catch{/* unsupported device */}
    return()=>{for(const [action] of handlers)try{navigator.mediaSession.setActionHandler(action,null);}catch{/* unsupported */}};
  },[owner,rtl]);
  const prepare=async(b:OfflineBook)=>{
    setBusy(b.key);setMessage('');try{
      if(!('serviceWorker' in navigator)) throw new Error('OFFLINE_APP_UNAVAILABLE');
      await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('OFFLINE_APP_NOT_READY')),15000))]);
      if(!('caches' in window) || !(await caches.keys()).some(k=>k.startsWith('spl-shell-offline-'))) throw new Error('OFFLINE_APP_NOT_READY');
      const source=remote.find(x=>x.key===b.key)??b;const book=books.find(x=>x.id===b.bookId);
      const cover=book?String(book.metadata?.archive_cover_path??book.storage_path.replace(/[^/]+$/,'cover-v2.jpg')):undefined;
      await prepareOffline(source,cover,(n,total)=>setMessage(words(`جارٍ تجهيز ${n} من ${total}`,`Preparing ${n} of ${total}`)));
      await reload();setChanged(v=>v.filter(k=>k!==b.key));setMessage(words('متاح دون إنترنت على هذا الجهاز','Available offline on this device'));
    }catch(e){setMessage(words('لم يكتمل التجهيز؛ لم تُستبدل النسخة السابقة. تحقق من الاتصال والمساحة. ','Preparation failed; previous copy preserved. Check connection and space. ')+(e instanceof Error?e.message:''));}finally{setBusy('');}
  };
  return <div className="page offline-listening" dir={rtl?'rtl':'ltr'}>
    <h2>{words('الاستماع دون إنترنت','Offline listening')}</h2>
    <p>{words('جهّز التسجيلات أثناء الاتصال، ثم رتّب قائمة الرحلة. هذه نسخ تشغيل داخلية؛ التنزيلات القديمة مستقلة.','Prepare recordings online, then arrange your trip. Internal playback copies are separate from existing downloads.')}</p>
    <p>{words('قد يزيل الجهاز النسخ المحلية عند نقص المساحة. اختبر القائمة وقفل الشاشة قبل القيادة.','Your device may remove local copies when storage is low. Test the queue and screen lock before driving.')}</p>
    <section className="panel"><h3>{words('قائمة الرحلة','Trip queue')}</h3>
      <button className="primary" disabled={!queue.length} onClick={()=>void resumeBook(queue.includes(tripCurrent)?tripCurrent:queue[0])}>{words('🚗 تشغيل القائمة','🚗 Play queue')}</button>
      <ol>{queue.map((key,i)=><li key={key}>{all.find(b=>b.key===key)?.title??words('كتاب غير متاح محليًا','Book not locally available')} <button disabled={i===0} onClick={()=>{const a=[...queue];[a[i-1],a[i]]=[a[i],a[i-1]];setTrip(a);}}>{words('تقديم','Move up')}</button><button disabled={i===queue.length-1} onClick={()=>{const a=[...queue];[a[i+1],a[i]]=[a[i],a[i+1]];setTrip(a);}}>{words('تأخير','Move down')}</button><button onClick={()=>setTrip(queue.filter(k=>k!==key))}>{words('إزالة من القائمة','Remove from queue')}</button></li>)}</ol>
      <p aria-live="polite">{current?`${all.find(b=>b.key===current.key)?.title??''} — ${words('الجزء','Part')} ${current.part+1}`:''}</p>
      <audio ref={audio} controls preload="metadata" onEnded={next} onPause={persist} onTimeUpdate={()=>{if(Date.now()-lastSave.current>5000){lastSave.current=Date.now();persist();}}} onPlay={e=>{document.querySelectorAll('audio').forEach(p=>{if(p!==e.currentTarget)p.pause();});}} onError={()=>setMessage(words('تعذّر تحميل التسجيل. النسخة السحابية لم تتغير.','Recording failed to load. Cloud copy is unchanged.'))}/>
      <p role="status">{message}</p><small>{sync}</small>
      <button disabled={!online} onClick={()=>void syncListening(owner).then(()=>setSync(words('تمت المزامنة','Synced'))).catch(()=>setSync(words('المزامنة معلقة؛ الموضع محفوظ محليًا','Sync pending; position saved locally')))}>{words('مزامنة الموضع','Sync position')}</button>
    </section>
    <div className="offline-books">{all.map(b=>{const saved=local.find(x=>x.key===b.key),ready=!!saved&&complete(saved);return <article className="panel" key={b.key}>
      <Cover blob={saved?.cover??b.cover} title={b.title}/><h3>{b.title}</h3><p>{b.author}</p><small>{b.voice} · {b.language} · {b.parts.length} {words('أجزاء','parts')}</small>
      <p>{ready?words('✓ متاح دون إنترنت','✓ Available offline'):words('متاح بالإنترنت — يحتاج تجهيزًا','Online — preparation needed')}</p>
      {changed.includes(b.key)&&<p role="status">{words('تغيّر التسجيل؛ حدّث النسخة المحلية.','Recording changed; update local copy.')}</p>}
      <button disabled={!online||!!busy} onClick={()=>void prepare(b)}>{busy===b.key?'…':changed.includes(b.key)?words('تحديث النسخة','Update copy'):words('تجهيز دون إنترنت','Prepare offline')}</button>
      <button disabled={!ready&&!online} onClick={()=>void resumeBook(b.key)}>{words('تشغيل / متابعة','Play / resume')}</button>
      <button disabled={queue.includes(b.key)} onClick={()=>setTrip([...queue,b.key])}>{words('إضافة للرحلة','Add to trip')}</button>
      {ready&&<button disabled={!!busy} onClick={()=>{if(playingRef.current?.key===b.key){persist();generation.current++;audio.current?.pause();audio.current?.removeAttribute('src');audio.current?.load();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current='';playingRef.current=null;setCurrent(null);}void deleteLocalBook(owner,b.key).then(reload).catch(()=>setMessage(words('تعذّر حذف النسخة المحلية','Could not remove local copy')));}}>{words('حذف النسخة المحلية فقط','Remove local copy only')}</button>}
    </article>;})}</div>
    {!all.length&&<p>{words('لا توجد تسجيلات محفوظة على هذا الجهاز بعد. اتصل بالإنترنت لعرض تسجيلات الحساب.','No recordings saved on this device yet. Connect to view your account recordings.')}</p>}
  </div>;
}
