-- community-sdk groups/002_translation.sql (schema v1)
-- Groups module: translate a group's name and description when the live values
-- change on a visible group (approval of a creation or an edit, admin edit).
-- The old rows go first, so a stale translation never outlives its text, then
-- translate-one (translation module) writes the new ones. Pending values never
-- reach this: only the live columns fire it. Without the translation module the
-- call is skipped. Requires groups/001 and core/000_settings. Idempotent.

create or replace function public.translate_group_webhook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.group_translations where group_id = new.conversation_id;
  if to_regclass('public.post_translations') is not null then
    perform public.community_call_function(
      'translate-one', jsonb_build_object('kind', 'group', 'id', new.conversation_id));
  end if;
  return new;
end; $$;

drop trigger if exists on_group_live_text_translate on public.groups;
create trigger on_group_live_text_translate
  after update of name, description on public.groups for each row
  when (new.status = 'visible'
        and (old.name, old.description) is distinct from (new.name, new.description))
  execute function public.translate_group_webhook();
