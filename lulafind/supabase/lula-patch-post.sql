-- Compatibility install: owner-only post edits. Install search-coordination.sql for the search board.
create or replace function public.lula_patch_post(post_id text, patch jsonb)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  cur jsonb;
  me text := public.lula_uid();
begin
  select payload into cur from public.records where collection = 'posts' and id = post_id for update;
  if me is null or cur is null or not (cur->>'authorId' = me or public.lula_is_admin()) then
    raise exception 'Only the case owner or a moderator can edit this case';
  end if;
  if exists(select 1 from public.records where collection = 'users' and id = me and payload->>'suspended' = 'true') then
    raise exception 'Your account is suspended';
  end if;
  if patch ? 'searchParty' then
    raise exception 'Use the search coordination commands to change the search board';
  end if;
  if (patch ? 'id' and patch->>'id' is distinct from post_id)
    or (patch ? 'authorId' and patch->>'authorId' is distinct from cur->>'authorId') then
    raise exception 'Case identity cannot be changed';
  end if;
  update public.records set payload = payload || patch where collection = 'posts' and id = post_id;
end;
$$;
revoke all on function public.lula_patch_post(text, jsonb) from public, anon;
grant execute on function public.lula_patch_post(text, jsonb) to authenticated;
