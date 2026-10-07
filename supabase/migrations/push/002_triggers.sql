-- community-sdk push/002_triggers.sql (schema v1)
-- Community SDK — push module (OPTIONAL): the extensions the push webhooks
-- need. The webhook functions, triggers and the hourly digest cron live in
-- push/003_webhooks.sql (they read the project URL / anon key from the
-- settings seeded via core/000_settings.sql). References core module tables
-- (public.comments, public.likes) — the core module must be installed first,
-- and push/001_push.sql (push_tokens) before this file.
create extension if not exists pg_cron;
create extension if not exists pg_net;
