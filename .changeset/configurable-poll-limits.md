---
"@rocapine/community-core": patch
"@rocapine/community-ui": patch
"@rocapine/community": patch
---

**Poll limits per app.** Polls keep 2 to 4 options of up to 60 characters by default; an app can
change the range.

- Config: `modules.polls` takes `true` or `{ minOptions?, maxOptions?, optionMaxLength? }`.
  `pollLimits(cfg)` (core) returns the effective limits; the composer uses them. The
  `POLL_MIN_OPTIONS`, `POLL_MAX_OPTIONS` and `POLL_OPTION_MAX_LENGTH` constants stay, as the
  defaults.
- Backend: `polls/002_poll_limits.sql` adds a one-row `poll_settings` and
  `poll_set_limits(min, max, max_length)` (service role; 2 ≤ min ≤ max ≤ 10, length 1 to 200),
  and `poll_limits()` for members. `create_poll_post` checks the option count against it, and the
  per-option limits move from check constraints to a trigger, so an importer can write history
  beyond them (`alter table public.poll_options disable trigger user`).
  `core/020_draft_poll_limits.sql` makes dashboard drafts follow the same limits.
- To use another range, set both to the same values: the config, and once per Supabase project
  `select public.poll_set_limits(2, 7, 100);`. Run `npx @rocapine/community upgrade` and
  `supabase db push` first; nothing changes for apps that keep the defaults.
