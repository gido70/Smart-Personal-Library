import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8" },
});

type ClaimedReminder = {
  id: string;
  user_id: string;
  book_id: string;
  remind_at: string;
  attempts: number;
};

type PushRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const expectedSecret = Deno.env.get("SPL_REMINDER_CRON_SECRET") ?? "";
  const receivedSecret = request.headers.get("x-spl-cron-secret") ?? "";
  if (!expectedSecret || receivedSecret !== expectedSecret) return json({ error: "UNAUTHORIZED" }, 401);

  const publicKey = Deno.env.get("SPL_VAPID_PUBLIC_KEY") ?? "";
  const privateKey = Deno.env.get("SPL_VAPID_PRIVATE_KEY") ?? "";
  const subject = Deno.env.get("SPL_VAPID_SUBJECT") ?? "";
  if (!publicKey || !privateKey || !/^mailto:|^https:\/\//.test(subject)) {
    return json({ error: "VAPID_NOT_CONFIGURED" }, 503);
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const requested = Number((await request.json().catch(() => ({})))?.limit ?? 25);
  const limit = Math.min(25, Math.max(1, Number.isFinite(requested) ? requested : 25));
  const { data: claimed, error: claimError } = await admin.rpc("spl_claim_due_book_reminders", { p_limit: limit });
  if (claimError) return json({ error: "REMINDER_CLAIM_FAILED", detail: claimError.message }, 500);
  const reminders = (claimed ?? []) as ClaimedReminder[];
  if (!reminders.length) return json({ ok: true, claimed: 0, sent: 0, failed: 0 });

  const userIds = [...new Set(reminders.map((item) => item.user_id))];
  const bookIds = [...new Set(reminders.map((item) => item.book_id))];
  const [{ data: subscriptions }, { data: books }] = await Promise.all([
    admin.from("spl_push_subscriptions").select("id,user_id,endpoint,p256dh,auth").in("user_id", userIds),
    admin.from("spl_books").select("id,title").in("id", bookIds),
  ]);
  const pushRows = (subscriptions ?? []) as PushRow[];
  const titleByBook = new Map((books ?? []).map((book) => [String(book.id), String(book.title)]));
  let sent = 0;
  let failed = 0;

  for (const reminder of reminders) {
    const targets = pushRows.filter((row) => row.user_id === reminder.user_id);
    const bookTitle = titleByBook.get(reminder.book_id) ?? "كتابك";
    const payload = JSON.stringify({
      title: "موعد القراءة",
      body: `حان وقت العودة إلى «${bookTitle}».`,
      tag: `spl-reminder-${reminder.id}`,
      url: `./?book=${encodeURIComponent(reminder.book_id)}`,
    });
    let delivered = false;
    const errors: string[] = [];
    for (const target of targets) {
      try {
        await webpush.sendNotification({
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        }, payload, { TTL: 3600, urgency: "normal" });
        delivered = true;
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode ?? 0);
        errors.push(error instanceof Error ? error.message.slice(0, 240) : "PUSH_SEND_FAILED");
        if (status === 404 || status === 410) await admin.from("spl_push_subscriptions").delete().eq("id", target.id);
      }
    }

    if (delivered) {
      sent += 1;
      await admin.from("spl_book_reminders").update({
        enabled: false,
        claimed_at: null,
        last_sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", reminder.id);
    } else {
      failed += 1;
      await admin.from("spl_book_reminders").update({
        enabled: reminder.attempts < 3,
        claimed_at: null,
        last_error: targets.length ? errors.join(" | ").slice(0, 500) : "NO_PUSH_SUBSCRIPTION",
        updated_at: new Date().toISOString(),
      }).eq("id", reminder.id);
    }
  }

  return json({ ok: true, claimed: reminders.length, sent, failed });
});
