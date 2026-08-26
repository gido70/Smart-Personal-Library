// V0.7.3 fix — root cause of the confirmed iPhone/Safari failures in
// FAILURE-EVIDENCE.md (local-analysis crash "undefined is not a function
// (near '...e of t...')" and the free-audio "تعذر استخراج نص هذه الصفحة"
// message). Both code paths call into pdfjs-dist (document.getPage /
// page.getTextContent), and pdfjs-dist 5.x unconditionally calls the
// ES2024 static method `Promise.withResolvers()` deep inside its internal
// deferred-promise helper — confirmed by grepping the installed bundle:
//   node_modules/pdfjs-dist/build/pdf.mjs            → 26 occurrences
//   node_modules/pdfjs-dist/build/pdf.worker.min.mjs → 3 occurrences
//   node_modules/pdfjs-dist/legacy/build/pdf.mjs      → 29 occurrences
// The "legacy" build is about DOM/runtime API shims, not ES-syntax
// downleveling, so switching to it would not have helped either.
//
// Promise.withResolvers shipped in Safari 17.4 (March 2024). Any iPhone on
// an older iOS/Safari version has `Promise.withResolvers === undefined`,
// so the very first pdfjs-dist call throws a TypeError that reads exactly
// like the evidence: "undefined is not a function" with a mangled stack
// frame (WebKit minifies the property-access snippet in its message,
// which is why the evidence shows "near '...e of t...'" instead of a
// clean function name).
//
// This is a minimal, spec-compliant, zero-dependency, zero-cost polyfill
// (identical in shape to the TC39 proposal's reference implementation). It
// must run before ANY dynamic `import("pdfjs-dist")`, so it is imported as
// the very first statement in main.tsx, before React itself.
//
// tsconfig's `lib` targets ES2022 (not ES2024), so PromiseConstructor has
// no built-in `withResolvers` declaration — augment the ambient type
// instead of bumping `lib` project-wide, which would silently opt every
// file into other newer-runtime typings this codebase never audited for
// Safari/WebKit support.
declare global {
  interface PromiseConstructor {
    withResolvers<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void };
  }
}

if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
