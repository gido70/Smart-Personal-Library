import { ensurePilotSession, supabase } from "./supabase";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { hashFile } from "./textAnalysis";
import type { LocalStructuralAnalysis, ManualImportPayload, ManualImportSource } from "./textAnalysis";

export type OutputLanguage = "ar" | "en" | "bilingual";

export type PilotBook = {
  id: string;
  title: string;
  file_name: string;
  file_size: number;
  storage_path: string;
  source_language: "ar" | "en" | "mixed" | "unknown";
  output_language: OutputLanguage;
  status: "uploaded" | "processing" | "ready" | "failed";
  content_sha256: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  analysis_ready?: boolean;
};

export const MAX_ACTIVE_BOOKS = 6;
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

function safeName(name: string) {
  const extension = name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || "pdf";
  return `book.${extension}`;
}

async function inspectPdfForAcceptance(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true }).promise;
  if (document.numPages > 500) throw new Error("TOO_MANY_PAGES_500");
  let info: Record<string, unknown> = {};
  try { info = ((await document.getMetadata()).info as Record<string, unknown>) ?? {}; } catch { /* optional metadata */ }
  return { pageCount: document.numPages, info };
}

/**
 * True once we've confirmed the `content_sha256` column exists on spl_books.
 * Stays `null` (unknown) until the first real check, so we only pay the extra
 * query once per page load instead of once per upload.
 */
let hashColumnAvailable: boolean | null = null;

function isMissingColumnError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? error ?? "");
  // Postgres/PostgREST report an unknown column as 42703, or PostgREST's own
  // "column ... does not exist" text depending on the failure point.
  const code = (error as { code?: string } | null)?.code;
  return code === "42703" || /column .*does not exist/i.test(message) || /content_sha256/.test(message);
}

async function checkHashColumnAvailable(): Promise<boolean> {
  if (hashColumnAvailable !== null) return hashColumnAvailable;
  const { error } = await supabase!.from("spl_books").select("content_sha256").limit(1);
  hashColumnAvailable = !error || !isMissingColumnError(error);
  return hashColumnAvailable;
}

export async function listPilotBooks(): Promise<PilotBook[]> {
  await ensurePilotSession();
  const hasHash = await checkHashColumnAvailable();
  const columns = hasHash
    ? "id,title,file_name,file_size,storage_path,source_language,output_language,status,content_sha256,metadata,created_at"
    : "id,title,file_name,file_size,storage_path,source_language,output_language,status,metadata,created_at";
  const [{ data, error }, { data: analysed, error: analysedError }] = await Promise.all([
    supabase!.from("spl_books").select(columns).order("created_at", { ascending: false }),
    supabase!.from("spl_analyses").select("book_id,content").eq("kind", "overview").eq("source", "openai"),
  ]);
  if (error) throw error;
  // The analysis marker is additive. Older databases may not yet have the
  // `source` column, so the library still opens and simply falls back to the
  // book status until the existing V0.7 migration is present.
  const analysedIds = new Set(analysedError ? [] : (analysed ?? []).map((item) => item.book_id));
  const catalogMetadata = new Map<string, Record<string, unknown>>();
  if (!analysedError) {
    for (const item of analysed ?? []) {
      const content = item.content as Record<string, unknown> | null;
      const metadata = content?.metadata;
      if (metadata && typeof metadata === "object") catalogMetadata.set(item.book_id, metadata as Record<string, unknown>);
    }
  }
  return ((data ?? []) as unknown as Array<Omit<PilotBook, "content_sha256"> & { content_sha256?: string | null }>).map((row) => ({
    ...row,
    content_sha256: row.content_sha256 ?? null,
    // AI-extracted catalogue fields are useful defaults, but a librarian's
    // explicit corrections saved on the book must always win.
    metadata: { ...(catalogMetadata.get(row.id) ?? {}), ...(row.metadata ?? {}) },
    analysis_ready: analysedIds.has(row.id) || row.status === "ready",
  }));
}

