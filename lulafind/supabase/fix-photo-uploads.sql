-- Repair photo uploads. Idempotent: safe to run as many times as you like.
--
-- Supabase dashboard -> SQL editor -> New query -> paste -> Run.
--
-- WHY THIS EXISTS
--
-- "Could not upload media: new row violates row-level security policy" on a
-- photo, story or comment means the database refused the *storage* write, not
-- the record. The storage policy is:
--
--     (storage.foldername(name))[1] = public.lula_uid()
--
-- so the folder the app uploads into must equal the UID the database reads out
-- of the request token. There are exactly three ways that fails:
--
--   1. Supabase has not been told to trust the LulaFind Firebase project, so
--      `auth.jwt()` is the publishable anon key and lula_uid() is NULL.
--      -> Dashboard -> Authentication -> Third-party auth -> Firebase, and add
--         project id `lulafinds-app`. This is the most common cause.
--   2. The account's email is not verified, so lula_uid() refuses it on purpose.
--   3. The photos bucket or its policies were never created, or were dropped.
--
-- This script repairs 3 and reports on 1 and 2. It cannot repair 1 for you,
-- because it is a project setting rather than a row in the database.

-- ── 1. The bucket, recreated if missing ─────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. The four policies, recreated if missing ──────────────────────────────
-- Every one of them keys off public.lula_uid(), the single source of identity.
drop policy if exists "lula photos read" on storage.objects;
create policy "lula photos read" on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'photos'
  and (
    (storage.foldername(name))[1] = (select public.lula_uid())
    or public.lula_media_visible(name, (select public.lula_uid()))
  )
);

drop policy if exists "lula photos write" on storage.objects;
create policy "lula photos write" on storage.objects
for insert to anon, authenticated
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = (select public.lula_uid())
);

drop policy if exists "lula photos update" on storage.objects;
create policy "lula photos update" on storage.objects
for update to anon, authenticated
using (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = (select public.lula_uid())
)
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = (select public.lula_uid())
);

drop policy if exists "lula photos delete" on storage.objects;
create policy "lula photos delete" on storage.objects
for delete to anon, authenticated
using (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = (select public.lula_uid())
);

-- ── 3. Diagnose exactly which of the three it is ────────────────────────────
-- Called from the app as `await window.__lulaDebugStorage()`. Read-only.
create or replace function public.lula_debug_storage(app_uid text)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  with me as (
    select public.lula_uid() as db_uid
  ), tok as (
    select
      coalesce(auth.jwt()->>'iss', '(none)') as iss,
      coalesce(auth.jwt()->>'aud', '(none)') as aud,
      coalesce(auth.jwt()->>'email_verified', '(absent)') as email_verified
  ), pol as (
    select count(*) as n from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'lula photos%'
  ), buck as (
    select coalesce(bool_or(public = false), false) as private_ok,
           coalesce(bool_or(file_size_limit >= 5242880), false) as size_ok
    from storage.buckets where id = 'photos'
  )
  select jsonb_build_object(
    'dbUid', me.db_uid,
    'appUid', nullif(app_uid, ''),
    'idsMatch', me.db_uid is not null and me.db_uid = nullif(app_uid, ''),
    'tokenIssuer', tok.iss,
    'tokenAudience', tok.aud,
    'emailVerifiedClaim', tok.email_verified,
    'bucketExists', (select count(*) = 1 from storage.buckets where id = 'photos'),
    'bucketPrivate', buck.private_ok,
    'policiesInstalled', pol.n,
    'verdict',
      case
        when (select count(*) from storage.buckets where id = 'photos') = 0
          then 'FAIL - the photos bucket is missing. This script creates it.'
        when pol.n < 4
          then 'FAIL - the photos storage policies are missing. This script creates them.'
        when me.db_uid is null
          then 'FAIL - the database cannot read an identity from the request token. In Supabase: Authentication -> Third-party auth -> Firebase, add project id lulafinds-app. Re-run this check.'
        when me.db_uid <> nullif(app_uid, '')
          then 'FAIL - the database reads a different UID than the app is using. Sign out and sign in again.'
        else 'PASS - uploads should work.'
      end
  )
  from me, tok, pol, buck;
$$;
revoke all on function public.lula_debug_storage(text) from public;
grant execute on function public.lula_debug_storage(text) to anon, authenticated;

-- ── 4. What this database sees right now ────────────────────────────────────
-- Run this bit on its own after the above, from the SQL editor. In the editor
-- there is no request token, so a NULL uid_here is expected; the real test is
-- the `verdict` above, called from the app.
select
  'lula_uid() right now' as check,
  coalesce(public.lula_uid(), '(NULL - no request token in the SQL editor)') as uid_here;
select
  'photo storage policies' as check,
  count(*) || ' installed' as result
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'lula photos%';
