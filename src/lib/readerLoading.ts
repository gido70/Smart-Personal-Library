/** Keep the original PDF on the server and request only ranges PDF.js needs.
 * PDF.js requires streaming off for disableAutoFetch to take effect. Servers
 * without range support still use PDF.js's normal full-response fallback. */
export const readerNetworkOptions = {
  disableStream: true,
  disableAutoFetch: true,
  rangeChunkSize: 262144,
};

/** Visible sheets first, then the next and previous physical spread only. */
export function readerPagePlan(page: number, count: number, reverse: boolean, spread: boolean) {
  const index = reverse ? count - page : page - 1;
  const size = spread ? 2 : 1;
  const start = Math.floor(index / size) * size;
  const pagesAt = (first: number) => Array.from({length:size}, (_,i)=>first+i)
    .filter(i=>i>=0 && i<count).map(i=>reverse ? count-i : i+1);
  const visible = pagesAt(start).sort((a,b)=>a===page?-1:b===page?1:0);
  const next = pagesAt(start + (reverse ? -size : size));
  const previous = pagesAt(start + (reverse ? size : -size));
  return {visible, nearby:[...next,...previous]};
}
