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

const TEXT_MODEL = () => Deno.env.get("OPENAI_TEXT_MODEL") ?? "gpt-5.6-terra";
const PILOT_QUESTION_LIMIT = 20;

const bookAnalysisFormat = {
  type: "json_schema",
  name: "book_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["source_language", "metadata", "overview", "chapters", "critical", "trust_notes"],
    properties: {
      source_language: { type: "string", enum: ["ar", "en", "mixed"] },
      metadata: {
        type: "object", additionalProperties: false,
        required: ["title", "author", "subject", "pages_if_known"],
        properties: {
          title: { type: ["string", "null"] }, author: { type: ["string", "null"] },
          subject: { type: ["string", "null"] }, pages_if_known: { type: ["integer", "null"] },
        },
      },
      overview: {
        type: "object", additionalProperties: false,
        required: ["summary", "key_ideas", "return_to_source"],
        properties: {
          summary: { type: "string" }, key_ideas: { type: "array", items: { type: "string" } },
          return_to_source: { type: "array", items: { type: "object", additionalProperties: false, required: ["page", "reason"], properties: { page: { type: ["string", "integer", "null"] }, reason: { type: "string" } } } },
        },
      },
      chapters: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "summary", "pages_if_known"], properties: { title: { type: "string" }, summary: { type: "string" }, pages_if_known: { type: ["string", "integer", "null"] } } } },
      critical: { type: "object", additionalProperties: false, required: ["strengths", "limitations", "platform_inferences"], properties: { strengths: { type: "array", items: { type: "string" } }, limitations: { type: "array", items: { type: "string" } }, platform_inferences: { type: "array", items: { type: "string" } } } },
      trust_notes: { type: "string" },
    },
  },
};

const bookAnswerFormat = {
  type: "json_schema",
  name: "book_answer",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["answer", "references", "confidence", "inference"],
    properties: {
      answer: { type: "string" },
      references: { type: "array", items: { type: "object", additionalProperties: false, required: ["page", "chapter", "note"], properties: { page: { type: ["string", "integer", "null"] }, chapter: { type: ["string", "null"] }, note: { type: "string" } } } },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      inference: { type: "string" },
    },
  },
};

