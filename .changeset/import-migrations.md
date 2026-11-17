---
"@rocapine/community": patch
---

Two additive migrations for importing content from another platform. `core/018_content_length` (and `images/003_content_length`) moves the post and comment length limit from CHECK constraints to a trigger, so the limit applies to new writing only and an importer can bring in longer history (`alter table ... disable trigger user`). `core/019_placeholders` adds `profiles.is_placeholder`: placeholder profiles for imported authors show like members but are left out of the dashboard counts. Run `npx @rocapine/community upgrade` and `supabase db push` to pick them up; nothing changes for existing data.
