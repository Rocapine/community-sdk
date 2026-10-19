-- Lets a user delete their own push row (account deletion). Until now only
-- select/insert/update existed, so a client delete() was a silent no-op.
drop policy if exists "delete own push row" on public.push_tokens;
create policy "delete own push row" on public.push_tokens for delete to authenticated
  using (user_id = auth.uid());
