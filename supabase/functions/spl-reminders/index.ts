import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const cronSecret = Deno.env.get("SPL_REMINDER_CRON_SECRET") ?? "";
    if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
      return json({ error: "UNAUTHORIZED" }, 401);
    }
    const publicKey = Deno.env.get("SPL_VAPID_PUBLIC_KEY") ?? "";
    const privateKey = Deno.env.get("SPL_VAPID_PRIVATE_KEY") ?? "";
    const subject = Deno.env.get("SPL_VAPID_SUBJECT") ?? "mailto:admin@example.com";
    if (!publicKey || !privateKey) return json({ error: "VAPID_NOT_CONFIGURED" }, 503);
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const now = new Date().toISOString();
    const { data: reminders, error: reminderError } = await supabase
      .from("spl_book_reminders")
      .select("id,user_id,book_id,remind_at,spl_books(title)")
      .eq("enabled", true)
      .lte("remind_at", now)
      .is("last_sent_at", null)
      .limit(100);
    if (reminderError) throw reminderError;

    let sent = 0;
    let disabledSubscriptions = 0;
    for (const reminder of reminders ?? []) {
      const { data: subscriptions, error: subError } = await supabase
        .from("spl_push_subscriptions")
        .select("id,endpoint,p256dh,auth")
        .eq("user_id", reminder.user_id)
        .eq("enabled", true);
      if (subError) throw subError;
      const title = String((reminder.spl_books as { title?: string } | null)?.title ?? "كتابك");
      const payload = JSON.stringify({
        title: "حان وقت العودة إلى كتابك",
        body: `تابع «${title}» من حيث توقفت.`,
        url: `./?book=${reminder.book_id}`,
        bookId: reminder.book_id,
      });
      for (const sub of subscriptions ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 86400 },
          );
          sent += 1;
        } catch (pushError) {
          const statusCode = Number((pushError as { statusCode?: number }).statusCode ?? 0);
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from("spl_push_subscriptions").update({ enabled: false }).eq("id", sub.id);
            disabledSubscriptions += 1;
          } else {
            console.warn("SPL_PUSH_FAILED", reminder.id, statusCode, pushError);
          }
        }
      }
      await supabase.from("spl_book_reminders").update({ last_sent_at: now, enabled: false, updated_at: now }).eq("id", reminder.id);
    }
    return json({ ok: true, reminders: reminders?.length ?? 0, sent, disabledSubscriptions });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, 500);
  }
});
