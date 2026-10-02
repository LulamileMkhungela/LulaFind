-- Wire a notification to a push, entirely in SQL.
--
-- Idempotent: safe to re-run. Run this AFTER supabase/push-tokens.sql and AFTER
-- `npx supabase functions deploy send-push`.
--
-- WHY A TRIGGER AND NOT A DASHBOARD WEBHOOK
--
-- Supabase's Database -> Webhooks UI creates exactly this trigger behind the
-- scenes, but only in the dashboard: it cannot be reviewed, diffed or replayed
-- from the repo, and a fresh project has to be re-pointed by hand. Writing it
-- here means the wiring lives with the code it calls.
--
-- The dashboard route still works and needs no SQL - see PUSH.md. Use whichever
-- you prefer, but not both: two hooks mean two pushes per notification.
--
-- WHAT IT DOES
--
-- The app writes every notification into public.records under collection
-- 'notifications'. This fires after that insert and asks the Edge Function to
-- deliver it. Nothing else in the app changes - the bell still reads the same
-- rows, and a failed push cannot fail the write that triggered it.
--
-- REQUIREMENT: the `supabase_functions` schema, which Supabase provisions on
-- projects created with the current dashboard. If your project predates it the
-- CREATE FUNCTION below fails with "schema supabase_functions does not exist"
-- and you should use the dashboard webhook instead - the trigger is a
-- convenience, not a requirement.

-- The body. SECURITY DEFINER so it can call the internal helper regardless of
-- who caused the insert; the trigger only ever fires on rows the caller was
-- already allowed to write.
create or replace function public.lula_send_push()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  -- Only notifications. This table holds posts, comments, follows and
  -- everything else; without this guard every insert in the app would fire a
  -- push.
  if new.collection <> 'notifications' then
    return new;
  end if;

  -- supabase_functions.http_request adds the service-role authorization header
  -- itself, which is why the key never appears in this file.
  perform supabase_functions.http_request(
    'https://srwdtguxdjsjlkaydhet.supabase.co/functions/v1/send-push',
    'POST',
    jsonb_build_object('Content-Type', 'application/json'),
    -- Shaped like a database webhook payload, which is what the function
    -- already parses: it reads record.payload for the recipient.
    jsonb_build_object(
      'type', 'INSERT',
      'table', 'records',
      'schema', 'public',
      'record', to_jsonb(new)
    )
  );

  return new;
end;
$$;

-- AFTER, not BEFORE: the row must exist before anything tries to read it, and
-- a push is a side effect that must never be able to roll back the insert.
drop trigger if exists lula_send_push on public.records;
create trigger lula_send_push
after insert on public.records
for each row execute function public.lula_send_push();

revoke all on function public.lula_send_push() from public;

-- ─── Is it wired up? ────────────────────────────────────────────────────────
select
  'push trigger' as check,
  case when count(*) = 1 then 'installed' else 'MISSING' end as result
from pg_trigger
where tgname = 'lula_send_push' and not tgisinternal;
