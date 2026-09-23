/** Coalesce a book shown in the hero, shelf and catalogue into one operation.
 * Only small JPEG blobs are retained, never original PDF bytes or signed URLs. */
export function createCoverCache(maxEntries = 24) {
  const ready = new Map<string, Blob>();
  const pending = new Map<string, Promise<Blob>>();
  const remember = (key: string, blob: Blob) => {
    if (blob.size > 2 * 1024 * 1024) return;
    ready.delete(key);
    ready.set(key, blob);
    while (ready.size > maxEntries) ready.delete(ready.keys().next().value!);
  };
  return {
    remember,
    async load(key: string, work: () => Promise<Blob>): Promise<Blob> {
      const cached = ready.get(key);
      if (cached) return cached;
      const existing = pending.get(key);
      if (existing) return existing;
      const task = Promise.resolve().then(work).then(blob => { remember(key, blob); return blob; }).finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    },
  };
}

// One PDF worker at a time; thumbnail downloads never enter this queue.
export function createPdfQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return async function run<T>(work: () => Promise<T>): Promise<T> {
    const task = tail.then(work, work);
    tail = task.catch(() => {});
    return task;
  };
}
