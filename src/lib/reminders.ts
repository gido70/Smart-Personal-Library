import { ensurePilotSession, supabase } from "./supabase";

export type BookReminder = {
  id: string;
  book_id: string;
  remind_at: string;
  timezone: string;
  enabled: boolean;
  last_sent_at: string | null;
  last_error: string | null;
  created_at: string;
};

function bytesFromBase64Url(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function pushError(error: unknown) {
  const value = error as { code?: string; message?: string } | null;
  const raw = value?.message ?? String(error ?? "");
  if (value?.code === "42P01" || /spl_(push_subscriptions|book_reminders)/i.test(raw)) {
    return new Error("V0103_REMINDER_MIGRATION_REQUIRED");
  }
  return error instanceof Error ? error : new Error(raw || "PUSH_FAILED");
}

export async function enablePushForThisDevice() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("PUSH_UNSUPPORTED");
  }
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (isiOS && !standalone) throw new Error("IOS_HOME_SCREEN_REQUIRED");

  const vapidKey = String(import.meta.env.VITE_SPL_VAPID_PUBLIC_KEY ?? "").trim();
  if (!vapidKey) throw new Error("VAPID_NOT_CONFIGURED");

  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("PUSH_PERMISSION_DENIED");

  const session = await ensurePilotSession();
  const registration = await navigator.serviceWorker.getRegistration()
    ?? await navigator.serviceWorker.register("./sw.js");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytesFromBase64Url(vapidKey),
  });
  const json = subscription.toJSON();
  const endpoint = json.endpoint ?? subscription.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw new Error("PUSH_SUBSCRIPTION_INVALID");

  const { error } = await supabase!.from("spl_push_subscriptions").upsert({
    user_id: session.user.id,
    endpoint,
    p256dh,
    auth,
    user_agent: navigator.userAgent,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,endpoint" });
  if (error) throw pushError(error);
  return subscription;
}

export async function listBookReminders(): Promise<BookReminder[]> {
  await ensurePilotSession();
  const { data, error } = await supabase!
    .from("spl_book_reminders")
    .select("id,book_id,remind_at,timezone,enabled,last_sent_at,last_error,created_at")
    .eq("enabled", true)
    .order("remind_at", { ascending: true });
  if (error) throw pushError(error);
  return (data ?? []) as BookReminder[];
}

export async function saveBookReminder(bookId: string, remindAt: Date) {
  const session = await ensurePilotSession();
  if (!bookId || Number.isNaN(remindAt.getTime()) || remindAt.getTime() <= Date.now()) {
    throw new Error("REMINDER_TIME_INVALID");
  }
  const { data, error } = await supabase!.from("spl_book_reminders").upsert({
    user_id: session.user.id,
    book_id: bookId,
    remind_at: remindAt.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    enabled: true,
    claimed_at: null,
    attempts: 0,
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,book_id" }).select().single();
  if (error) throw pushError(error);
  return data as BookReminder;
}

export async function disableBookReminder(id: string) {
  await ensurePilotSession();
  const { error } = await supabase!
    .from("spl_book_reminders")
    .update({ enabled: false, claimed_at: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw pushError(error);
}

export async function showReminderTest(title: string, body: string) {
  await enablePushForThisDevice();
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body,
    icon: "./favicon.svg",
    badge: "./favicon.svg",
    tag: "spl-reminder-test",
    data: { url: "./" },
  });
}
