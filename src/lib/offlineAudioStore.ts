export type AudioPart = { id: string; path: string; number: number; version: string; blob?: Blob };
export type OfflineBook = { key: string; owner: string; bookId: string; title: string; author: string; voice: string; language: string; cover?: Blob; parts: AudioPart[]; savedAt?: string };
export type ListeningPosition = { key: string; owner: string; part: number; seconds: number; updatedAt: string; dirty: boolean };
export type Trip = { owner: string; keys: string[]; current?: string };
const NAME = 'spl-offline-audio-v1';
export function audioKey(owner: string, bookId: string, language: string, voice: string) { return [owner, bookId, language, voice].join('/'); }
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      for (const [name, keyPath] of [['books','key'],['positions','key'],['trips','owner']]) request.result.createObjectStore(name, { keyPath });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(store: string, mode: IDBTransactionMode, operation: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode); const req = operation(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? req.error ?? new Error('LOCAL_STORAGE_FAILED')); };
  });
}
export async function listLocalBooks(owner: string) { return (await transaction<OfflineBook[]>('books','readonly',s=>s.getAll())).filter(b=>b.owner===owner); }
export async function getLocalBook(owner: string, key: string) { const b = await transaction<OfflineBook | undefined>('books','readonly',s=>s.get(key)); return b?.owner===owner ? b : undefined; }
export function sameAudio(a: OfflineBook, b: OfflineBook) { return a.parts.length===b.parts.length && a.parts.every((p,i)=>p.id===b.parts[i].id && p.version===b.parts[i].version && p.path===b.parts[i].path); }
export function complete(b: OfflineBook) { return b.parts.length>0 && b.parts.every((p,i)=>p.number===i+1 && p.blob instanceof Blob && p.blob.size>0); }
export async function saveLocalBook(b: OfflineBook) { if (!complete(b)) throw new Error('INCOMPLETE_AUDIO'); await transaction('books','readwrite',s=>s.put({...b,savedAt:new Date().toISOString()})); }
export async function deleteLocalBook(owner: string,key: string) { if (await getLocalBook(owner,key)) await transaction('books','readwrite',s=>s.delete(key)); }
export async function getTrip(owner: string): Promise<Trip> { return await transaction<Trip | undefined>('trips','readonly',s=>s.get(owner)) ?? {owner,keys:[]}; }
export async function saveTrip(trip: Trip) { if(trip.keys.some(k=>!k.startsWith(trip.owner+'/'))) throw new Error('OWNER_MISMATCH'); await transaction('trips','readwrite',s=>s.put(trip)); }
export async function positions(owner: string) { return (await transaction<ListeningPosition[]>('positions','readonly',s=>s.getAll())).filter(p=>p.owner===owner); }
export async function savePosition(p: ListeningPosition) { if(!p.key.startsWith(p.owner+'/')) throw new Error('OWNER_MISMATCH'); await transaction('positions','readwrite',s=>s.put(p)); }

export function nextTrack(current: {key:string;part:number}, books: Pick<OfflineBook,'key'|'parts'>[], queue:string[]) {
 const book=books.find(b=>b.key===current.key); if(!book)return null;
 if(current.part+1<book.parts.length)return {key:current.key,part:current.part+1};
 const at=queue.indexOf(current.key);return at>=0&&at+1<queue.length?{key:queue[at+1],part:0}:null;
}
