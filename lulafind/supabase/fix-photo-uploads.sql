-- Repair photo, video, story and comment uploads. Idempotent: run it as often
-- as you like.
--
-- Supabase dashboard -> SQL editor -> New query -> paste -> Run.
--
-- WHY THIS EXISTS
--
-- "Photo upload was refused by the database" means the database refused the
-- *storage* write, not the record. The rule is:
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
--   3. The photos bucket or its policies were never created.
--
-- An earlier version of this file created the policies but ALSO called
-- public.lula_media_visible() in the read policy. Databases created before the
-- helper refactor do not have that function (it arrived with the newer
-- schema.sql), and Postgres validates a policy's expression when the policy is
-- created - so the whole script failed, and because the SQL editor runs a
-- script as one transaction, NOTHING was applied: not the bucket, not the write
-- policy. Every upload was then refused. That is what this version fixes.
--
-- This file now depends on nothing but storage.objects, public.records and
-- public.lula_uid(). It creates the visibility helper it needs, written out in
-- full rather than calling helpers that may not exist. check-setup.sql check 1
-- proves lula_uid() is there.

-- ── 1. The bucket, recreated if missing ─────────────────────────────────────
-- 3 MB is the hard ceiling the app allows for any single attachment - a photo
-- may weigh 2 MB and a video 3 MB, a voice note 2 MB
-- (src/app/core/models/media-rules.ts), and the composer re-encodes photos down
-- to their limit before they ever get here. An
-- earlier version of this file allowed 25 MB, which quietly contradicted the
-- rules the app enforces in the UI.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,
  3145728,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime',
    -- Voice notes recorded in the app: Opus in WebM on Android and the web,
    -- AAC in MP4 on iOS. Without these the bucket refuses every recording the
    -- recorder makes, after the person has already spoken.
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/mpeg'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. Who may read somebody else's photo ───────────────────────────────────
-- True when this file is attached to a post, story or comment that `person` is
-- allowed to read - so a photo shows to the people who can see the case it
-- belongs to, and to nobody else. Written without helper calls on purpose.
create or replace function public.lula_media_visible(file_path text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select person is not null
    and person = (select public.lula_uid())
    and exists (
      select 1
      from public.records r
      cross join lateral jsonb_array_elements(
        (case when jsonb_typeof(r.payload->'media') = 'array' then r.payload->'media' else '[]'::jsonb end)
        || (case when jsonb_typeof(r.payload #> '{poster,media}') = 'object'
             then jsonb_build_array(r.payload #> '{poster,media}') else '[]'::jsonb end)
      ) as item(value)
      where r.collection in ('posts', 'stories', 'comments')
        and (
          item.value->>'src' = ('storage://photos/' || file_path)
          or split_part(regexp_replace(
            item.value->>'src',
            '^https?://[^/]+/storage/v1/object/(public|sign|authenticated)/photos/',
            ''
          ), '?', 1) = file_path
        )
        and (
          -- A photo on a case the viewer can read.
          (r.collection = 'posts' and (
            coalesce(r.payload->>'status', 'active') <> 'under_review'
            or r.payload->>'authorId' = person
            or coalesce((auth.jwt()->'app_metadata'->>'role') in ('admin', 'moderator'), false)
          ) and (
            coalesce((auth.jwt()->'app_metadata'->>'role') in ('admin', 'moderator'), false)
            or coalesce(r.payload->>'audience', 'public') = 'public'
            or r.payload->>'authorId' = person
            or (r.payload->>'audience' = 'followers' and exists (
                  select 1 from public.records f
                   where f.collection = 'follows'
                     and coalesce(f.payload->>'status', 'accepted') = 'accepted'
                     and f.payload->>'followerId' = person
                     and f.payload->>'followingId' = r.payload->>'authorId'))
            -- A Spotlight post is public reading; joining is only what allows posting.
            or (r.payload->>'audience' = 'surname'
              and coalesce(r.payload->>'spotlightId', '') <> '')
          ))
          -- A photo on a story the viewer can read.
          or (r.collection = 'stories' and (
            coalesce(r.payload->>'audience', 'public') = 'public'
            or r.payload->>'authorId' = person
            or (r.payload->>'audience' = 'followers' and exists (
                  select 1 from public.records f
                   where f.collection = 'follows'
                     and coalesce(f.payload->>'status', 'accepted') = 'accepted'
                     and f.payload->>'followerId' = person
                     and f.payload->>'followingId' = r.payload->>'authorId'))
            or (r.payload->>'audience' = 'surname' and exists (
                  select 1 from public.records s
                   where s.collection = 'spotlights'
                     and s.id = r.payload->>'spotlightId'
                     and person in (select jsonb_array_elements_text(coalesce(s.payload->'memberIds', '[]'::jsonb)))))
          ))
          -- A photo on a comment is readable when the case it hangs off is.
          or (r.collection = 'comments' and exists (
                select 1 from public.records p2
                 where p2.collection = 'posts'
                   and p2.id = r.payload->>'postId'
                   and coalesce(p2.payload->>'status', 'active') <> 'under_review'
                   and (coalesce(p2.payload->>'audience', 'public') = 'public'
                        or p2.payload->>'authorId' = person)))
        )
    );
$$;
revoke all on function public.lula_media_visible(text, text) from public;
grant execute on function public.lula_media_visible(text, text) to anon, authenticated;

-- ── 3. The four policies, recreated ─────────────────────────────────────────
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

-- ── 4. Diagnose exactly which of the three it is ────────────────────────────
-- Read-only. The app calls this itself when an upload is refused, so the verdict
-- appears on the screen rather than only in a console.
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
           coalesce(bool_or(file_size_limit > 0), false) as size_ok
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
          then 'FAIL - the database cannot read an identity from the request token. In Supabase: Authentication -> Third-party auth -> Firebase, add project id lulafinds-app. Then re-run this check.'
        when me.db_uid <> nullif(app_uid, '')
          then 'FAIL - the database reads a different UID than the app is using. Sign out and sign in again.'
        else 'PASS - uploads should work.'
      end
  )
  from me, tok, pol, buck;
$$;
revoke all on function public.lula_debug_storage(text) from public;
grant execute on function public.lula_debug_storage(text) to anon, authenticated;
