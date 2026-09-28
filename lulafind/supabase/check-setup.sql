-- LulaFind backend health check. Read-only: run it in the Supabase SQL editor.
--
--   Supabase dashboard -> SQL editor -> New query -> paste -> Run.
--
-- Every check prints PASS or FAIL. Fix the FAILs in the order they appear, then
-- run this again. `docs/SETUP.md` has the click-path for each one.
--
-- The single most common cause of
--   "new row violates row-level security policy for table records"
-- is check 1: Supabase has not been told to trust the LulaFind Firebase
-- project, so it cannot read a Firebase UID out of the request and every
-- write is denied.

-- 1. Does lula_uid() exist and can this session be identified at all?
--    In the SQL editor there is no request JWT, so lula_uid() is NULL here.
--    That is expected and fine. The real test is check 5, from the app.
select
  '1. lula_uid() installed' as check,
  case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'lula_uid'
  ) then 'PASS' else 'FAIL - run schema.sql' end as result;

-- 2. Row-level security must be ON, or the policies are decorative.
select
  '2. RLS enabled on records' as check,
  case when relrowsecurity then 'PASS' else 'FAIL - run schema.sql' end as result
from pg_class where oid = 'public.records'::regclass;

-- 3. The write policy that decides whether a story can be saved.
select
  '3. "lula insert" policy present' as check,
  case when count(*) = 1 then 'PASS' else 'FAIL - run schema.sql' end as result
from pg_policies
where schemaname = 'public' and tablename = 'records' and policyname = 'lula insert';

-- 4. The owner/timestamp trigger. Without it a row can land with a null
--    owner_id, which is the most common reason an insert is rejected.
select
  '4. lula_touch_record trigger' as check,
  case when count(*) = 1 then 'PASS' else 'FAIL - run schema.sql' end as result
from pg_trigger
where tgname = 'lula_touch_record'
  and tgrelid = 'public.records'::regclass
  and not tgisinternal;

-- 5. Which token shape reaches the database. Run this FROM THE APP, not from
--    the SQL editor: sign in, open the browser/Simulator console and run
--        await window.__lulaDebugWhoAmI()
--    It calls public.lula_debug_identity() over PostgREST with the real request
--    token and returns every field the write policies depend on:
--
--      dbUid               the UID the database reads out of the token
--      appUid              the UID the app believes is signed in
--      dbUidMatchesAppUid  the two agree
--      suspended           the account is suspended (insert policy refuses it)
--      canWrite            the single verdict: FALSE means INSERT cannot succeed
--      postInteractRpc     supabase/post-interactions.sql was run
--      spotlightRpc        likewise
--
--    canWrite: false is the whole story. If dbUid is null the cause is the
--    backend switch below; if dbUid and appUid differ, sign out and in again.
select
  '5. caller identity (run from the app)' as check,
  case
    when public.lula_debug_identity(null::text) ->> 'dbUid' is null
      then 'Run this from the app console with await window.__lulaDebugWhoAmI() - it needs a real request token.'
    else 'Run this from the app console with await window.__lulaDebugWhoAmI()'
  end as result;

-- 6. The publishable anon key must never be mistaken for a signed-in caller.
--    If this ever reports a uid, stop and fix lula_uid().
select
  '6. anon key is not a caller' as check,
  case when public.lula_uid() is null then 'PASS' else 'FAIL - lula_uid() accepts the anon key' end as result;

-- 7. The interaction RPCs must exist. Without post-interactions.sql, voting,
--    sharing, "I'm looking" and Spotlight edits all fail even though the
--    identity is correct - which looks like the same error.
select
  '7. interaction RPCs installed' as check,
  case
    when to_regprocedure('public.lula_post_interact(text, jsonb)') is null
      then 'FAIL - run supabase/post-interactions.sql'
    when to_regprocedure('public.lula_link_spotlight_post(text, text, boolean)') is null
      then 'FAIL - run supabase/post-interactions.sql'
    else 'PASS'
  end as result;

-- 8. Owner fill-in. A row that lands with a null owner_id can never equal a
--    caller, which is the real meaning of an insert RLS rejection.
select
  '8. lula_touch_record fills owner_id' as check,
  case
    when not exists (
      select 1 from pg_trigger
      where tgname = 'lula_touch_record'
        and tgrelid = 'public.records'::regclass
        and not tgisinternal
    ) then 'FAIL - run schema.sql'
    when not exists (
      select 1 from information_schema.triggers
      where trigger_name = 'lula_touch_record'
    ) then 'FAIL - the trigger exists but is not enabled for both INSERT and UPDATE'
    else 'PASS'
  end as result;