async function recordUsage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  bookId: string,
  action: string,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number } | null,
  metadata: Record<string, unknown> = {},
) {
  // V0.9 usage logging is deliberately non-blocking so a temporary reporting
  // failure never charges twice by forcing the user to repeat a completed call.
  await supabase.from("spl_ai_usage").insert({
    user_id: userId,
    book_id: bookId,
    action,
    model,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    metadata,
  }).then(({ error }) => error && console.warn("SPL_USAGE_LOG_FAILED", error.message));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  let requestReceipt: { client: ReturnType<typeof createClient>; id: string } | null = null;
  try {
    // Fail closed. The paid path stays unavailable unless the project owner
    // explicitly creates this server-side secret with the exact value "true".
    // A browser flag alone is not a financial security boundary.
    if (Deno.env.get("SPL_PAID_AI_ENABLED") !== "true") {
      return json({ error: "PAID_AI_DISABLED" }, 403);
    }
    const auth = request.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return json({ error: "UNAUTHENTICATED" }, 401);
    const pilotEmail = (Deno.env.get("SPL_PILOT_EMAIL") ?? "").trim().toLowerCase();
    const signedInEmail = (userData.user.email ?? "").trim().toLowerCase();
    if (!pilotEmail || !signedInEmail || signedInEmail !== pilotEmail) {
      return json({ error: "PRIVATE_PILOT_EMAIL_REQUIRED" }, 403);
    }
    const body = await request.json();
    const { action, bookId } = body;
    const { data: book, error: bookError } = await supabase.from("spl_books").select("*").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "BOOK_NOT_FOUND" }, 404);
    if (book.user_id !== userData.user.id) return json({ error: "BOOK_FORBIDDEN" }, 403);
    const { data: consent } = await supabase.from("spl_legal_consents").select("id").eq("book_id", bookId).eq("user_id", userData.user.id).maybeSingle();
    if (!consent) return json({ error: "LEGAL_CONSENT_REQUIRED" }, 403);

    // Once additive migration 0005 is applied, only the first request owns an
    // idempotency key. Repeated taps or a retry after an interrupted response
    // read the same receipt instead of starting another OpenAI charge. Before
    // that migration exists, this check degrades to the proven legacy path.
    const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(body.requestId) ? body.requestId : null;
    if (requestId && ["process", "ask", "audio", "audio_preview"].includes(action)) {
      const { data: previous, error: previousError } = await supabase
        .from("spl_ai_requests")
        .select("id,status,http_status,result,error_code")
        .eq("user_id", userData.user.id)
        .eq("idempotency_key", requestId)
        .maybeSingle();
      if (!previousError && previous) {
        if (previous.status === "succeeded") return json(previous.result ?? { ok: true, reused: true }, previous.http_status ?? 200);
        if (previous.status === "failed") return json(previous.result ?? { error: previous.error_code ?? "PREVIOUS_REQUEST_FAILED" }, previous.http_status ?? 409);
        return json({ ok: false, pending: true, requestId }, 202);
      }
      if (!previousError) {
        const { data: created, error: createError } = await supabase.from("spl_ai_requests").insert({
          user_id: userData.user.id,
          book_id: bookId,
          action,
          idempotency_key: requestId,
          status: "processing",
        }).select("id").single();
        if (!createError && created) requestReceipt = { client: supabase, id: created.id };
        else if (createError?.code === "23505") return json({ ok: false, pending: true, requestId }, 202);
      }
    }
    const finish = async (payload: Record<string, unknown>, status = 200) => {
      if (requestReceipt) {
        await requestReceipt.client.from("spl_ai_requests").update({
          status: status < 400 ? "succeeded" : "failed",
          http_status: status,
          result: payload,
          error_code: typeof payload.error === "string" ? payload.error : null,
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        }).eq("id", requestReceipt.id);
      }
      return json(payload, status);
    };

    if (action === "process") {
      const requestedLanguage = body.language === "en" ? "en" : "ar";
      const { data: existingAnalysis } = await supabase.from("spl_analyses").select("content").eq("book_id", bookId).eq("kind", "overview").eq("language", requestedLanguage).limit(1).maybeSingle();
      if (existingAnalysis) return await finish({ ok: true, reused: true, result: existingAnalysis.content });
      // A legacy pilot default stopped every new book after the first analysed
      // title. The library is now allowed to grow; spending remains protected
      // by explicit per-action confirmation and the daily analysis cap below.
      const dayStart = new Date();dayStart.setUTCHours(0,0,0,0);
      const { data: dailyAnalyses } = await supabase.from("spl_analyses").select("book_id").eq("user_id", userData.user.id).eq("kind", "overview").gte("created_at", dayStart.toISOString());
      if (new Set((dailyAnalyses ?? []).map(item => item.book_id)).size >= 3) return await finish({ error: "DAILY_ANALYSIS_LIMIT_REACHED", limit: 3 }, 429);
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

      const target = requestedLanguage === "ar" ? "Arabic" : "English";
      const prompt = `Analyze this PDF for a private scholarly reading assistant. Detect whether the source is Arabic, English, or mixed, but write every generated field in ${target}. If the source language differs, translate the meaning faithfully into ${target}. Do not reproduce the book verbatim and do not invent bibliographic data. Return JSON only with keys: source_language (ar|en|mixed), metadata {title, author, subject, pages_if_known}, overview {summary, key_ideas, return_to_source}, chapters (array of {title, summary, pages_if_known}), critical {strengths, limitations, platform_inferences}, trust_notes. Each return_to_source item must contain a reliable page number or page range and a short reason to revisit it. Make overview.summary an original 1800-2400 word script suitable for about 12-18 minutes of calm narration. Clearly distinguish source facts from platform inference. If a page cannot be verified, use null instead of guessing.`;
      const model = TEXT_MODEL();
      const generated = await openAI("responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_output_tokens: 12_000,
          input: [{ role: "user", content: [{ type: "input_file", file_id: openaiFileId, detail: "low" }, { type: "input_text", text: prompt }] }],
          text: { format: bookAnalysisFormat },
        }),
      });
      const response = await generated.json();
      const outputText = response.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? []).map((item: { text?: string }) => item.text ?? "").join("") ?? "";
      const result = JSON.parse(stripFence(outputText));
      await supabase.from("spl_analyses").upsert({
        user_id: userData.user.id,
        book_id: bookId,
        kind: "overview",
        language: requestedLanguage,
        content: result,
        model,
        source: "openai",
        template_version: "v0.9-paid-pilot",
      }, { onConflict: "book_id,kind,language" });
      await recordUsage(supabase, userData.user.id, bookId, "process", model, response.usage ?? null, { language: requestedLanguage });
      await supabase.from("spl_books").update({
        source_language: result.source_language ?? "unknown",
        status: "ready",
        metadata: { ...(book.metadata ?? {}), ...(result.metadata ?? {}) },
      }).eq("id", bookId);
      return await finish({ ok: true, result, usage: response.usage ?? null });
    }

    if (action === "ask") {
      const question = String(body.question ?? "").trim();
      const language = body.language === "en" ? "en" : "ar";
      if (!question) return await finish({ error: "QUESTION_REQUIRED" }, 400);
      if (!book.openai_file_id) return await finish({ error: "BOOK_NOT_PROCESSED" }, 409);
      const dayStart = new Date();dayStart.setUTCHours(0,0,0,0);
      const { count: totalQuestions } = await supabase.from("spl_questions").select("id", { count: "exact", head: true }).eq("user_id", userData.user.id);
      if ((totalQuestions ?? 0) >= PILOT_QUESTION_LIMIT) return await finish({ error: "PILOT_QUESTION_LIMIT_REACHED", limit: PILOT_QUESTION_LIMIT }, 429);
      const { count: dailyQuestions } = await supabase.from("spl_questions").select("id", { count: "exact", head: true }).eq("user_id", userData.user.id).gte("created_at", dayStart.toISOString());
      if ((dailyQuestions ?? 0) >= 10) return await finish({ error: "DAILY_QUESTION_LIMIT_REACHED", limit: 10 }, 429);
      const prompt = `${language === "ar" ? "أجب بالعربية" : "Answer in English"}. Answer only from the uploaded book. If the book does not support the answer, say so. Distinguish quotations, paraphrases, and platform inference. Include page or chapter references when reliably available. Return JSON only: {answer, references:[{page,chapter,note}], confidence, inference}. Question: ${question}`;
      const model = TEXT_MODEL();
      const generated = await openAI("responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_output_tokens: 2_500, input: [{ role: "user", content: [{ type: "input_file", file_id: book.openai_file_id, detail: "low" }, { type: "input_text", text: prompt }] }], text: { format: bookAnswerFormat } }),
      });
      const response = await generated.json();
      const outputText = response.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? []).map((item: { text?: string }) => item.text ?? "").join("") ?? "";
      const answer = JSON.parse(stripFence(outputText));
      await supabase.from("spl_questions").insert({ user_id: userData.user.id, book_id: bookId, question, answer, language, model });
      await recordUsage(supabase, userData.user.id, bookId, "ask", model, response.usage ?? null, { language });
      return await finish({ ok: true, answer, usage: response.usage ?? null });
    }

    if (action === "audio_preview") {
      const language = body.language === "en" ? "en" : "ar";
      const voice = body.voice === "cedar" ? "cedar" : "marin";
      const sample = language === "ar"
        ? "في هذه المكتبة نقرأ بهدوء، ونمنح كل فكرة وقتها. هذا نموذج قصير لتختار الصوت الأقرب إليك قبل إنشاء الخلاصة الصوتية الكاملة."
        : "In this library, we read calmly and give every idea the time it deserves. This short sample helps you choose a voice before creating the full audio summary.";
      const path = `${userData.user.id}/${bookId}/voice-previews/${language}-${voice}.mp3`;
      const { data: cached } = await supabase.storage.from("spl-audio").download(path);
      if (cached) return await finish({ ok: true, reused: true, storage_path: path, voice, language });
      const instructions = language === "ar"
        ? "اقرأ كراوٍ لكتاب صوتي: هادئ، دافئ، متزن، بسرعة أبطأ قليلًا، دون مبالغة مسرحية، مع وقفات طبيعية ونطق عربي فصيح واضح."
        : "Read like a calm, warm audiobook narrator at a slightly slower pace, without theatrical exaggeration, using natural pauses and clear pronunciation.";
      const audioResponse = await openAI("audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: sample, instructions, speed: 0.92, response_format: "mp3" }),
      });
      const { error: uploadError } = await supabase.storage.from("spl-audio").upload(path, await audioResponse.blob(), { contentType: "audio/mpeg", upsert: true });
      if (uploadError) throw uploadError;
      await recordUsage(supabase, userData.user.id, bookId, "audio_preview", "gpt-4o-mini-tts", null, { language, voice, characters: sample.length });
      return await finish({ ok: true, reused: false, storage_path: path, voice, language });
    }

    if (action === "audio") {
      const language = body.language === "en" ? "en" : "ar";
      const voice = body.voice === "cedar" ? "cedar" : "marin";
      const { data: existingAudio } = await supabase.from("spl_audio_outputs").select("id,language,voice,storage_path,part_no,created_at").eq("book_id", bookId).eq("language", language).eq("voice", voice).order("part_no");
      if (existingAudio?.length) return await finish({ ok: true, reused: true, audio: existingAudio, disclosure: language === "ar" ? "هذا الصوت مولد بالذكاء الاصطناعي." : "This voice is AI-generated." });
      const { data: analysis } = await supabase.from("spl_analyses").select("id,content").eq("book_id", bookId).eq("kind", "overview").eq("language", language).maybeSingle();
      if (!analysis) return await finish({ error: "ANALYSIS_NOT_READY" }, 409);
      const spoken = String(analysis.content?.overview?.summary ?? analysis.content?.summary ?? "").slice(0, 24000);
      if (!spoken) return await finish({ error: "SUMMARY_EMPTY" }, 409);
      const instructions = language === "ar"
        ? "اقرأ كراوٍ لكتاب صوتي: هادئ، دافئ، متزن، بسرعة أبطأ قليلًا، دون مبالغة مسرحية، مع وقفات طبيعية ونطق عربي فصيح واضح، ونطق الكلمات الإنجليزية داخل النص بإنجليزية طبيعية. هذه خلاصة كتاب وليست قراءة حرفية للكتاب."
        : "Read like a calm, warm audiobook narrator at a slightly slower pace, without theatrical exaggeration, using natural pauses and clear English pronunciation. Pronounce any Arabic words carefully. This is a book summary, not a verbatim audiobook.";
      const sentences = spoken.split(/(?<=[.!؟?])\s+/u);const chunks:string[]=[];let current="";
      for(const sentence of sentences){if(current&&current.length+sentence.length>3400){chunks.push(current);current=""}current+=`${current?" ":""}${sentence}`}if(current)chunks.push(current);
      const rows=[];
      for(let index=0;index<Math.min(chunks.length,8);index++){
        const audioResponse = await openAI("audio/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: chunks[index], instructions, speed: 0.92, response_format: "mp3" }),
        });
        const path = `${userData.user.id}/${bookId}/${language}-${index+1}-${crypto.randomUUID()}.mp3`;
        const { error: uploadError } = await supabase.storage.from("spl-audio").upload(path, await audioResponse.blob(), { contentType: "audio/mpeg" });
        if (uploadError) throw uploadError;
        const { data: row, error: rowError } = await supabase.from("spl_audio_outputs").insert({ user_id: userData.user.id, book_id: bookId, analysis_id: analysis.id, language, voice, part_no:index+1, storage_path: path }).select().single();
        if (rowError) throw rowError;rows.push(row);
      }
      await recordUsage(supabase, userData.user.id, bookId, "audio", "gpt-4o-mini-tts", null, { language, voice, parts: rows.length, characters: spoken.length });
      return await finish({ ok: true, audio: rows, disclosure: language === "ar" ? "هذا الصوت مولد بالذكاء الاصطناعي." : "This voice is AI-generated." });
    }

    return await finish({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error(error);
    if (requestReceipt) {
      await requestReceipt.client.from("spl_ai_requests").update({
        status: "failed",
        http_status: 500,
        error_code: error instanceof Error ? error.message.slice(0, 240) : "UNKNOWN_ERROR",
        result: { error: error instanceof Error ? error.message : "UNKNOWN_ERROR" },
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      }).eq("id", requestReceipt.id);
    }
    return json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, 500);
  }
});
