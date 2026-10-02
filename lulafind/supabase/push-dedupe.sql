-- Check what push wiring is installed, and remove the SQL trigger if you
-- created BOTH it and a Dashboard webhook.
--
-- Two hooks on the same table means every notification is delivered twice: the
-- database fires both, and neither knows about the other. There is no
-- coordination between a hand-written trigger and a Dashboard webhook.
--
-- Safe to run as often as you like.

-- ─── 1. What is actually installed ─────────────────────────────────────────
-- A row here means the SQL trigger is live. No rows means it is not.
select
  'sql trigger' as what,
  tgname as name,
  case when tgname = 'lula_send_push' then 'INSTALLED - will double-send if a Dashboard webhook also exists' else 'other' end as state
from pg_trigger
where tgname = 'lula_send_push' and not tgisinternal;

-- The token table, which push-tokens.sql creates. Should be one row, 4 policies.
select
  'push_tokens table' as what,
  case when count(*) = 1 then 'exists' else 'MISSING - run push-tokens.sql' end as state
from information_schema.tables
where table_schema = 'public' and table_name = 'push_tokens';

select
  'push_tokens policies' as what,
  count(*) || ' installed' as state
from pg_policies
where schemaname = 'public' and tablename = 'push_tokens';

-- How many device tokens are registered. Zero here means nothing can be
-- delivered no matter how correct the wiring is.
select
  'registered devices' as what,
  count(*) || ' rows' as state
from public.push_tokens;

-- ─── 2. Remove the SQL trigger, keep the Dashboard webhook ─────────────────
-- Run this if step 1 showed the trigger installed AND you also created a
-- Dashboard webhook. The Dashboard route is the supported one; the SQL trigger
-- was removed from the repo because it called an internal Supabase helper.
--
-- Dropping the trigger does not touch the table, the policies, or the tokens.
drop trigger if exists lula_send_push on public.records;
drop function if exists public.lula_send_push();

-- ─── 3. Confirm it is gone ─────────────────────────────────────────────────
select
  'sql trigger after cleanup' as what,
  case when count(*) = 0 then 'removed' else 'STILL PRESENT' end as state
from pg_trigger
where tgname = 'lula_send_push' and not tgisinternal;
