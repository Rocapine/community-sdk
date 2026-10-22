-- community-sdk reaction/003_retract.sql
-- A reaction can be withdrawn, like a like: the client deletes its own row.
-- Until now only select/insert existed, so a delete() was a silent no-op.
-- The coalesced push only reads rows still present, so a reaction withdrawn
-- before the digest runs is never announced.
drop policy if exists "unreact own" on public.post_reactions;
create policy "unreact own" on public.post_reactions for delete to authenticated
  using (user_id = auth.uid());
