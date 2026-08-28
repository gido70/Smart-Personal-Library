-- REVIEW-THEN-RUN ONLY. This file is deliberately not a migration.
-- First inspect existing jobs:
-- select jobid, jobname, schedule, command, active from cron.job order by jobid;
-- Then store project_url and spl_reminder_cron_secret in Vault and replace the
-- two vault lookups below only if those exact secret names exist.
-- The schedule is every 15 minutes, never every minute or second.

select cron.unschedule(jobid)
from cron.job
where jobname = 'spl-v0103-book-reminders';

select cron.schedule(
  'spl-v0103-book-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/spl-reminders',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-spl-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'spl_reminder_cron_secret')
    ),
    body := '{"limit":25}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
