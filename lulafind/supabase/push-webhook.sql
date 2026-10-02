-- Wire a notification to a push, entirely in SQL.
--
-- Idempotent: safe to re-run. Run this AFTER push-tokens.sql and AFTER
-- `npx supabase functions deploy send-push`.
--
-- ─── READ THIS FIRST ───────────────────────────────────────────────────────
-- Use EITHER this file OR the Dashboard webhook, never both. Two hooks on the
-- same table means every notification is delivered twice: the database fires
-- both and neither knows about the other.
--
-- The Dashboard route is simpler and needs none of the prerequisites below:
--   Supabase dashboard -> Database -> Webhooks -> Create a new hook
--   Table public.records | Events INSERT
--   Filter record.collection = 'notifications'
--   Type Supabase Edge Function | Function send-push
--
-- This file exists because a Dashboard hook cannot be reviewed, diffed or
-- replayed from the repo, and a fresh project has to be re-pointed by hand.
--
-- ─── PREREQUISITES ─────────────────────────────────────────────────────────
-- 1. The pg_net extension (Supabase enables it by default on current projects):
--
--        create extension if not exists pg_net with schema extensions;
--
-- 2. A Vault secret holding the service-role key, so the key is never written
--    into this file or into git:
--
--        Supabase dashboard -> Project Settings -> Vault -> New secret
--        Name:  service_role_key
--        Value: the service_role key from Project Settings -> API
--
--    If that secret is missing the function logs a warning and skips the push
--    rather than failing the insert.
--
-- WHY THE SERVICE-ROLE KEY AT ALL: the Edge Function is deployed with
-- verify_jwt = false (see supabase/config.toml) because a database webhook
-- arrives with no user JWT. Without a token, anyone who learns the function URL
-- could POST a crafted body and push an arbitrary message to any user's
-- devices. Sending the service-role key keeps that door shut.

-- The body. SECURITY DEFINER because reading vault.decrypted_secrets and
-- calling net.http_post both need more than the caller's own rights, and the
-- trigger only ever fires on a row the caller was already allowed to write.
create or replace function public.lula_send_push()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  svc text;
begin
  -- Only notifications. This table also holds posts, comments, follows and
  -- everything else; without this guard every insert in the app would push.
  if new.collection <> 'notifications' then
    return new;
  end if;

  -- Everything below is wrapped, and that is not defensive padding.
  --
  -- An exception raised in an AFTER trigger aborts the whole transaction, so a
  -- missing pg_net extension, a Vault secret that was never created, or a
  -- network call that refuses to queue would each take the INSERT down with it
  -- - and the notification is already saved by then. The person would see no
  -- bell entry at all, over a push that was never going to work. A failed push
  -- must cost a notification that did not buzz, never the notification itself.
  begin
    select decrypted_secret into svc
    from vault.decrypted_secrets
    where name = 'service_role_key';

    if svc is null then
      raise warning 'lula_send_push: vault secret "service_role_key" is missing - push not sent';
      return new;
    end if;

    -- pg_net is asynchronous: the request is queued and the insert returns
    -- immediately. A slow or failing push therefore cannot slow down or roll
    -- back the notification that triggered it.
    perform net.http_post(
      url := 'https://srwdtguxdjsjlkaydhet.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || svc
      ),
      -- Shaped like a database webhook payload, which is what the function
      -- parses: it unwraps `record` and reads collection and payload from there.
      body := jsonb_build_object(
        'type', 'INSERT',
        'schema', 'public',
        'table', 'records',
        'record', to_jsonb(new)
      ),
      timeout_milliseconds := 5000
    );
  exception
    when others then
      -- Name the cause in the log so it is findable, then let the insert stand.
      raise warning 'lula_send_push: push not sent - % (%)', sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

comment on function public.lula_send_push() is
  'Sends a push when a notification row is inserted. Calls the send-push Edge Function via pg_net.';

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
