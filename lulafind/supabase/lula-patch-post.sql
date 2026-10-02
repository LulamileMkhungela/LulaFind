-- Give the database lula_patch_post: patch one post's fields in place.
--
-- Without it, "Still searching", the checklist, claiming a search zone and
-- closing a case all fail with
--
--   could not find function public.lula_patch_post(text, jsonb)
--
-- because PostgREST cannot find the function at all. The app also carries a
-- read-and-write fallback now, so nothing is blocked while you read this - but
-- with the function installed two people acting at the same time cannot
-- overwrite each other's change with a copy they read a moment earlier.
--
-- This version calls no helper functions. The one in schema.sql uses
-- `lula_is_self`, which only exists on installs created since the schema was
-- refactored - running that one on an older database fails with
-- "function public.lula_is_self(text) does not exist" and nothing is applied.
-- The only things needed here are `public.records` and `public.lula_uid()`,
-- which every install has (check-setup.sql check 1 proves the latter).
--
-- Run once, in the Supabase SQL editor. Safe to re-run.

create or replace function public.lula_patch_post(post_id text, patch jsonb)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  target_author text;
  me text := (select public.lula_uid());
  is_admin boolean := coalesce((auth.jwt()->'app_metadata'->>'role') in ('admin', 'moderator'), false)
                   or coalesce((auth.jwt()->>'lulafind_role') in ('admin', 'moderator'), false);
begin
  select r.payload->>'authorId' into target_author
    from public.records r
   where r.collection = 'posts' and r.id = post_id;

  if target_author is null then
    raise exception 'no such post';
  end if;

  -- The author or an admin may change anything. A volunteer may only ever touch
  -- the searchParty field - claiming a search zone is not a licence to rewrite
  -- somebody's case.
  if not (
    is_admin
    or (me is not null and target_author = me)
    or (select coalesce(bool_and(k in ('searchParty', 'updatedAt')), false) from jsonb_object_keys(patch) k)
  ) then
    raise exception 'not allowed';
  end if;

  update public.records
     set payload = payload || patch,
         updated_at = ((extract(epoch from now()) * 1000)::bigint)
   where collection = 'posts' and id = post_id;
end;
$$;

-- Called from the app over PostgREST, which needs execute for both roles.
revoke all on function public.lula_patch_post(text, jsonb) from public;
grant execute on function public.lula_patch_post(text, jsonb) to anon, authenticated;

-- Prove it: this must print the function's name, not nothing.
--   select proname from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'lula_patch_post';
