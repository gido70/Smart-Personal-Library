import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});

function stripFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

async function openAI(path: string, init: RequestInit) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY_MISSING");
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`OPENAI_${response.status}:${await response.text()}`);
  return response;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = request.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return json({ error: "UNAUTHENTICATED" }, 401);
    const body = await request.json();
    const { action, bookId } = body;
    const { data: book, error: bookError } = await supabase.from("spl_books").select("*").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "BOOK_NOT_FOUND" }, 404);
    if (book.user_id !== userData.user.id) return json({ error: "BOOK_FORBIDDEN" }, 403);
    const { data: consent } = await supabase.from("spl_legal_consents").select("id").eq("book_id", bookId).eq("user_id", userData.user.id).maybeSingle();
    if (!consent) return json({ error: "LEGAL_CONSENT_REQUIRED" }, 403);

    if (action === "process") {
      const { data: existingAnalysis } = await supabase.from("spl_analyses").select("content").eq("book_id", bookId).eq("kind", "overview").limit(1).maybeSingle();
      if (existingAnalysis) return json({ ok: true, reused: true, result: existingAnalysis.content });
      const dayStart = new Date();dayStart.setUTCHours(0,0,0,0);
      const { data: dailyAnalyses } = await supabase.from("spl_analyses").select("book_id").eq("user_id", userData.user.id).eq("kind", "overview").gte("created_at", dayStart.toISOString());
      if (new Set((dailyAnalyses ?? []).map(item => item.book_id)).size >= 3) return json({ error: "DAILY_ANALYSIS_LIMIT_REACHED", limit: 3 }, 429);
      await supabase.from("spl_books").update({ status: "processing", processing_error: null }).eq("id", bookId);
      let openaiFileId = book.openai_file_id as string | null;
      if (!openaiFileId) {
        const { data: file, error: downloadError } = await supabase.storage.from("spl-books").download(book.storage_path);
        if (downloadError || !file) throw downloadError ?? new Error("BOOK_DOWNLOAD_FAILED");
        const form = new FormData();
        form.append("purpose", "user_data");
        form.append("file", file, book.file_name);
        const uploaded = await openAI("files", { method: "POST", body: form });
        openaiFileId = (await uploaded.json()).id;
        await supabase.from("spl_books").update({ openai_file_id: openaiFileId }).eq("id", bookId);
      }

      const target = book.output_language === "bilingual" ? "Arabic and English" : book.output_language === "ar" ? "Arabic" : "English";
      const prompt = `Analyze this book for a private reading assistant. Detect whether the source is Arabic, English, or mixed. Produce output in ${target}. Do not reproduce the book verbatim. Return JSON only with keys: source_language (ar|en|mixed), metadata {title, author, subject, pages_if_known}, overview {summary, key_ideas, return_to_source}, chapters (array of {title, summary, pages_if_known}), critical {strengths, limitations, platform_inferences}, trust_notes. Make overview.summary an original 2200-2800 word script suitable for about 15-20 minutes of calm narration. Clearly distinguish source facts from platform inference.`;
      const generated = await openAI("responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: Deno.env.get("OPENAI_TEXT_MODEL") ?? "gpt-5.6",
          input: [{ role: "user", content: [{ type: "input_file", file_id: openaiFileId, detail: "low" }, { type: "input_text", text: prompt }] }],
        }),
      });
      const response = await generated.json();
      const outputText = response.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? []).map((item: { text?: string }) => item.text ?? "").join("") ?? "";
      const result = JSON.parse(stripFence(outputText));
      const languages = book.output_language === "bilingual" ? ["ar", "en"] : [book.output_language];
      for (const language of languages) {
        await supabase.from("spl_analyses").upsert({
          user_id: userData.user.id,
          book_id: bookId,
          kind: "overview",
          language,
          content: result,
          model: Deno.env.get("OPENAI_TEXT_MODEL") ?? "gpt-5.6",
        }, { onConflict: "book_id,kind,language" });
      }
      await supabase.from("spl_books").update({ source_language: result.source_language ?? "unknown", status: "ready", metadata: result.metadata ?? {} }).eq("id", bookId);
      return json({ ok: true, result });
    }

    if (action === "ask") {
      const question = String(body.question ?? "").trim();
      const language = body.language === "en" ? "en" : "ar";
      if (!question) return json({ error: "QUESTION_REQUIRED" }, 400);
      if (!book.openai_file_id) return json({ error: "BOOK_NOT_PROCESSED" }, 409);
      const dayStart = new Date();dayStart.setUTCHours(0,0,0,0);
      const { count: dailyQuestions } = await supabase.from("spl_questions").select("id", { count: "exact", head: true }).eq("user_id", userData.user.id).gte("created_at", dayStart.toISOString());
      if ((dailyQuestions ?? 0) >= 20) return json({ error: "DAILY_QUESTION_LIMIT_REACHED", limit: 20 }, 429);
      const prompt = `${language === "ar" ? "أجب بالعربية" : "Answer in English"}. Answer only from the uploaded book. If the book does not support the answer, say so. Distinguish quotations, paraphrases, and platform inference. Include page or chapter references when reliably available. Return JSON only: {answer, references:[{page,chapter,note}], confidence, inference}. Question: ${question}`;
      const generated = await openAI("responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: Deno.env.get("OPENAI_TEXT_MODEL") ?? "gpt-5.6", input: [{ role: "user", content: [{ type: "input_file", file_id: book.openai_file_id, detail: "low" }, { type: "input_text", text: prompt }] }] }),
      });
      const response = await generated.json();
      const outputText = response.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? []).map((item: { text?: string }) => item.text ?? "").join("") ?? "";
      const answer = JSON.parse(stripFence(outputText));
      await supabase.from("spl_questions").insert({ user_id: userData.user.id, book_id: bookId, question, answer, language, model: Deno.env.get("OPENAI_TEXT_MODEL") ?? "gpt-5.6" });
      return json({ ok: true, answer });
    }

    if (action === "audio") {
      const language = body.language === "en" ? "en" : "ar";
      const { data: existingAudio } = await supabase.from("spl_audio_outputs").select("id,language,voice,storage_path,part_no,created_at").eq("book_id", bookId).eq("language", language).order("part_no");
      if (existingAudio?.length) return json({ ok: true, reused: true, audio: existingAudio, disclosure: language === "ar" ? "هذا الصوت مولد بالذكاء الاصطناعي." : "This voice is AI-generated." });
      const { data: analysis } = await supabase.from("spl_analyses").select("id,content").eq("book_id", bookId).eq("kind", "overview").eq("language", language).maybeSingle();
      if (!analysis) return json({ error: "ANALYSIS_NOT_READY" }, 409);
      const spoken = String(analysis.content?.overview?.summary ?? analysis.content?.summary ?? "").slice(0, 24000);
      if (!spoken) return json({ error: "SUMMARY_EMPTY" }, 409);
      const voice = String(body.voice ?? "marin");
      const instructions = language === "ar"
        ? "اقرأ العربية بصوت هادئ رقيق وواضح، مع نطق الكلمات الإنجليزية داخل النص بإنجليزية طبيعية صحيحة. هذه خلاصة كتاب وليست قراءة حرفية للكتاب."
        : "Read in a calm, gentle, clear English voice. Pronounce any Arabic words carefully. This is a book summary, not a verbatim audiobook.";
      const sentences = spoken.split(/(?<=[.!؟?])\s+/u);const chunks:string[]=[];let current="";
      for(const sentence of sentences){if(current&&current.length+sentence.length>3400){chunks.push(current);current=""}current+=`${current?" ":""}${sentence}`}if(current)chunks.push(current);
      const rows=[];
      for(let index=0;index<Math.min(chunks.length,8);index++){
        const audioResponse = await openAI("audio/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: chunks[index], instructions, response_format: "mp3" }),
        });
        const path = `${userData.user.id}/${bookId}/${language}-${index+1}-${crypto.randomUUID()}.mp3`;
        const { error: uploadError } = await supabase.storage.from("spl-audio").upload(path, await audioResponse.blob(), { contentType: "audio/mpeg" });
        if (uploadError) throw uploadError;
        const { data: row, error: rowError } = await supabase.from("spl_audio_outputs").insert({ user_id: userData.user.id, book_id: bookId, analysis_id: analysis.id, language, voice, part_no:index+1, storage_path: path }).select().single();
        if (rowError) throw rowError;rows.push(row);
      }
      return json({ ok: true, audio: rows, disclosure: language === "ar" ? "هذا الصوت مولد بالذكاء الاصطناعي." : "This voice is AI-generated." });
    }

    return json({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, 500);
  }
});