export function isBookArchived(book: Pick<PilotBook, "metadata">) {
  return Boolean(book.metadata?.archived_at);
}

export type LibraryStats = { analysedBooks: number; questions: number; audioParts: number };

export async function getLibraryStats(): Promise<LibraryStats> {
  await ensurePilotSession();
  const [analysesResult, questionsResult, audioResult] = await Promise.all([
    supabase!.from("spl_analyses").select("book_id").eq("kind", "overview").eq("source", "openai"),
    supabase!.from("spl_questions").select("id", { count: "exact", head: true }),
    supabase!.from("spl_audio_outputs").select("id", { count: "exact", head: true }),
  ]);
  if (analysesResult.error) throw analysesResult.error;
  if (questionsResult.error) throw questionsResult.error;
  if (audioResult.error) throw audioResult.error;
  return {
    analysedBooks: new Set((analysesResult.data ?? []).map((item) => item.book_id)).size,
    questions: questionsResult.count ?? 0,
    audioParts: audioResult.count ?? 0,
  };
}

export type UploadResult = { book: PilotBook; deduped: boolean };

/**
 * Uploads a book exactly once per distinct file content for a given user.
 * Computes a SHA-256 of the file in the browser first; if a book with the same
 * hash already exists for this user (RLS already scopes the lookup to them),
 * that existing record is returned instead of creating a duplicate upload.
 *
 * Safe to call before the V0.7 migration is applied: if `content_sha256` is not
 * yet a column on spl_books, dedupe is silently skipped (old upload behaviour)
 * rather than throwing, so this ships without requiring the migration first.
 */
export async function uploadPilotBook(file: File, outputLanguage: OutputLanguage): Promise<UploadResult> {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) throw new Error("PDF_ONLY");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("FILE_TOO_LARGE_30MB");
  const inspection = await inspectPdfForAcceptance(file);
  const session = await ensurePilotSession();
  const hasHash = await checkHashColumnAvailable();

  let contentHash: string | null = null;
  if (hasHash) {
    try {
      contentHash = await hashFile(file);
      const { data: existing, error: lookupError } = await supabase!
        .from("spl_books")
        .select("id,title,file_name,file_size,storage_path,source_language,output_language,status,content_sha256,metadata,created_at")
        .eq("content_sha256", contentHash)
        .limit(1)
        .maybeSingle();
      if (!lookupError && existing) {
        const existingBook = existing as PilotBook;
        if (isBookArchived(existingBook)) {
          const { data: activeRows, error: activeError } = await supabase!
            .from("spl_books")
            .select("id,metadata");
          if (activeError) throw activeError;
          const activeCount = (activeRows ?? []).filter((item) => !item.metadata?.archived_at).length;
          if (activeCount >= MAX_ACTIVE_BOOKS) throw new Error("ACTIVE_BOOK_LIMIT_REACHED");
          const metadata = { ...(existingBook.metadata ?? {}) };
          if (metadata.original_removed) {
            const { error: restoreFileError } = await supabase!.storage
              .from("spl-books")
              .upload(existingBook.storage_path, file, { contentType: file.type || "application/pdf", upsert: true });
            if (restoreFileError) throw restoreFileError;
          }
          delete metadata.archived_at;
          delete metadata.archive_reason;
          delete metadata.original_removed;
          delete metadata.original_compaction_pending;
          const { data: restored, error: restoreError } = await supabase!
            .from("spl_books")
            .update({ metadata })
            .eq("id", existingBook.id)
            .select("id,title,file_name,file_size,storage_path,source_language,output_language,status,content_sha256,metadata,created_at")
            .single();
          if (restoreError) throw restoreError;
          return { book: restored as PilotBook, deduped: true };
        }
        return { book: existingBook, deduped: true };
      }
    } catch (hashOrLookupError) {
      // Never block an upload because the dedupe check itself failed (e.g. a
      // browser without SubtleCrypto in an insecure context, or a transient
      // network error). Fall through to a normal upload.
      console.warn("SPL: duplicate-check skipped", hashOrLookupError);
      contentHash = null;
    }
  }

  const { data: activeRows, error: activeError } = await supabase!.from("spl_books").select("id,metadata");
  if (activeError) throw activeError;
  const activeCount = (activeRows ?? []).filter((item) => !item.metadata?.archived_at).length;
  if (activeCount >= MAX_ACTIVE_BOOKS) throw new Error("ACTIVE_BOOK_LIMIT_REACHED");

  const bookId = crypto.randomUUID();
  const storagePath = `${session.user.id}/${bookId}/${safeName(file.name)}`;
  const { error: uploadError } = await supabase!.storage
    .from("spl-books")
    .upload(storagePath, file, { contentType: file.type || "application/pdf", upsert: false });
  if (uploadError) throw uploadError;

  const insertPayload: Record<string, unknown> = {
    id: bookId,
    user_id: session.user.id,
    title: (typeof inspection.info.Title === "string" && inspection.info.Title.trim())
      ? inspection.info.Title.trim()
      : file.name.replace(/\.(pdf|epub)$/i, ""),
    file_name: file.name,
    mime_type: file.type || "application/pdf",
    file_size: file.size,
    storage_path: storagePath,
    output_language: outputLanguage,
    status: "uploaded",
    metadata: {
      acceptance_profile: "pdf-text-500-pages",
      original_cover: "derived-from-page-1",
      page_count: inspection.pageCount,
      author: typeof inspection.info.Author === "string" ? inspection.info.Author : null,
    },
  };
  if (hasHash && contentHash) insertPayload.content_sha256 = contentHash;

  const { data: book, error: bookError } = await supabase!.from("spl_books").insert(insertPayload).select().single();
  if (bookError) {
    await supabase!.storage.from("spl-books").remove([storagePath]);
    throw bookError;
  }
  return { book: book as PilotBook, deduped: false };
}

