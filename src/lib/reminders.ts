import { ensurePilotSession, supabase } from "./supabase";

export type BookReminder = {
  id: string;
  book_id: string;
  remind_at: string;
  enabled: boolean;
  last_sent_at: string | null;
  created_at: string;
};

function missingV011(error: unknown) {
  const raw = String((error as { message?: string } | null)?.message ?? error ?? "");
  return /spl_(book_reminders|push_subscriptions)/i.test(raw) || /relation .* does not exist/i.test(raw);
}

function requiresIosHomeScreen() {
  const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return appleMobile && !standalone;
}

export async function listBookReminders(bookId?: string): Promise<BookReminder[]> {
  await ensurePilotSession();
  let query = supabase!.from("spl_book_reminders").select("id,book_id,remind_at,enabled,last_sent_at,created_at").eq("enabled", true).order("remind_at", { ascending: true });
  if (bookId) query = query.eq("book_id", bookId);
  const { data, error } = await query;
  if (error) {
    if (missingV011(error)) return [];
    throw error;
  }
  return (data ?? []) as BookReminder[];
}

export async function saveBookReminder(bookId: string, remindAt: Date) {
  const session = await ensurePilotSession();
  const { data, error } = await supabase!.from("spl_book_reminders").upsert(
    { user_id: session.user.id, book_id: bookId, remind_at: remindAt.toISOString(), enabled: true, last_sent_at: null },
    { onConflict: "user_id,book_id" },
  ).select("id,book_id,remind_at,enabled,last_sent_at,created_at").single();
  if (error) {
    if (missingV011(error)) throw new Error("V011_MIGRATION_REQUIRED");
    throw error;
  }
  return data as BookReminder;
}

export async function disableBookReminder(bookId: string) {
  await ensurePilotSession();
  const { error } = await supabase!.from("spl_book_reminders").update({ enabled: false }).eq("book_id", bookId);
  if (error && !missingV011(error)) throw error;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export async function enablePushForThisDevice() {
  if (requiresIosHomeScreen()) throw new Error("IOS_HOME_SCREEN_REQUIRED");
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("PUSH_UNSUPPORTED");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("PUSH_PERMISSION_DENIED");
  const vapid = String(import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "").trim();
  if (!vapid) throw new Error("VAPID_NOT_CONFIGURED");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid) });
  const session = await ensurePilotSession();
  const json = subscription.toJSON();
  const { error } = await supabase!.from("spl_push_subscriptions").upsert(
    { user_id: session.user.id, endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, user_agent: navigator.userAgent, enabled: true, updated_at: new Date().toISOString() },
    { onConflict: "user_id,endpoint" },
  );
  if (error) {
    if (missingV011(error)) throw new Error("V011_MIGRATION_REQUIRED");
    throw error;
  }
  return subscription;
}

export async function showLocalNotification(title: string, body: string, url: string) {
  if (requiresIosHomeScreen()) throw new Error("IOS_HOME_SCREEN_REQUIRED");
  if (!("Notification" in window)) throw new Error("NOTIFICATIONS_UNSUPPORTED");
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("PUSH_PERMISSION_DENIED");
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, { body, icon: "./favicon.svg", badge: "./favicon.svg", data: { url }, tag: `spl-${url}` });
}
