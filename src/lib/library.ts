import { ensurePilotSession, supabase } from "./supabase";
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
  created_at: string;
};

function safeName(name: string) {
  const extension = name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || "pdf";
  return `book.${extension}`;
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
    ? "id,title,file_name,file_size,storage_path,source_language,output_language,status,content_sha256,created_at"
    : "id,title,file_name,file_size,storage_path,source_language,output_language,status,created_at";
  const { data, error } = await supabase!
    .from("spl_books")
    .select(columns)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<Omit<PilotBook, "content_sha256"> & { content_sha256?: string | null }>
  ).map((row) => ({ ...row, content_sha256: row.content_sha256 ?? null }));
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
  const session = await ensurePilotSession();
  const hasHash = await checkHashColumnAvailable();

  let contentHash: string | null = null;
  if (hasHash) {
    try {
      contentHash = await hashFile(file);
      const { data: existing, error: lookupError } = await supabase!
        .from("spl_books")
        .select("id,title,file_name,file_size,storage_path,source_language,output_language,status,content_sha256,created_at")
        .eq("content_sha256", contentHash)
        .limit(1)
        .maybeSingle();
      if (!lookupError && existing) {
        return { book: existing as PilotBook, deduped: true };
      }
    } catch (hashOrLookupError) {
      // Never block an upload because the dedupe check itself failed (e.g. a
      // browser without SubtleCrypto in an insecure context, or a transient
      // network error). Fall through to a normal upload.
      console.warn("SPL: duplicate-check skipped", hashOrLookupError);
      contentHash = null;
    }
  }

  const bookId = crypto.randomUUID();
  const storagePath = `${session.user.id}/${bookId}/${safeName(file.name)}`;
  const { error: uploadError } = await supabase!.storage
    .from("spl-books")
    .upload(storagePath, file, { contentType: file.type || "application/pdf", upsert: false });
  if (uploadError) throw uploadError;

  const insertPayload: Record<string, unknown> = {
    id: bookId,
    user_id: session.user.id,
    title: file.name.replace(/\.(pdf|epub)$/i, ""),
    file_name: file.name,
    mime_type: file.type || "application/pdf",
    file_size: file.size,
    storage_path: storagePath,
    output_language: outputLanguage,
    status: "uploaded",
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
    policy_version: "V0.7-zero-cost-pilot",
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

// ZERO_COST_MODE gates whether this is ever called from the UI (see src/lib/config.ts
// and scripts/verify-zero-cost.mjs) — the function itself is kept intact so the paid
// path can be re-enabled later without rewriting this module.
export async function invokeBookAI(bookId: string, action: "process" | "ask" | "audio", payload: Record<string, unknown> = {}) {
  await ensurePilotSession();
  const { data, error } = await supabase!.functions.invoke("spl-ai", {
    body: { action, bookId, ...payload },
  });
  if (error) throw error;
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

export async function getBookResults(bookId: string) {
  await ensurePilotSession();
  const [{ data: analyses, error: analysesError }, { data: audio, error: audioError }] = await Promise.all([
    supabase!
      .from("spl_analyses")
      .select("kind,language,source,content,template_version,created_at")
      .eq("book_id", bookId),
    supabase!.from("spl_audio_outputs").select("id,language,voice,storage_path,created_at").eq("book_id", bookId),
  ]);
  if (analysesError) throw analysesError;
  if (audioError) throw audioError;
  return { analyses: (analyses ?? []) as StoredAnalysis[], audio: audio ?? [] };
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