export async function saveLegalConsent(bookId: string, rightsOwned: boolean, personalUse: boolean) {
  const session = await ensurePilotSession();
  if (!rightsOwned || !personalUse) throw new Error("LEGAL_CONSENT_REQUIRED");
  const { error } = await supabase!.from("spl_legal_consents").insert({
    user_id: session.user.id,
    book_id: bookId,
    rights_owned: rightsOwned,
    personal_use_only: personalUse,
    policy_version: "V0.9-private-paid-pilot",
    user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

export async function getLegalConsentStatus(bookId: string): Promise<{ recorded: boolean; acceptedAt: string | null }> {
  await ensurePilotSession();
  const { data, error } = await supabase!
    .from("spl_legal_consents")
    .select("accepted_at")
    .eq("book_id", bookId)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return { recorded: Boolean(data), acceptedAt: (data?.accepted_at as string | undefined) ?? null };
}

export async function rollbackPilotBook(book: Pick<PilotBook, "id" | "storage_path">) {
  await ensurePilotSession();
  const { error: deleteError } = await supabase!.from("spl_books").delete().eq("id", book.id);
  const { error: storageError } = await supabase!.storage.from("spl-books").remove([book.storage_path]);
  if (deleteError || storageError) throw deleteError ?? storageError;
}

/** Permanently deletes one owner-scoped book and its generated private files.
 * Database children are removed by the existing ON DELETE CASCADE constraints.
 * Paths are resolved before deleting the row so generated audio can also be
 * removed without ever widening the operation beyond this exact book folder.
 */
export async function deletePilotBook(book: Pick<PilotBook, "id" | "storage_path">) {
  const session = await ensurePilotSession();
  const expectedPrefix = `${session.user.id}/${book.id}/`;
  if (!book.storage_path.startsWith(expectedPrefix)) throw new Error("BOOK_DELETE_PATH_MISMATCH");

  const audioPaths: string[] = [];
  const { data: rootAudio, error: rootListError } = await supabase!.storage
    .from("spl-audio")
    .list(`${session.user.id}/${book.id}`, { limit: 1000 });
  if (rootListError) throw rootListError;
  for (const entry of rootAudio ?? []) {
    if (entry.id) audioPaths.push(`${expectedPrefix}${entry.name}`);
  }
  const { data: previews, error: previewListError } = await supabase!.storage
    .from("spl-audio")
    .list(`${session.user.id}/${book.id}/voice-previews`, { limit: 20 });
  if (previewListError) throw previewListError;
  for (const entry of previews ?? []) {
    if (entry.id) audioPaths.push(`${expectedPrefix}voice-previews/${entry.name}`);
  }

  const { error: deleteError } = await supabase!.from("spl_books").delete().eq("id", book.id);
  if (deleteError) throw deleteError;

  const cleanupErrors: string[] = [];
  const { error: bookStorageError } = await supabase!.storage.from("spl-books").remove([book.storage_path]);
  if (bookStorageError) cleanupErrors.push(bookStorageError.message);
  if (audioPaths.length) {
    const { error: audioStorageError } = await supabase!.storage.from("spl-audio").remove(audioPaths);
    if (audioStorageError) cleanupErrors.push(audioStorageError.message);
  }
  return { cleanupWarning: cleanupErrors.join("; ") || null };
}

export type BookClassificationPatch = {
  deweyMain: string;
  deweyBranch: string;
  modernTopic?: string;
};

export async function updateBookClassification(book: PilotBook, patch: BookClassificationPatch): Promise<PilotBook> {
  await ensurePilotSession();
  const metadata = {
    ...(book.metadata ?? {}),
    dewey_main: patch.deweyMain.trim().slice(0, 8),
    dewey_branch: patch.deweyBranch.trim().slice(0, 80),
    modern_topic: (patch.modernTopic ?? "").trim().slice(0, 80) || null,
  };
  const { data, error } = await supabase!
    .from("spl_books")
    .update({ metadata })
    .eq("id", book.id)
    .select("id,title,file_name,file_size,storage_path,source_language,output_language,status,content_sha256,metadata,created_at")
    .single();
  if (error) throw error;
  return data as PilotBook;
}

export type BookCatalogPatch = {
  title: string;
  author: string;
  publisher: string;
  publicationPlace: string;
  publicationYear: string;
  isbn: string;
  subject: string;
  pageCount: string;
};

export async function updateBookCatalogMetadata(book: PilotBook, patch: BookCatalogPatch): Promise<PilotBook> {
  await ensurePilotSession();
  const title = patch.title.trim().slice(0, 300) || book.title;
  const metadata = {
    ...(book.metadata ?? {}),
    author: patch.author.trim().slice(0, 300) || null,
    publisher: patch.publisher.trim().slice(0, 300) || null,
    publication_place: patch.publicationPlace.trim().slice(0, 200) || null,
    publication_year: patch.publicationYear.trim().slice(0, 30) || null,
    isbn: patch.isbn.trim().slice(0, 40) || null,
    subject: patch.subject.trim().slice(0, 400) || null,
    page_count: patch.pageCount.trim().slice(0, 20) || null,
    catalog_corrected_at: new Date().toISOString(),
  };
  const { data, error } = await supabase!
    .from("spl_books")
    .update({ title, metadata })
    .eq("id", book.id)
    .select("id,title,file_name,file_size,storage_path,source_language,output_language,status,content_sha256,metadata,created_at")
    .single();
  if (error) throw error;
  return data as PilotBook;
}

/**
 * Frees one of the six active-library slots without deleting the record,
 * generated summaries, audio, questions, reminders, or payment history.
 * A small cover is retained, then the original PDF is compacted only after
 * the archive metadata is safely stored. Re-uploading the same file hash
 * restores this record without duplicating paid outputs.
 */
export async function archivePilotBook(book: PilotBook): Promise<PilotBook> {
  const session = await ensurePilotSession();
  const expectedPrefix = `${session.user.id}/${book.id}/`;
  if (!book.storage_path.startsWith(expectedPrefix)) throw new Error("BOOK_ARCHIVE_PATH_MISMATCH");
  let coverPath = String(book.metadata?.archive_cover_path ?? "");
  if (!coverPath) {
    try {
      const { data: pdfBlob, error: downloadError } = await supabase!.storage.from("spl-books").download(book.storage_path);
      if (downloadError || !pdfBlob) throw downloadError ?? new Error("BOOK_DOWNLOAD_FAILED");
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await pdfBlob.arrayBuffer()), disableFontFace: true }).promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.max(0.4, Math.min(1.15, 420 / base.width)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("COVER_CANVAS_UNAVAILABLE");
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const coverBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("COVER_EXPORT_FAILED")), "image/jpeg", 0.82));
      coverPath = `${expectedPrefix}archive-cover.jpg`;
      const { error: coverError } = await supabase!.storage.from("spl-books").upload(coverPath, coverBlob, { contentType: "image/jpeg", upsert: true });
      if (coverError) throw coverError;
    } catch (coverError) {
      // Archiving must remain possible even when an unusual PDF cannot render
      // a thumbnail; the title-based cover is the safe visual fallback.
      console.warn("SPL: archive cover fallback", coverError);
      coverPath = "";
    }
  }
  const metadata = {
    ...(book.metadata ?? {}),
    archived_at: new Date().toISOString(),
    archive_reason: "active_shelf_limit",
    archive_cover_path: coverPath || null,
    original_compaction_pending: true,
  };
  const { data, error } = await supabase!
    .from("spl_books")
    .update({ metadata })
    .eq("id", book.id)
    .select("id,title,file_name,file_size,storage_path,source_language,output_language,status,content_sha256,metadata,created_at")
    .single();
  if (error) throw error;
  const { error: removeError } = await supabase!.storage.from("spl-books").remove([book.storage_path]);
  if (removeError) {
    console.warn("SPL: original compaction deferred", removeError);
    return data as PilotBook;
  }
  const compactedMetadata = { ...metadata, original_removed: true, original_compaction_pending: false };
  const { data: compacted, error: compactedError } = await supabase!
    .from("spl_books")
    .update({ metadata: compactedMetadata })
    .eq("id", book.id)
    .select("id,title,file_name,file_size,storage_path,source_language,output_language,status,content_sha256,metadata,created_at")
    .single();
  if (compactedError) {
    console.warn("SPL: archive compaction marker deferred", compactedError);
    return data as PilotBook;
  }
  return compacted as PilotBook;
}

