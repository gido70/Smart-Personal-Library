declare module "page-flip/dist/js/page-flip.module.js" {
  export class PageFlip {
    constructor(element: HTMLElement, settings: Record<string, unknown>);
    loadFromHTML(items: HTMLElement[]): void;
    turnToPage(index: number): void;
    flipNext(corner?: "top" | "bottom"): void;
    flipPrev(corner?: "top" | "bottom"): void;
    getCurrentPageIndex(): number;
    getState(): string;
    on(event: string, callback: (event: { data: number | string }) => void): void;
    destroy(): void;
  }
}
