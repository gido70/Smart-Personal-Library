import { useEffect, useRef, type MutableRefObject } from "react";
import type { PageFlip } from "page-flip/dist/js/page-flip.module.js";

export type ReaderPdf = {
  numPages: number;
  getPage(page: number): Promise<{
    getViewport(options: {scale: number}): {width: number; height: number};
    render(options: {canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: {width: number; height: number}}): {promise: Promise<void>; cancel(): void};
  }>;
};
export type FlipControls = { turn(delta: number): void };

/** PDF rendering stays local. PageFlip only handles the physical sheet geometry.
 * Eight nearby page rasters at most; all other elements are tiny placeholders.
 * React owns the host; PageFlip exclusively owns a disposable child. */
export default function PdfFlipBook({ pdf, page, rtl, spread, width, height, zoom, duration, enabled, controls, onPage, onBusy, onError, onTurn }: {
  pdf: ReaderPdf; page: number; rtl: boolean; spread: boolean; width: number; height: number; zoom: number; duration: number; enabled: boolean;
  controls: MutableRefObject<FlipControls | null>;
  onPage(page: number): void; onBusy(busy: boolean): void; onError(): void; onTurn(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<PageFlip | null>(null);
  const synchronize = useRef<((page: number) => Promise<void>) | null>(null);
  const callbacks = useRef({onPage,onBusy,onError,onTurn,enabled,page});
  callbacks.current = {onPage,onBusy,onError,onTurn,enabled,page};
  const reverse = !rtl; // User-selected forward gesture: Arabic right→left, English left→right.

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    let disposed = false;
    let request = 0;
    let ready = false;
    const tasks = new Set<{cancel(): void}>();
    const cached = new Map<number, HTMLCanvasElement>();
    const pending = new Map<number, Promise<void>>();
    const block = window.document.createElement("div");
    block.className = "pdf-flip-engine";
    root.append(block);
    const toIndex = (number: number) => reverse ? pdf.numPages - number : number - 1;
    const toPage = (index: number) => reverse ? pdf.numPages - index : index + 1;
    let flip: PageFlip | null = null;
    let elements: HTMLDivElement[] = [];

    const initialize = async () => {
      callbacks.current.onBusy(true);
      const [{PageFlip: Engine}, first] = await Promise.all([import("page-flip/dist/js/page-flip.module.js"), pdf.getPage(1)]);
      if (disposed) return;
      const natural = first.getViewport({scale:1});
      const pageWidth = Math.max(100, Math.min((width - 30) / (spread ? 2 : 1), (height - 30) * natural.width / natural.height)) * zoom;
      const pageHeight = pageWidth * natural.height / natural.width;
      block.style.width = `${pageWidth * (spread ? 2 : 1)}px`;
      block.style.height = `${pageHeight}px`;
      // PageFlip's portrait mode is selected from the host width. No CSS mirror:
      // reversing page indices also preserves real mouse/touch coordinates.
      elements = Array.from({length:pdf.numPages}, (_, index) => {
        const el = window.document.createElement("div");
        el.className = "pdf-flip-sheet";
        el.setAttribute("aria-label", `${rtl ? "صفحة" : "Page"} ${toPage(index)}`);
        const placeholder = window.document.createElement("span");
        placeholder.className = "pdf-page-placeholder";
        placeholder.textContent = rtl ? "جارٍ تجهيز الصفحة…" : "Preparing page…";
        el.append(placeholder);
        return el;
      });
      const renderOne = (number: number): Promise<void> => {
        if (cached.has(number)) return Promise.resolve();
        if (pending.has(number)) return pending.get(number)!;
        const job = (async () => {
          const pdfPage = await pdf.getPage(number);
          if (disposed) return;
          const naturalPage = pdfPage.getViewport({scale:1});
          const cssScale = Math.min(pageWidth / naturalPage.width, pageHeight / naturalPage.height);
          const cssWidth = naturalPage.width * cssScale, cssHeight = naturalPage.height * cssScale;
          const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2_000_000 / (cssWidth * cssHeight)));
          const viewport = pdfPage.getViewport({scale:cssScale * ratio});
          const canvas = window.document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
          const context = canvas.getContext("2d", {alpha:false});
          if (!context) throw new Error("No canvas");
          const task = pdfPage.render({canvas, canvasContext:context, viewport});
          tasks.add(task);
          try { await task.promise; } finally { tasks.delete(task); }
          if (disposed) { canvas.width = 0; return; }
          canvas.style.width = `${cssWidth}px`; canvas.style.height = `${cssHeight}px`;
          elements[toIndex(number)].replaceChildren(canvas);
          cached.set(number, canvas);
        })().finally(() => pending.delete(number));
        pending.set(number, job);
        return job;
      };
      const prepare = async (number: number) => {
        const index = toIndex(number);
        const needed = new Set<number>();
        for (let i = Math.max(0,index-3); i <= Math.min(pdf.numPages-1,index+4); i++) needed.add(toPage(i));
        for (const [n,canvas] of cached) {
          if (needed.has(n)) continue;
          canvas.width = 0; canvas.height = 0; canvas.remove(); cached.delete(n);
        }
        // Current spread first; bounded sequential neighbors avoid PDF worker floods.
        await renderOne(number);
        if (spread && index+1 < pdf.numPages) await renderOne(toPage(index+1));
        for (const n of needed) { if (disposed) return; await renderOne(n); }
      };
      await prepare(callbacks.current.page);
      if (disposed) return;
      flip = new Engine(block, {
        width:pageWidth, height:pageHeight, size:"fixed", usePortrait:!spread,
        autoSize:false, startPage:toIndex(callbacks.current.page), showCover:false,
        drawShadow:true, maxShadowOpacity:.25, flippingTime:duration,
        mobileScrollSupport:true, useMouseEvents:true, showPageCorners:true,
        clickEventForward:true, disableFlipByClick:true, swipeDistance:40,
      });
      flip.loadFromHTML(elements);
      engine.current = flip;
      ready = true;
      callbacks.current.onBusy(false);
      const sync = async (number: number, jump = true) => {
        const id = ++request;
        ready = false; callbacks.current.onBusy(true);
        await prepare(number);
        if (disposed || id !== request || !flip) return;
        if (jump) flip.turnToPage(toIndex(number));
        ready = true; callbacks.current.onBusy(false);
      };
      synchronize.current = sync;
      flip.on("flip", event => {
        if (disposed || !ready) return;
        const index = Number(event.data);
        const number = reverse && spread && index+1 < pdf.numPages ? toPage(index+1) : toPage(index);
        callbacks.current.onPage(number);
        callbacks.current.onTurn();
        void sync(number, false).catch(() => { if (!disposed) callbacks.current.onError(); });
      });
      controls.current = {turn(delta) {
        if (!ready || !callbacks.current.enabled || !flip || flip.getState() !== "read") return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const number = Math.min(pdf.numPages,Math.max(1,callbacks.current.page+delta*(spread?2:1)));
          void sync(number).then(() => {if(!disposed) callbacks.current.onPage(number);}).catch(() => callbacks.current.onError());
        } else if ((delta > 0) !== reverse) flip.flipNext("bottom");
        else flip.flipPrev("bottom");
      }};
      // Block touches while adjacent pages are being prepared, or before fidelity approval.
      const guard = (event: Event) => {
        if (!ready || !callbacks.current.enabled || zoom > 1) { event.stopImmediatePropagation(); }
      };
      block.addEventListener("mousedown",guard,true);
      block.addEventListener("touchstart",guard,true);
    };
    void initialize().catch(() => { if (!disposed) {callbacks.current.onBusy(false);callbacks.current.onError();} });
    return () => {
      disposed = true; request++;
      tasks.forEach(task=>task.cancel());
      controls.current = null; synchronize.current = null; engine.current = null;
      flip?.destroy(); block.remove();
      cached.forEach(canvas=>{canvas.width=0;canvas.height=0;}); cached.clear();
    };
  }, [pdf, width, height, spread, zoom, reverse, rtl, duration, controls]);

  useEffect(() => {
    const flip = engine.current;
    const target = reverse ? pdf.numPages - page : page - 1;
    if (!flip || flip.getCurrentPageIndex() === target || (spread && flip.getCurrentPageIndex()+1 === target)) return;
    void synchronize.current?.(page).catch(() => callbacks.current.onError());
  }, [page, reverse, pdf, spread]);

  return <div className="pdf-flip-host" ref={host} dir="ltr" />;
}