export async function restoreArchivedBook(book: PilotBook): Promise<PilotBook> {
  await ensurePilotSession();
  if (book.metadata?.original_removed) throw new Error("ARCHIVED_ORIGINAL_REUPLOAD_REQUIRED");
  const { data: activeRows, error: activeError } = await supabase!.from("spl_books").select("id,metadata");
  if (activeError) throw activeError;
  if ((activeRows ?? []).filter((item) => !item.metadata?.archived_at).length >= MAX_ACTIVE_BOOKS) {
    throw new Error("ACTIVE_BOOK_LIMIT_REACHED");
  }
  const metadata = { ...(book.metadata ?? {}) };
  delete metadata.archived_at;
  delete metadata.archive_reason;
  const { data, error } = await supabase!
    .from("spl_books")
    .update({ metadata })
    .eq("id", book.id)
    .select("id,title,file_name,file_size,storage_path,source_language,output_language,status,content_sha256,metadata,created_at")
    .single();
  if (error) throw error;
  return data as PilotBook;
}

export type AiLimitsSnapshot = {
  analysesToday: number;
  analysisLimit: number;
  questionsToday: number;
  dailyQuestionLimit: number;
  questionsTotal: number;
  totalQuestionLimit: number;
  resetsAt: string;
};

export async function getAiLimitsSnapshot(): Promise<AiLimitsSnapshot> {
  await ensurePilotSession();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const nextReset = new Date(dayStart);
  nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  const [analysesResult, questionsTodayResult, questionsTotalResult] = await Promise.all([
    supabase!.from("spl_analyses").select("book_id").eq("kind", "overview").eq("source", "openai").gte("created_at", dayStart.toISOString()),
    supabase!.from("spl_questions").select("id", { count: "exact", head: true }).gte("created_at", dayStart.toISOString()),
    supabase!.from("spl_questions").select("id", { count: "exact", head: true }),
  ]);
  if (analysesResult.error) throw analysesResult.error;
  if (questionsTodayResult.error) throw questionsTodayResult.error;
  if (questionsTotalResult.error) throw questionsTotalResult.error;
  return {
    analysesToday: new Set((analysesResult.data ?? []).map((item) => item.book_id)).size,
    analysisLimit: 3,
    questionsToday: questionsTodayResult.count ?? 0,
    dailyQuestionLimit: 10,
    questionsTotal: questionsTotalResult.count ?? 0,
    totalQuestionLimit: 20,
    resetsAt: nextReset.toISOString(),
  };
}

