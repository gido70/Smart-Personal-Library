import { useEffect, useRef, useState } from "react";
import type { ReaderPdf } from "./PdfFlipBook";

/** Continuous original pages. Only visible sheets and neighbours retain rasters. */
export default function PdfScrollReader({pdf, page, zoom, rtl, onPage, onError}: {
  pdf: ReaderPdf; page: number; zoom: number; rtl: boolean;
  onPage(page: number): void; onError(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const lastReported = useRef(page);
  const target = useRef(page);
  const callbacks = useRef({onPage,onError});
  callbacks.current = {onPage,onError};
  const [width,setWidth] = useState(600);
  const [ratio,setRatio] = useState(1.414);
  const [near,setNear] = useState<Set<number>>(() => new Set([page-1,page,page+1]));
  const sheetWidth = Math.max(160, Math.min(width-24, 1000)) * zoom;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    let active = true;
    void pdf.getPage(1).then(p => { if(active) {const v=p.getViewport({scale:1});setRatio(v.height/v.width);} }).catch(() => callbacks.current.onError());
    return () => {active=false;ro.disconnect();};
  },[pdf]);
  // Reposition once after fitting/rotation, or on an explicit jump. Scrolling
  // reports a page without feeding back another programmatic scroll.
  useEffect(() => {
    const el=root.current;
    if (!el) return;
    const sheet=el.querySelector<HTMLElement>(`[data-page="${target.current}"]`);
    if(sheet) el.scrollTop=sheet.offsetTop;
  },[sheetWidth,ratio]);
  useEffect(() => {
    target.current=page;
    if (lastReported.current===page) return;
    lastReported.current=page;
    const el=root.current;
    const sheet=el?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if(el && sheet) el.scrollTop=sheet.offsetTop;
  },[page]);
  useEffect(() => {
    const el=root.current;
    if(!el) return;
    const nearby=new Set<number>();
    const io=new IntersectionObserver(entries => {
      for(const entry of entries) {
        const n=Number((entry.target as HTMLElement).dataset.page);
        if(entry.isIntersecting) nearby.add(n);else nearby.delete(n);
      }
      setNear(new Set(nearby));
    },{root:el,rootMargin:"100% 0px"});
    el.querySelectorAll('[data-page]').forEach(sheet=>io.observe(sheet));
    return()=>io.disconnect();
  },[pdf]);
  const track=()=>{
    const el=root.current;
    if(!el) return;
    const anchor=el.scrollTop+Math.min(80,el.clientHeight*.15);
    const sheets=Array.from(el.querySelectorAll<HTMLElement>('[data-page]'));
    const current=sheets.find(sheet=>sheet.offsetTop+sheet.offsetHeight>anchor) ?? sheets[sheets.length-1];
    const number=Number(current?.dataset.page);
    if(number && number!==lastReported.current) {
      lastReported.current=number;target.current=number;callbacks.current.onPage(number);
    }
  };
  return <div className="pdf-continuous" ref={root} onScroll={track} tabIndex={0} role="region" aria-label={rtl?"صفحات PDF بالتمرير الرأسي":"Vertically scrolling PDF pages"}>
    {Array.from({length:pdf.numPages},(_,i)=>i+1).map(number=><div className="pdf-scroll-sheet" data-page={number} key={number} style={{width:sheetWidth,height:sheetWidth*ratio}}>
      {near.has(number) ? <Sheet pdf={pdf} number={number} width={sheetWidth} height={sheetWidth*ratio} onError={()=>callbacks.current.onError()}/> : null}
      <span className="pdf-scroll-number">{rtl?"صفحة":"Page"} {number}</span>
    </div>)}
  </div>;
}
function Sheet({pdf,number,width,height,onError}:{pdf:ReaderPdf;number:number;width:number;height:number;onError():void}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const fail=useRef(onError);fail.current=onError;
  useEffect(()=>{
    let disposed=false;
    let task:ReturnType<Awaited<ReturnType<ReaderPdf["getPage"]>>["render"]>|undefined;
    const surface=canvas.current!;
    void (async()=>{
      const page=await pdf.getPage(number);
      if(disposed)return;
      const natural=page.getViewport({scale:1});
      const fit=Math.min(width/natural.width,height/natural.height);
      const dpr=Math.min(window.devicePixelRatio||1,2,Math.sqrt(2_000_000/(width*height)));
      const view=page.getViewport({scale:fit*dpr});
      surface.width=Math.ceil(view.width);surface.height=Math.ceil(view.height);
      task=page.render({canvas:surface,canvasContext:surface.getContext('2d')!,viewport:view});
      await task.promise;
    })().catch(()=>{if(!disposed)fail.current();});
    return()=>{disposed=true;task?.cancel();surface.width=0;surface.height=0;};
  },[pdf,number,width,height]);
  return <canvas ref={canvas} aria-label={`PDF ${number}`}/>;
}
