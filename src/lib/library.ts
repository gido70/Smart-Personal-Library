import { ensurePilotSession, supabase } from "./supabase";

export type OutputLanguage = "ar" | "en" | "bilingual";

export type PilotBook = {
  id: string;
  title: string;
  file_name: string;
  file_size: number;
  source_language: "ar" | "en" | "mixed" | "unknown";
  output_language: OutputLanguage;
  status: "uploaded" | "processing" | "ready" | "failed";
  created_at: string;
};

function safeName(name: string) {
  const extension = name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || "pdf";
  return `book.${extension}`;
}

export async function listPilotBooks(): Promise<PilotBook[]> {
  await ensurePilotSession();
  const { data, error } = await supabase!
    .from("spl_books")
    .select("id,title,file_name,file_size,source_language,output_language,status,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PilotBook[];
}

export async function uploadPilotBook(file: File, outputLanguage: OutputLanguage) {
  const session = await ensurePilotSession();
  const bookId = crypto.randomUUID();
  const storagePath = `${session.user.id}/${bookId}/${safeName(file.name)}`;
  const { error: uploadError } = await supabase!.storage
    .from("spl-books")
    .upload(storagePath, file, { contentType: file.type || "application/pdf", upsert: false });
  if (uploadError) throw uploadError;

  const { data: book, error: bookError } = await supabase!
    .from("spl_books")
    .insert({
      id: bookId,
      user_id: session.user.id,
      title: file.name.replace(/\.(pdf|epub)$/i, ""),
      file_name: file.name,
      mime_type: file.type || "application/pdf",
      file_size: file.size,
      storage_path: storagePath,
      output_language: outputLanguage,
      status: "uploaded",
    })
    .select()
    .single();
  if (bookError) {
    await supabase!.storage.from("spl-books").remove([storagePath]);
    throw bookError;
  }
  return book as PilotBook;
}

export async function saveLegalConsent(bookId: string, rightsOwned: boolean, personalUse: boolean) {
  const session = await ensurePilotSession();
  if (!rightsOwned || !personalUse) throw new Error("LEGAL_CONSENT_REQUIRED");
  const { error } = await supabase!.from("spl_legal_consents").insert({
    user_id: session.user.id,
    book_id: bookId,
    rights_owned: rightsOwned,
    personal_use_only: personalUse,
    policy_version: "V0.5-pilot",
    user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

export async function invokeBookAI(bookId: string, action: "process" | "ask" | "audio", payload: Record<string, unknown> = {}) {
  await ensurePilotSession();
  const { data, error } = await supabase!.functions.invoke("spl-ai", {
    body: { action, bookId, ...payload },
  });
  if (error) throw error;
  return data;
}

export async function getBookResults(bookId: string) {
  await ensurePilotSession();
  const [{ data: analyses, error: analysesError }, { data: audio, error: audioError }] = await Promise.all([
    supabase!.from("spl_analyses").select("kind,language,content,created_at").eq("book_id", bookId),
    supabase!.from("spl_audio_outputs").select("id,language,voice,storage_path,created_at").eq("book_id", bookId),
  ]);
  if (analysesError) throw analysesError;
  if (audioError) throw audioError;
  return { analyses: analyses ?? [], audio: audio ?? [] };
}

export async function getPrivateAudioUrl(storagePath: string) {
  await ensurePilotSession();
  const { data, error } = await supabase!.storage.from("spl-audio").createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}
