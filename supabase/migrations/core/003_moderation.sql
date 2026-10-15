-- community-sdk core/003_moderation.sql (schema v1)
-- Community SDK — 03 moderation plumbing: the extensions the report webhook
-- and the daily moderation cron need. The webhook function, its trigger and
-- the cron job themselves live in core/008_webhooks.sql (they read the
-- project URL / anon key from the settings seeded via core/000_settings.sql).
create extension if not exists pg_cron;
create extension if not exists pg_net;