export async function downloadBookFile(storagePath: string): Promise<Blob> {
  await ensurePilotSession();
  const { data, error } = await supabase!.storage.from("spl-books").download(storagePath);
  if (error || !data) throw error ?? new Error("BOOK_DOWNLOAD_FAILED");
  return data;
}

/**
 * A time-limited, owner-scoped URL to read a saved book directly from Supabase
 * Storage — this is what lets Reader open a saved book without asking the user
 * to re-pick the file from disk. RLS on storage.objects still applies to the
 * request that mints the URL; the URL itself is a bearer token for `expiresIn`
 * seconds, matching the pattern already used for private audio output.
 */
export async function createBookSignedUrl(storagePath: string, expiresIn = 3600): Promise<{ url: string; expiresAt: number }> {
  await ensurePilotSession();
  const { data, error } = await supabase!.storage.from("spl-books").createSignedUrl(storagePath, expiresIn);
  if (error) throw error;
  return { url: data.signedUrl, expiresAt: Date.now() + expiresIn * 1000 };
}

// V0.9 exposes these actions in the UI, but the Edge Function remains the
// authoritative financial boundary (enabled secret, exact pilot email, book
// and question caps, ownership, and legal-consent checks).
export async function invokeBookAI(bookId: string, action: "process" | "ask" | "audio" | "audio_preview", payload: Record<string, unknown> = {}) {
  await ensurePilotSession();
  const { data, error } = await supabase!.functions.invoke("spl-ai", {
    body: { action, bookId, ...payload },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = await context.clone().json() as { error?: string };
        if (body.error) throw new Error(body.error);
      } catch (parsed) {
        if (parsed instanceof Error && parsed.message !== "Unexpected end of JSON input") throw parsed;
      }
    }
    throw error;
  }
  return data;
}

