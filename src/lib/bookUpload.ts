import { Upload } from "tus-js-client";

export type BookUploadStage = "checking" | "fingerprinting" | "uploading" | "saving";
export type BookUploadProgress = { stage: BookUploadStage; percent: number };

// Only use this for preparation/read operations. Network writes must be aborted,
// not merely raced against a timer (a timed-out write may still commit).
export async function boundedRead<T>(operation: PromiseLike<T>, code: string, ms = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(code)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function resumableEndpoint(baseUrl: string) {
  const url = new URL(baseUrl);
  // The direct Storage host is recommended for large files. Preserve custom
  // domains and local/self-hosted endpoints.
  if (/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) {
    url.hostname = url.hostname.replace(".supabase.co", ".storage.supabase.co");
  }
  return `${url.origin}/storage/v1/upload/resumable`;
}

export function uploadBookChunks(file: File, options: {
  baseUrl: string;
  storagePath: string;
  upsert: boolean;
  getAccessToken: () => Promise<string>;
  onProgress?: (progress: BookUploadProgress) => void;
  // Injectable solely to exercise stalled connections without waiting minutes.
  idleTimeoutMs?: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastBytes = -1;
    const stop = (code: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void upload.abort().catch(() => {});
      reject(new Error(code));
    };
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => stop("BOOK_UPLOAD_STALLED"), options.idleTimeoutMs ?? 180_000);
    };
    const upload = new Upload(file, {
      endpoint: resumableEndpoint(options.baseUrl),
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      uploadDataDuringCreation: true,
      // Resume transient interruptions within this attempt. Do not persist
      // private book names/paths in localStorage or reuse another account's URL.
      storeFingerprintForResuming: false,
      headers: { "x-upsert": String(options.upsert) },
      metadata: {
        bucketName: "spl-books",
        objectName: options.storagePath,
        contentType: "application/pdf",
        cacheControl: "3600",
      },
      onBeforeRequest: async (request) => {
        const token = await boundedRead(options.getAccessToken(), "BOOK_AUTH_TIMEOUT");
        if (settled) throw new Error("BOOK_UPLOAD_STOPPED");
        request.setHeader("Authorization", `Bearer ${token}`);
      },
      onAfterResponse: () => { if (!settled) touch(); },
      onProgress: (sent, total) => {
        if (settled) return;
        if (sent !== lastBytes) { lastBytes = sent; touch(); }
        options.onProgress?.({ stage: "uploading", percent: total ? Math.min(100, Math.floor(sent / total * 100)) : 0 });
      },
      onError: (error) => {
        // Do not display tus's raw error: it embeds request URLs/headers.
        const status = "originalResponse" in error
          ? (error.originalResponse as { getStatus(): number } | null)?.getStatus() : undefined;
        stop(status === 401 || status === 403 ? "BOOK_UPLOAD_AUTH"
          : status === 413 ? "FILE_TOO_LARGE_150MB" : "BOOK_UPLOAD_FAILED");
      },
      onSuccess: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.onProgress?.({ stage: "uploading", percent: 100 });
        resolve();
      },
    });
    touch();
    options.onProgress?.({ stage: "uploading", percent: 0 });
    try { upload.start(); } catch { stop("BOOK_UPLOAD_FAILED"); }
  });
}
