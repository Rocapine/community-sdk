---
"@rocapine/community": minor
---

The migrations no longer carry the project URL / anon key. The pg_cron jobs and pg_net webhooks read them from Supabase Vault through the helpers in the new `core/000_settings.sql`, and the webhook functions, triggers and jobs move into `core/008_webhooks`, `push/003_webhooks`, `reaction/002_webhooks` and `translation/002_webhooks`. One `supabase/` folder now deploys unchanged to a sandbox and to production; what differs is one statement per project, run once after `db push`: `select public.community_settings_set('https://<ref>.supabase.co', '<anon key>')`. An unseeded project logs a warning per webhook instead of blocking inserts, and the daily sweeps catch up. `init` / `upgrade` stop prompting for and substituting anything; `--project-url` / `--anon-key` only fill in the printed seed statement. Existing installs: `upgrade`, `db push`, seed.
