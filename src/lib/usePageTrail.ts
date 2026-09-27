import { useLayoutEffect, useRef, useState } from 'react';

// Session-only UI history. No browser history, account data or reader storage writes.
export function usePageTrail<T>(key: string, value: T, restore: (value: T) => void, scope: string | null) {
  const entries = useRef<Array<{ key: string; value: T; top: number }>>([]);
  const [depth, setDepth] = useState(0);
  const restoring = useRef(false);
  const currentScope = useRef(scope);
  useLayoutEffect(() => {
    if (currentScope.current !== scope || scope === null) {
      entries.current = [];
      currentScope.current = scope;
      restoring.current = false;
      setDepth(0);
    }
    if (scope === null) return;
    const current = entries.current.at(-1);
    if (current?.key === key) { current.value = value; return; }
    entries.current.push({ key, value, top: 0 });
    if (entries.current.length > 40) entries.current.shift();
    setDepth(entries.current.length - 1);
    if (current && !restoring.current) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [key, value, scope]);
  useLayoutEffect(() => {
    const save = () => {
      if (!restoring.current && entries.current.length) entries.current.at(-1)!.top = window.scrollY;
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, []);
  const back = () => {
    if (scope === null || currentScope.current !== scope || entries.current.length < 2 || restoring.current) return;
    entries.current.pop();
    const previous = entries.current.at(-1)!;
    restoring.current = true;
    restore(previous.value);
    setDepth(entries.current.length - 1);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: previous.top, behavior: 'instant' });
      restoring.current = false;
    }));
  };
  return { back, canBack: depth > 0 };
}