export type StoredAnalysis = {
  kind: "overview" | "chapters" | "critical" | "metadata" | "local_structural" | "manual_import";
  language: "ar" | "en";
  source?: "openai" | "local_js" | "manual_chatgpt" | "manual_claude" | "manual_other";
  content: Record<string, unknown>;
  template_version?: string | null;
  created_at: string;
};

export type StoredQuestion = {
  id: string;
  question: string;
  answer: Record<string, unknown>;
  language: "ar" | "en";
  created_at: string;
};

export type AiUsageEvent = {
  action: "process" | "ask" | "audio" | "audio_preview";
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function getBookResults(bookId: string) {
  await ensurePilotSession();
  const [
    { data: analyses, error: analysesError },
    { data: audio, error: audioError },
    { data: questions, error: questionsError },
    { data: usage, error: usageError },
  ] = await Promise.all([
    supabase!
      .from("spl_analyses")
      .select("kind,language,source,content,template_version,created_at")
      .eq("book_id", bookId),
    supabase!.from("spl_audio_outputs").select("id,language,voice,storage_path,created_at").eq("book_id", bookId),
    supabase!.from("spl_questions").select("id,question,answer,language,created_at").eq("book_id", bookId).order("created_at", { ascending: false }).limit(20),
    supabase!.from("spl_ai_usage").select("action,model,input_tokens,output_tokens,metadata,created_at").eq("book_id", bookId).order("created_at", { ascending: false }),
  ]);
  if (analysesError) throw analysesError;
  if (audioError) throw audioError;
  if (questionsError) throw questionsError;
  // V0.9 migration is additive. Until it is applied, results still load and
  // the UI simply shows no usage history instead of hiding the book.
  const safeUsage = usageError ? [] : (usage ?? []);
  return {
    analyses: (analyses ?? []) as StoredAnalysis[],
    audio: audio ?? [],
    questions: (questions ?? []) as StoredQuestion[],
    usage: safeUsage as AiUsageEvent[],
  };
}

export async function getPrivateAudioUrl(storagePath: string) {
  await ensurePilotSession();
  const { data, error } = await supabase!.storage.from("spl-audio").createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Zero-cost local structural analysis (kind = "local_structural", source = "local_js")
// ---------------------------------------------------------------------------

/**
 * Persists the output of the free, on-device PDF.js structural pass. Uses
 * upsert on (book_id, kind, language) so re-running the analysis on the same
 * book replaces the previous local pass instead of erroring on the existing
 * uniqueness constraint.
 *
 * Requires the V0.7 migration (adds the "local_structural" kind and the
 * "source"/"template_version" columns to spl_analyses). If the migration has
 * not been applied yet, this throws a clear, typed error the UI can show
 * instead of a raw Postgres message.
 */
export async function saveLocalAnalysis(bookId: string, language: "ar" | "en", content: LocalStructuralAnalysis) {
  const session = await ensurePilotSession();
  const { error } = await supabase!.from("spl_analyses").upsert(
    {
      user_id: session.user.id,
      book_id: bookId,
      kind: "local_structural",
      language,
      source: "local_js",
      content,
      template_version: "local-structural-v1",
    },
    { onConflict: "book_id,kind,language" },
  );
  if (error) {
    if (isMissingColumnError(error) || /violates check constraint/i.test(String(error.message))) {
      throw new Error(
        "MIGRATION_REQUIRED: spl_analyses needs the V0.7 migration (local_structural kind + source/template_version columns) before this can be saved.",
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Manual (pasted from ChatGPT/Claude) import (kind = "manual_import")
// ---------------------------------------------------------------------------

export async function saveManualImport(bookId: string, payload: ManualImportPayload) {
  const session = await ensurePilotSession();
  const language: "ar" | "en" = payload.output_language === "en" ? "en" : "ar";
  const { error } = await supabase!.from("spl_analyses").upsert(
    {
      user_id: session.user.id,
      book_id: bookId,
      kind: "manual_import",
      language,
      source: payload.source as ManualImportSource,
      content: payload,
      template_version: payload.template_version,
    },
    { onConflict: "book_id,kind,language" },
  );
  if (error) {
    if (isMissingColumnError(error) || /violates check constraint/i.test(String(error.message))) {
      throw new Error(
        "MIGRATION_REQUIRED: spl_analyses needs the V0.7 migration (manual_import kind + source/template_version columns) before this can be saved.",
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reading progress for saved (Supabase-backed) books — replaces the localStorage
// key-by-filename scheme, which only worked for temporary local reads.
// ---------------------------------------------------------------------------

export async function getReadingProgress(bookId: string): Promise<{ page: number; bookmarks: number[] } | null> {
  const session = await ensurePilotSession();
  const { data, error } = await supabase!
    .from("spl_reading_progress")
    .select("page,bookmarks")
    .eq("book_id", bookId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { page: data.page as number, bookmarks: (data.bookmarks as number[]) ?? [] };
}

export async function saveReadingProgress(bookId: string, page: number, bookmarks: number[]) {
  const session = await ensurePilotSession();
  const { error } = await supabase!
    .from("spl_reading_progress")
    .upsert({ user_id: session.user.id, book_id: bookId, page, bookmarks }, { onConflict: "user_id,book_id" });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Feedback (spl_feedback table existed in the schema but no code ever wrote to it)
// ---------------------------------------------------------------------------

export async function saveFeedback(feature: string, rating: number | null, note: string, bookId?: string) {
  const session = await ensurePilotSession();
  const { error } = await supabase!.from("spl_feedback").insert({
    user_id: session.user.id,
    book_id: bookId ?? null,
    feature,
    rating,
    note: note.trim() || null,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Real-book metadata backfill from the free local analysis (fixes bug ب/ج:
// uploaded books permanently showing "UNKNOWN" because nothing in the free
// path ever wrote a detected language back to spl_books — only the now-
// locked paid Edge Function did). Conservative on purpose: never overwrites
// a language the user/paid path already established, never overwrites a
// title with something worse, and never touches the existing metadata jsonb
// column so it cannot clobber anything the paid path may have written there.
// ---------------------------------------------------------------------------

export async function backfillBookMetadataFromLocalAnalysis(
  book: Pick<PilotBook, "id" | "title" | "source_language">,
  analysis: LocalStructuralAnalysis,
): Promise<Partial<PilotBook>> {
  await ensurePilotSession();
  const patch: Record<string, unknown> = {};
  if (book.source_language === "unknown" && analysis.detected_language !== "unknown") {
    patch.source_language = analysis.detected_language;
  }
  const pdfTitle = typeof analysis.pdf_metadata?.Title === "string" ? (analysis.pdf_metadata.Title as string).trim() : "";
  if (pdfTitle.length >= 2 && pdfTitle.length <= 180 && pdfTitle !== book.title) {
    patch.title = pdfTitle;
  }
  if (Object.keys(patch).length === 0) return {};
  const { data, error } = await supabase!.from("spl_books").update(patch).eq("id", book.id).select().maybeSingle();
  if (error) {
    // Never block the local-analysis result on this best-effort backfill.
    console.warn("SPL: book metadata backfill skipped", error);
    return {};
  }
  return (data as Partial<PilotBook>) ?? {};
}

// ---------------------------------------------------------------------------
// Safe duplicate review (CLAUDE-REVIEW-PROMPT.md §3): never deletes
// anything automatically. Groups the user's own books (RLS already scopes
// listPilotBooks() to them) by content_sha256 when present — a real,
// content-based match — and, only as a secondary, clearly-labelled
// "unconfirmed" grouping, by normalized title + exact file size for older
// rows uploaded before the hash column existed. Deletion of any row still
// requires an explicit per-row click from the review screen
// (rollbackPilotBook), never happens here.
// ---------------------------------------------------------------------------

export type DuplicateGroup = {
  key: string;
  confirmed: boolean; // true = matched by real content hash; false = title+size heuristic only
  books: PilotBook[];
};

function normalizeTitleForGrouping(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function groupDuplicateBooks(books: PilotBook[]): DuplicateGroup[] {
  const byHash = new Map<string, PilotBook[]>();
  const unhashed: PilotBook[] = [];
  for (const book of books) {
    if (book.content_sha256) {
      const list = byHash.get(book.content_sha256) ?? [];
      list.push(book);
      byHash.set(book.content_sha256, list);
    } else {
      unhashed.push(book);
    }
  }
  const groups: DuplicateGroup[] = [];
  for (const [hash, list] of byHash) {
    if (list.length > 1) groups.push({ key: `hash:${hash}`, confirmed: true, books: list });
  }
  const byHeuristic = new Map<string, PilotBook[]>();
  for (const book of unhashed) {
    const key = `${normalizeTitleForGrouping(book.title)}::${book.file_size}`;
    const list = byHeuristic.get(key) ?? [];
    list.push(book);
    byHeuristic.set(key, list);
  }
  for (const [key, list] of byHeuristic) {
    if (list.length > 1) groups.push({ key: `heuristic:${key}`, confirmed: false, books: list });
  }
  return groups.sort((a, b) => b.books.length - a.books.length);
}
