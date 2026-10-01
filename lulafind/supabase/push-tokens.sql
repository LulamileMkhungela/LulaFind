-- Push notification device tokens. Idempotent: safe to re-run.
--
-- Supabase dashboard -> SQL editor -> New query -> paste -> Run.
--
-- WHY A TABLE OF ITS OWN
--
-- Notifications themselves live in public.records under collection
-- 'notifications'. A device token is a different kind of thing and putting it
-- there would be wrong: a token is not owned content, one account holds several
-- (phone, tablet, a reinstalled app), and the sending side has to find every
-- token for a user without reading the user's data. So it gets its own table
-- with its own, much tighter, row-level security.
--
-- The table is the missing half of PushService. Until now the service registered
-- a device with FCM and stored the token in Preferences on the phone, which no
-- server can read - so push worked as far as "the phone got a token" and then
-- went nowhere. This table is where the token goes so something can send to it.
--
-- One row per device, keyed on the token itself. FCM reissues tokens (app
-- reinstall, restore to a new phone, token rotation), and a reissued token
-- belongs to whichever account is signed in when it arrives - so an upsert on
-- the token moves it to the right person instead of leaving a stale row that
-- would deliver someone else's notifications.
create table if not exists public.push_tokens (
  token text primary key,
  user_id text not null,
  platform text not null default 'unknown',
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Sending looks up "every token for this user", never "every token".
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

-- An old project may have this table with a uuid user_id from Supabase Auth.
-- Firebase UIDs are not UUIDs, so widen it before the policies compare against
-- lula_uid(), exactly as schema.sql does for public.records.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'push_tokens'
      and column_name = 'user_id' and data_type = 'uuid'
  ) then
    for pol in select policyname from pg_policies
      where schemaname = 'public' and tablename = 'push_tokens' loop
      execute format('drop policy if exists %I on public.push_tokens', pol.policyname);
    end loop;
    alter table public.push_tokens alter column user_id type text using user_id::text;
  end if;
end $$;

alter table public.push_tokens enable row level security;

-- ─── Who may touch a token ──────────────────────────────────────────────────
-- Strictly your own tokens. There is deliberately no read policy that reaches
-- another person's rows: nothing in the app needs to list anyone else's
-- devices, and a token is a capability to send that phone a notification.
--
-- The insert and update policies both check user_id, so a signed-in caller
-- cannot file a token against somebody else's account. lula_uid() returns NULL
-- when the request token is not a trusted Firebase token, and NULL never
-- equals anything, so an unsigned caller is refused - the same safe failure
-- every other write in this project relies on.
drop policy if exists "lula push tokens read" on public.push_tokens;
create policy "lula push tokens read" on public.push_tokens
for select to anon, authenticated
using (user_id = (select public.lula_uid()));

drop policy if exists "lula push tokens write" on public.push_tokens;
create policy "lula push tokens write" on public.push_tokens
for insert to anon, authenticated
with check (user_id = (select public.lula_uid()));

drop policy if exists "lula push tokens update" on public.push_tokens;
create policy "lula push tokens update" on public.push_tokens
for update to anon, authenticated
using (user_id = (select public.lula_uid()))
with check (user_id = (select public.lula_uid()));

drop policy if exists "lula push tokens delete" on public.push_tokens;
create policy "lula push tokens delete" on public.push_tokens
for delete to anon, authenticated
using (user_id = (select public.lula_uid()));

grant select, insert, update, delete on public.push_tokens to anon, authenticated;

-- ─── Sign-out hygiene ───────────────────────────────────────────────────────
-- Called when an account signs out on a device. Deletes just this device's
-- token, so signing out on a phone does not silence the tablet. Returns how
-- many rows went, which is 0 if the token was already gone or never filed.
create or replace function public.lula_forget_push_token(device_token text)
returns integer language sql security definer set search_path = pg_catalog as $$
  with gone as (
    delete from public.push_tokens
    where token = device_token
      and user_id = (select public.lula_uid())
    returning 1
  )
  select count(*)::integer from gone;
$$;
revoke all on function public.lula_forget_push_token(text) from public;
grant execute on function public.lula_forget_push_token(text) to anon, authenticated;

-- ─── Is it wired up? ────────────────────────────────────────────────────────
-- Read-only. Run after the above; a NULL uid here is expected in the SQL
-- editor because there is no request token, the real check is the count.
select
  'push token policies' as check,
  count(*) || ' installed' as result
from pg_policies
where schemaname = 'public' and tablename = 'push_tokens';
