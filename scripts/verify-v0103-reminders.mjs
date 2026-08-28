import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("src/App.tsx");
const client = read("src/lib/reminders.ts");
const worker = read("public/sw.js");
const edge = read("supabase/functions/spl-reminders/index.ts");
const migration = read("supabase/migrations/20260828_0004_spl_v0103_reminders.sql");
const scheduler = read("supabase/V0103-SCHEDULER-SETUP.sql");

let failed = 0;
function check(name, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failed += 1;
}

check("reminder migration is transactional and additive", /^begin;/m.test(migration) && /^commit;/m.test(migration) && !/\b(drop table|truncate|delete from)\b/i.test(migration));
check("reminder tables enforce owner RLS", (migration.match(/enable row level security/g) ?? []).length >= 2 && (migration.match(/user_id = auth\.uid\(\)/g) ?? []).length >= 4);
check("due reminders are claimed atomically", /for update skip locked/i.test(migration) && /set claimed_at = now\(\)/i.test(migration));
check("claim RPC is service-role only", /revoke all[\s\S]*from public, anon, authenticated/i.test(migration) && /grant execute[\s\S]*to service_role/i.test(migration));
check("migration creates no cron job and calls no URL", !/cron\.schedule|net\.http_post|https?:\/\//i.test(migration));
check("scheduler uses one explicit 15-minute job", /'spl-v0103-book-reminders'/i.test(scheduler) && /'\*\/15 \* \* \* \*'/i.test(scheduler));
check("scheduler does not run every minute or second", !/'\* \* \* \* \*'/.test(scheduler) && !/\*\/\d+ \* \* \* \* \*/.test(scheduler));
check("scheduler secret comes from Vault", /vault\.decrypted_secrets/i.test(scheduler) && /spl_reminder_cron_secret/i.test(scheduler));
check("dispatcher fails closed without cron secret", /SPL_REMINDER_CRON_SECRET/.test(edge) && /UNAUTHORIZED/.test(edge));
check("dispatcher caps each batch and retries", /Math\.min\(25/.test(edge) && /reminder\.attempts < 3/.test(edge));
check("dispatcher claims reminders through atomic RPC", /rpc\("spl_claim_due_book_reminders"/.test(edge));
check("client requires VAPID and iPhone Home Screen", /VITE_SPL_VAPID_PUBLIC_KEY/.test(client) && /IOS_HOME_SCREEN_REQUIRED/.test(client));
check("service worker handles push and notification click", /addEventListener\("push"/.test(worker) && /addEventListener\("notificationclick"/.test(worker));
check("V0.10.3 exposes real reminder controls", /saveBookReminder/.test(app) && /showReminderTest/.test(app) && /view === "progress"/.test(app));

console.log(`\n${failed === 0 ? "ALL V0.10.3 REMINDER CHECKS PASSED" : `${failed} V0.10.3 REMINDER CHECK(S) FAILED`}`);
if (failed) process.exit(1);
