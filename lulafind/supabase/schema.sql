-- LulaFind's Supabase data layer. Safe to re-run on a new or existing project.
-- Domain objects live in public.records; RLS is the source of truth for access.
-- Accounts are Firebase Auth (Third-Party Auth); see lula_uid() below.
create table if not exists public.records (
  collection text not null,
  id text not null,
  owner_id text,
  payload jsonb not null,
  updated_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  primary key (collection, id)
);

create index if not exists records_collection_updated_idx
  on public.records (collection, updated_at desc);
create index if not exists records_story_id_idx
  on public.records (collection, (payload->>'storyId'));

-- Upgrading a project that used Supabase Auth: owner ids become text so they
-- can hold Firebase UIDs. Policies that mention owner_id must go first; they
-- are all recreated further down.
do $$
declare pol record;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'records' and column_name = 'owner_id' and data_type = 'uuid'
  ) then
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'records' loop
      execute format('drop policy if exists %I on public.records', pol.policyname);
    end loop;
    alter table public.records alter column owner_id type text using owner_id::text;
  end if;
end $$;

alter table public.records enable row level security;
grant select on public.records to anon, authenticated;
grant select, insert, update, delete on public.records to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.records;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ─── Who is calling ─────────────────────────────────────────────────────────
-- Accounts live in Firebase Auth. Supabase verifies the Firebase ID token
-- (Dashboard → Authentication → Third-Party Auth → Firebase, project
-- "lulafinds-app") and this function reads the caller's Firebase UID from it.
-- Only this Firebase project, and only verified email addresses, count.
-- Firebase UIDs are not UUIDs, so never use auth.uid() in this project.
--
-- Two token shapes are accepted:
--   (a) the raw Firebase ID token - iss/aud name this Firebase project;
--   (b) a Supabase session Supabase minted from that Firebase identity.
-- The publishable anon key is a JWT too, so it is refused explicitly: without
-- that guard every anonymous visitor would be handed the uid "anonymous" and
-- could write rows. If this function ever returns NULL, every write is denied
-- by row-level security - that is the intended, safe failure.
create or replace function public.lula_uid()
returns text language sql stable set search_path = pg_catalog as $$
  with c as (
    select
      coalesce(auth.jwt(), '{}'::jsonb) as jwt,
      coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb) as meta
  )
  select nullif(
    case
      when c.jwt->>'iss' = 'https://securetoken.google.com/lulafinds-app'
       and c.jwt->>'aud' = 'lulafinds-app'
       and coalesce(c.jwt->>'email_verified', 'false') = 'true'
        then c.jwt->>'sub'

      when nullif(c.jwt->>'sub', '') is not null
       and c.jwt->>'sub' <> 'anonymous'
       and coalesce(c.jwt->>'role', '') <> 'anon'
       and (
         c.jwt->>'iss' = 'https://srwdtguxdjsjlkaydhet.supabase.co/auth/v1'
         or c.meta->>'sign_in_provider' like 'firebase%'
         or c.jwt->'app_metadata'->>'provider' like 'firebase%'
       )
       and coalesce(c.jwt->>'email_verified', c.meta->>'email_verified', 'true') = 'true'
        then c.jwt->>'sub'
    end,
    ''
  )
  from c;
$$;
revoke all on function public.lula_uid() from public;
grant execute on function public.lula_uid() to anon, authenticated;

-- Owner and timestamp are the server's business, not the client's. This runs
-- before every insert and update so a row can never land with a null owner_id,
-- which is what a row-level-security rejection on insert really means.
create or replace function public.lula_touch_record()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  who text := public.lula_uid();
  claimed text;
begin
  if new.owner_id is null and who is not null then
    claimed := coalesce(
      new.payload->>'authorId',
      new.payload->>'viewerId',
      new.payload->>'fromUserId',
      new.payload->>'userId',
      new.payload->>'ownerId',
      new.payload->>'followerId',
      case when new.collection = 'users' then new.id else null end
    );
    -- Adopt an owner only when it is provably the caller.
    if claimed is null or claimed = who then
      new.owner_id := who;
    end if;
  end if;
  new.updated_at := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end;
$$;
revoke all on function public.lula_touch_record() from public;
grant execute on function public.lula_touch_record() to anon, authenticated;

drop trigger if exists lula_touch_record on public.records;
create trigger lula_touch_record
before insert or update on public.records
for each row execute function public.lula_touch_record();

-- Read-only self-check, called from the app as `window.__lulaDebugWhoAmI()`.
--
-- It answers the question every write policy actually depends on: does the
-- database see the same person the app does, and is that account allowed to
-- write? `suspended` is included because a suspended account is refused by the
-- insert policy for a different reason than a UID mismatch, and the two look
-- identical from the app ("violates row-level security policy").
--
-- It never writes. SECURITY DEFINER so it can read the caller's own `users`
-- row, which the insert policy also reads.
create or replace function public.lula_debug_identity(app_uid text)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  with me as (
    select public.lula_uid() as db_uid
  ), prof as (
    select
      coalesce((select r.payload->>'suspended' from public.records r
                where r.collection = 'users' and r.id = me.db_uid), 'false') = 'true' as suspended
    from me
  )
  select jsonb_build_object(
    'dbUid', me.db_uid,
    'appUid', nullif(app_uid, ''),
    'dbUidMatchesAppUid', me.db_uid is not null and me.db_uid = nullif(app_uid, ''),
    'suspended', prof.suspended,
    'canWrite', me.db_uid is not null and not prof.suspended,
    'postInteractRpc', to_regprocedure('public.lula_post_interact(text, jsonb)') is not null,
    'spotlightRpc', to_regprocedure('public.lula_link_spotlight_post(text, text, boolean)') is not null
  )
  from me, prof;
$$;
revoke all on function public.lula_debug_identity(text) from public;
grant execute on function public.lula_debug_identity(text) to anon, authenticated;

-- SECURITY DEFINER helpers avoid recursive RLS when one collection checks a
-- related row in records. The identity arguments are always clamped to lula_uid()
-- so calling these helpers through PostgREST cannot probe another account.
--
-- Every helper requires a *real* identity. `person is not distinct from uid`
-- was true when both were NULL, which let an anonymous visitor satisfy the
-- identity gate. Public rows stay public through the explicit audience checks,
-- so guest browsing is unaffected.
create or replace function public.lula_is_admin()
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select public.lula_uid() is not null
    and coalesce((auth.jwt()->>'lulafind_role') in ('admin', 'moderator'), false);
$$;

create or replace function public.lula_is_self(person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select person is not null
    and public.lula_uid() is not null
    and person = public.lula_uid();
$$;

create or replace function public.lula_follows_accepted(follower text, following text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select public.lula_is_self(follower)
    and exists (
      select 1 from public.records f
      where f.collection = 'follows'
        and coalesce(f.payload->>'status', 'accepted') = 'accepted'
        and f.payload->>'followerId' = follower
        and f.payload->>'followingId' = following
    );
$$;

create or replace function public.lula_spotlight_member(person text, spotlight text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select public.lula_is_self(person)
    and exists (
      select 1 from public.records s
      where s.collection = 'spotlights'
        and s.id = spotlight
        and person in (select jsonb_array_elements_text(coalesce(s.payload->'memberIds', '[]'::jsonb)))
    );
$$;

create or replace function public.lula_post_visible(post_id text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select exists (
      select 1 from public.records p
      where p.collection = 'posts'
        and p.id = post_id
        -- Treat legacy rows with no status as active; NULL must not hide them.
        and (coalesce(p.payload->>'status', 'active') <> 'under_review'
          or p.payload->>'authorId' = person
          or public.lula_is_admin())
        and (
          public.lula_is_admin()
          -- A public case is readable by anyone, signed in or browsing as a guest.
          or coalesce(p.payload->>'audience', 'public') = 'public'
          or public.lula_is_self(p.payload->>'authorId')
          or (p.payload->>'audience' = 'followers'
            and public.lula_is_self(person)
            and public.lula_follows_accepted(person, p.payload->>'authorId'))
          or (p.payload->>'audience' = 'surname'
            and public.lula_is_self(person)
            and public.lula_spotlight_member(person, p.payload->>'spotlightId'))
        )
    );
$$;

create or replace function public.lula_story_visible(story_id text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select exists (
      select 1 from public.records s
      where s.collection = 'stories'
        and s.id = story_id
        and (
          coalesce(s.payload->>'audience', 'public') = 'public'
          or public.lula_is_self(s.payload->>'authorId')
          -- A follower is someone this viewer follows, not someone who follows the viewer.
          or (s.payload->>'audience' = 'followers'
            and public.lula_is_self(person)
            and public.lula_follows_accepted(person, s.payload->>'authorId'))
          or (s.payload->>'audience' = 'surname'
            and public.lula_is_self(person)
            and public.lula_spotlight_member(person, s.payload->>'spotlightId'))
        )
    );
$$;

create or replace function public.lula_story_owner(story_id text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select public.lula_is_self(person)
    and exists (
      select 1 from public.records s
      where s.collection = 'stories'
        and s.id = story_id
        and s.payload->>'authorId' = person
    );
$$;

create or replace function public.lula_in_thread(thread_id text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select public.lula_is_self(person)
    and exists (
      select 1 from public.records t
      where t.collection = 'threads'
        and t.id = thread_id
        and person in (select jsonb_array_elements_text(coalesce(t.payload->'participantIds', '[]'::jsonb)))
    );
$$;

-- Signed image URLs are issued only if this caller can read the story, post, or
-- comment (through its parent post) that references the object. Keep the bucket private.
create or replace function public.lula_media_visible(file_path text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select public.lula_is_self(person)
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
          (r.collection = 'posts' and public.lula_post_visible(r.id, person))
          or (r.collection = 'stories' and public.lula_story_visible(r.id, person))
          or (r.collection = 'comments' and public.lula_post_visible(r.payload->>'postId', person))
        )
    );
$$;

-- Public-profile read surface; email, role fields, and unconsented location are not exposed.
create or replace view public.lula_user_profiles_public with (security_barrier = true) as
with profile_source as (
  select
    r.id,
    r.payload,
    r.updated_at,
    coalesce(r.payload #>> '{privacy,showLocation}', 'false') = 'true' as show_location,
    coalesce(r.payload #>> '{privacy,showStats}', 'true') = 'true' as show_stats,
    coalesce(r.payload #>> '{privacy,showSpotlights}', 'true') = 'true' as show_spotlights,
    coalesce(r.payload #>> '{privacy,allowMessages}', 'true') = 'true' as allow_messages,
    coalesce(r.payload #>> '{privacy,requireFollowApproval}', 'false') = 'true' as require_follow_approval
  from public.records r
  where r.collection = 'users'
), profile_flags as (
  select p.*,
    p.show_location
      and coalesce(p.payload #>> '{checkIn,liveShareOn}', 'false') = 'true'
      and case
        when p.payload #>> '{checkIn,liveUntil}' ~ '^[0-9]+$'
          then (p.payload #>> '{checkIn,liveUntil}')::bigint > floor(extract(epoch from now()) * 1000)::bigint
        else false
      end as show_live_location
  from profile_source p
)
select
  id,
  jsonb_build_object(
    'id', payload->'id',
    'email', '',
    'displayName', payload->'displayName',
    'handle', payload->'handle',
    'avatarHue', payload->'avatarHue',
    'avatarUrl', payload->'avatarUrl',
    'bio', payload->'bio',
    'province', case when show_location then payload->'province' else 'null'::jsonb end,
    'town', case when show_location then coalesce(payload->'town', '""'::jsonb) else '""'::jsonb end,
    'surname', payload->'surname',
    'createdAt', payload->'createdAt',
    'verified', coalesce(payload->'verified', 'false'::jsonb),
    'anonymous', coalesce(payload->'anonymous', 'false'::jsonb),
    'findableProfile', coalesce(payload->'findableProfile', 'false'::jsonb),
    'safetyBeacon', coalesce(payload->'safetyBeacon', 'false'::jsonb),
    'lastBeaconAt', 'null'::jsonb,
    'followers', case when show_stats then coalesce(payload->'followers', '0'::jsonb) else '0'::jsonb end,
    'following', case when show_stats then coalesce(payload->'following', '0'::jsonb) else '0'::jsonb end,
    'karma', case when show_stats then coalesce(payload->'karma', '0'::jsonb) else '0'::jsonb end,
    'contributorCredits', case when show_stats then coalesce(payload->'contributorCredits', '0'::jsonb) else '0'::jsonb end,
    'onboarded', coalesce(payload->'onboarded', 'false'::jsonb),
    'blockedUserIds', '[]'::jsonb,
    'spotlightIds', case when show_spotlights then coalesce(payload->'spotlightIds', '[]'::jsonb) else '[]'::jsonb end,
    'isAdmin', 'false'::jsonb,
    'suspended', 'false'::jsonb,
    'privacy', jsonb_build_object(
      'showLocation', show_location,
      'showStats', show_stats,
      'showSpotlights', show_spotlights,
      'allowMessages', allow_messages,
      'autoShareLocation', false,
      'notifyFollowersOnExpiry', false,
      'requireFollowApproval', require_follow_approval
    ),
    'checkIn', case
      when payload->'checkIn' is null or payload->'checkIn' = 'null'::jsonb then 'null'::jsonb
      else jsonb_build_object(
        'status', payload #> '{checkIn,status}',
        'note', case when show_location then coalesce(payload #> '{checkIn,note}', '""'::jsonb) else '""'::jsonb end,
        'at', payload #> '{checkIn,at}',
        'location', case when show_live_location then coalesce(payload #> '{checkIn,location}', 'null'::jsonb) else 'null'::jsonb end,
        'liveUntil', case when show_live_location then coalesce(payload #> '{checkIn,liveUntil}', 'null'::jsonb) else 'null'::jsonb end,
        'liveShareOn', show_live_location
      )
    end
  ) as payload,
  updated_at
from profile_flags;

revoke all on public.lula_user_profiles_public from public;
grant select on public.lula_user_profiles_public to anon, authenticated;

-- Enforce follow approval on the database, not just in the Follow button.
create or replace function public.lula_follow_insert_allowed(follower text, following text, new_status text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select public.lula_is_self(follower)
    and following is not null
    and following is distinct from (select public.lula_uid())
    and new_status in ('pending', 'accepted')
    and exists (
      select 1 from public.records u
      where u.collection = 'users'
        and u.id = following
        and case
          when u.payload #>> '{privacy,requireFollowApproval}' = 'true'
            then new_status = 'pending'
          else new_status = 'accepted'
        end
    );
$$;

revoke all on function public.lula_is_admin() from public;
revoke all on function public.lula_is_self(text) from public;
revoke all on function public.lula_follows_accepted(text, text) from public;
revoke all on function public.lula_spotlight_member(text, text) from public;
revoke all on function public.lula_post_visible(text, text) from public;
revoke all on function public.lula_story_visible(text, text) from public;
revoke all on function public.lula_story_owner(text, text) from public;
revoke all on function public.lula_in_thread(text, text) from public;
revoke all on function public.lula_follow_insert_allowed(text, text, text) from public;
revoke all on function public.lula_media_visible(text, text) from public;
grant execute on function public.lula_is_admin() to anon, authenticated;
grant execute on function public.lula_is_self(text) to anon, authenticated;
grant execute on function public.lula_follows_accepted(text, text) to anon, authenticated;
grant execute on function public.lula_spotlight_member(text, text) to anon, authenticated;
grant execute on function public.lula_post_visible(text, text) to anon, authenticated;
grant execute on function public.lula_story_visible(text, text) to anon, authenticated;
grant execute on function public.lula_story_owner(text, text) to anon, authenticated;
grant execute on function public.lula_in_thread(text, text) to anon, authenticated;
grant execute on function public.lula_follow_insert_allowed(text, text, text) to anon, authenticated;
grant execute on function public.lula_media_visible(text, text) to anon, authenticated;

-- Remove earlier additive policies: permissive RLS policies are ORed together.
drop policy if exists "lula stories audience read" on public.records;
drop policy if exists "lula story replies read" on public.records;
drop policy if exists "lula story views read" on public.records;
drop policy if exists "lula spotlight update" on public.records;
drop policy if exists "lula spotlight owner update" on public.records;
drop policy if exists "lula reports read" on public.records;
drop policy if exists "lula follow remove" on public.records;

drop policy if exists "lula read" on public.records;
create policy "lula read" on public.records
for select to anon, authenticated
using (
  (collection = 'posts' and public.lula_post_visible(id, (select public.lula_uid())))
  or (
    collection = 'comments'
    and (payload->>'authorId' = (select public.lula_uid())
      or public.lula_post_visible(payload->>'postId', (select public.lula_uid())))
  )
  or collection in ('spotlights', 'tips')
  -- Accepted social edges are public; pending requests are visible only to their two parties.
  or (
    collection = 'follows'
    and (coalesce(payload->>'status', 'accepted') = 'accepted'
      or payload->>'followerId' = (select public.lula_uid())
      or payload->>'followingId' = (select public.lula_uid()))
  )
  or (collection = 'stories' and public.lula_story_visible(id, (select public.lula_uid())))
  or (
    collection = 'story_replies'
    and (payload->>'authorId' = (select public.lula_uid())
      or public.lula_story_owner(payload->>'storyId', (select public.lula_uid())))
  )
  or (
    collection = 'story_views'
    and (payload->>'viewerId' = (select public.lula_uid())
      or public.lula_story_owner(payload->>'storyId', (select public.lula_uid())))
  )
  or (collection = 'users'
    and (id = (select public.lula_uid()) or public.lula_is_admin()))
  or (collection = 'lookouts' and public.lula_lookout_visible(id, (select public.lula_uid())))
  or (collection = 'notifications' and payload->>'userId' = (select public.lula_uid()))
  or (collection = 'threads' and public.lula_in_thread(id, (select public.lula_uid())))
  or (collection = 'messages' and public.lula_in_thread(payload->>'threadId', (select public.lula_uid())))
);

drop policy if exists "lula insert" on public.records;
create policy "lula insert" on public.records
for insert to anon, authenticated
with check (
  public.lula_is_admin()
  or (
    -- lula_touch_record() fills a missing owner_id before this check runs, so
    -- a null here is only tolerated when the payload names the caller.
    (owner_id is null or owner_id = (select public.lula_uid()))
    and (
      (collection = 'users'
        and id = (select public.lula_uid())
        and payload->>'id' = (select public.lula_uid())
        and coalesce(payload->>'isAdmin', 'false') = 'false'
        and coalesce(payload->>'suspended', 'false') = 'false')
      or (collection = 'posts'
        and payload->>'authorId' = (select public.lula_uid())
        and (payload->>'spotlightId' is null
          or public.lula_spotlight_member((select public.lula_uid()), payload->>'spotlightId'))
        and (coalesce(payload->>'audience', 'public') <> 'surname'
          or payload->>'spotlightId' is not null))
      or (collection = 'comments'
        and payload->>'authorId' = (select public.lula_uid())
        and public.lula_post_visible(payload->>'postId', (select public.lula_uid())))
      or (collection = 'stories'
        and payload->>'authorId' = (select public.lula_uid())
        and coalesce(payload->>'audience', 'public') in ('public', 'followers', 'surname')
        and (coalesce(payload->>'audience', 'public') <> 'surname'
          or public.lula_spotlight_member((select public.lula_uid()), payload->>'spotlightId')))
      or (collection = 'story_replies'
        and payload->>'authorId' = (select public.lula_uid())
        and public.lula_story_visible(payload->>'storyId', (select public.lula_uid())))
      or (collection = 'story_views'
        and payload->>'viewerId' = (select public.lula_uid())
        and public.lula_story_visible(payload->>'storyId', (select public.lula_uid())))
      or (collection = 'follows'
        and public.lula_follow_insert_allowed(
          payload->>'followerId', payload->>'followingId', payload->>'status'))
      or (collection = 'threads'
        and (select public.lula_uid()) in (
          select jsonb_array_elements_text(coalesce(payload->'participantIds', '[]'::jsonb))))
      or (collection = 'messages'
        and public.lula_in_thread(payload->>'threadId', (select public.lula_uid()))
        and (payload->>'fromUserId' = (select public.lula_uid()) or payload->>'kind' = 'system'))
      -- Notifications are written by the actor, then read only by their recipient.
      or (collection = 'notifications' and nullif(payload->>'userId', '') is not null)
      or (collection = 'spotlights' and payload->>'ownerId' = (select public.lula_uid()))
      or (collection = 'reports' and payload->>'byUserId' = (select public.lula_uid()))
      or (collection = 'lookouts' and payload->>'userId' = (select public.lula_uid()))
    )
  )
);

drop policy if exists "lula update" on public.records;
create policy "lula update" on public.records
for update to anon, authenticated
using (
  public.lula_is_admin()
  or (collection in ('posts', 'comments', 'stories')
    and owner_id = (select public.lula_uid())
    and payload->>'authorId' = (select public.lula_uid()))
  or (collection = 'users'
    and id = (select public.lula_uid())
    and coalesce(payload->>'suspended', 'false') = 'false')
  or (collection = 'notifications' and payload->>'userId' = (select public.lula_uid()))
  or (collection = 'follows'
    and payload->>'followingId' = (select public.lula_uid())
    and coalesce(payload->>'status', 'pending') = 'pending')
  or (collection = 'spotlights' and payload->>'ownerId' = (select public.lula_uid()))
  or (collection = 'threads' and public.lula_in_thread(id, (select public.lula_uid())))
  or (collection = 'messages' and public.lula_in_thread(payload->>'threadId', (select public.lula_uid())))
  -- A follower's answer is not a plain update: it can flag someone, so it goes
  -- through lula_answer_lookout. Only the person themselves edits a lookout.
  or (collection = 'lookouts' and payload->>'userId' = (select public.lula_uid()))
)
with check (
  public.lula_is_admin()
  or (
    (collection in ('posts', 'comments', 'stories')
      and owner_id = (select public.lula_uid())
      and payload->>'authorId' = (select public.lula_uid())
      and (collection <> 'posts'
        or (payload->>'spotlightId' is null
          or public.lula_spotlight_member((select public.lula_uid()), payload->>'spotlightId')))
      and (collection <> 'posts'
        or coalesce(payload->>'audience', 'public') <> 'surname'
        or payload->>'spotlightId' is not null))
    or (collection = 'users'
      and id = (select public.lula_uid())
      and payload->>'id' = (select public.lula_uid())
      and coalesce(payload->>'isAdmin', 'false') = 'false'
      and coalesce(payload->>'suspended', 'false') = 'false')
    or (collection = 'notifications' and payload->>'userId' = (select public.lula_uid()))
    or (collection = 'follows'
      and payload->>'followingId' = (select public.lula_uid())
      and payload->>'status' = 'accepted'
      and id = 'f_' || (payload->>'followerId') || '_' || (payload->>'followingId'))
    or (collection = 'spotlights' and payload->>'ownerId' = (select public.lula_uid()))
    or (collection = 'threads' and public.lula_in_thread(id, (select public.lula_uid())))
    or (collection = 'messages'
      and public.lula_in_thread(payload->>'threadId', (select public.lula_uid()))
      and (payload->>'fromUserId' = (select public.lula_uid()) or payload->>'kind' = 'system'))
    or (collection = 'lookouts' and payload->>'userId' = (select public.lula_uid()))
  )
);

-- Joining a surname community is not the owner's job, so a member may rewrite
-- exactly one thing in the row: their own name in memberIds. Everything else in
-- the payload must come back unchanged, which is what makes this safe to open to
-- any signed-in person. The long reasoning is in post-interactions.sql.
drop policy if exists "lula spotlight join" on public.records;
create policy "lula spotlight join" on public.records
for update to authenticated
using (
  collection = 'spotlights'
  and (select public.lula_uid()) is not null
)
with check (
  collection = 'spotlights'
  and (select public.lula_uid()) is not null
  and (payload - 'memberIds' - 'followers') = (old.payload - 'memberIds' - 'followers')
  and not exists (
    select 1 from jsonb_array_elements_text(coalesce(payload->'memberIds', '[]'::jsonb)) as added(id)
    where added.id <> (select public.lula_uid())
      and not (coalesce(old.payload->'memberIds', '[]'::jsonb) @> to_jsonb(added.id))
  )
  and not exists (
    select 1 from jsonb_array_elements_text(coalesce(old.payload->'memberIds', '[]'::jsonb)) as gone(id)
    where gone.id <> (select public.lula_uid())
      and not (coalesce(payload->'memberIds', '[]'::jsonb) @> to_jsonb(gone.id))
  )
  and coalesce((payload->>'followers')::int, 0)
      <= coalesce((old.payload->>'followers')::int, 0) + 1
);

drop policy if exists "lula delete" on public.records;
create policy "lula delete" on public.records
for delete to anon, authenticated
using (
  public.lula_is_admin()
  or (owner_id = (select public.lula_uid()) and collection <> 'users')
  or (collection = 'users'
    and id = (select public.lula_uid())
    and coalesce(payload->>'suspended', 'false') = 'false')
  or (collection = 'notifications' and payload->>'userId' = (select public.lula_uid()))
  or (collection = 'follows'
    and (payload->>'followerId' = (select public.lula_uid())
      or payload->>'followingId' = (select public.lula_uid())))
  or (collection = 'lookouts' and payload->>'userId' = (select public.lula_uid()))
);

-- Spotlight membership changes go through a narrow SECURITY DEFINER function
-- rather than granting every signed-in user permission to rewrite communities.
create or replace function public.lula_set_spotlight_membership(spotlight_id text, joining boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  current_user_id text := (select public.lula_uid());
  current_payload jsonb;
  next_members jsonb;
begin
  if current_user_id is null then
    raise exception 'Sign in to change Spotlight membership';
  end if;

  select r.payload into current_payload
  from public.records r
  where r.collection = 'spotlights' and r.id = spotlight_id
  for update;

  if current_payload is null then
    raise exception 'That Spotlight is not available';
  end if;
  if exists (
    select 1 from public.records u
    where u.collection = 'users' and u.id = current_user_id and u.payload->>'suspended' = 'true'
  ) then
    raise exception 'Your account is suspended, so you cannot change Spotlight membership';
  end if;

  if joining then
    select coalesce(current_payload->'memberIds', '[]'::jsonb) || jsonb_build_array(current_user_id)
      into next_members
    where not (coalesce(current_payload->'memberIds', '[]'::jsonb) @> jsonb_build_array(current_user_id));
    if next_members is null then
      next_members := coalesce(current_payload->'memberIds', '[]'::jsonb);
    end if;
  else
    if current_payload->>'ownerId' = current_user_id then
      raise exception 'The community owner cannot leave their own Spotlight';
    end if;
    select coalesce(jsonb_agg(value), '[]'::jsonb) into next_members
    from jsonb_array_elements_text(coalesce(current_payload->'memberIds', '[]'::jsonb)) as members(value)
    where value <> current_user_id;
  end if;

  current_payload := jsonb_set(current_payload, '{memberIds}', next_members, true);
  current_payload := jsonb_set(current_payload, '{followers}', to_jsonb(jsonb_array_length(next_members)), true);

  update public.records r
  set payload = current_payload,
      updated_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  where r.collection = 'spotlights' and r.id = spotlight_id;

  return current_payload;
end;
$$;
revoke all on function public.lula_set_spotlight_membership(text, boolean) from public;
grant execute on function public.lula_set_spotlight_membership(text, boolean) to anon, authenticated;

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

-- ─── Member interactions on posts (see post-interactions.sql) ───
create or replace function public.lula_post_interact(post_id text, next jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  me text := (select public.lula_uid());
  cur jsonb;
  k text;
  allowed text[] := array[
    'voterIds', 'upvotes', 'commentCount', 'views', 'shares', 'lookingIds',
    'searchParty', 'danger', 'khumbu', 'flags', 'events', 'lastComment', 'updatedAt', 'status', 'outcome'
  ];
  my_old text;
  my_new text;
  claimed_old text;
  claimed_new text;
  is_claimed boolean;
  merged jsonb;
  last_comment jsonb;
  n_old int;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  if exists (
    select 1 from public.records u
    where u.collection = 'users' and u.id = me and u.payload->>'suspended' = 'true'
  ) then
    raise exception 'Your account is suspended';
  end if;

  select r.payload into cur from public.records r
  where r.collection = 'posts' and r.id = post_id
  for update;
  if cur is null or not public.lula_post_visible(post_id, me) then
    raise exception 'That post is not available';
  end if;
  if cur->>'authorId' = me or public.lula_is_admin() then
    raise exception 'Authors and admins save posts directly';
  end if;

  -- 1. Nothing outside the shared fields may change.
  for k in select jsonb_object_keys(cur || next) loop
    if not (k = any(allowed)) and (cur->k) is distinct from (next->k) then
      raise exception 'You cannot change % on someone else''s post', k;
    end if;
  end loop;

  -- 2. Votes: only your own entry, and the counts are rebuilt here.
  if (coalesce(cur->'voterIds', '{}'::jsonb) - me) is distinct from (coalesce(next->'voterIds', '{}'::jsonb) - me) then
    raise exception 'You can only change your own vote';
  end if;
  my_old := cur->'voterIds'->>me;
  my_new := next->'voterIds'->>me;
  if my_new is not null and my_new not in ('up', 'like', 'support', 'sad') then
    raise exception 'Unknown vote';
  end if;
  merged := cur;
  merged := jsonb_set(merged, '{voterIds}', coalesce(next->'voterIds', '{}'::jsonb), true);
  merged := jsonb_set(merged, '{upvotes}', to_jsonb(greatest(0,
    coalesce((cur->>'upvotes')::int, 0) + (case when my_new is not null then 1 else 0 end) - (case when my_old is not null and my_old <> 'down' then 1 else 0 end))), true);

  -- 3. Counters: comments are counted, views and shares go up by one at most.
  merged := jsonb_set(merged, '{commentCount}', to_jsonb((
    select count(*) from public.records c where c.collection = 'comments' and c.payload->>'postId' = post_id)), true);

  -- Feed previews may name a saved top-level comment, never invented text.
  -- On deletion, the preview may be cleared only when no top-level comment remains.
  if (cur->'lastComment') is distinct from (next->'lastComment') then
    if next->'lastComment' is null or next->'lastComment' = 'null'::jsonb then
      if exists (
        select 1 from public.records c
        where c.collection = 'comments' and c.payload->>'postId' = post_id
          and c.payload->>'parentId' is null
      ) then
        raise exception 'The latest comment preview cannot be cleared while comments remain';
      end if;
      merged := jsonb_set(merged, '{lastComment}', 'null'::jsonb, true);
    else
      select jsonb_build_object(
        'userId', c.payload->>'authorId',
        'displayName', coalesce((
          select u.payload->>'displayName' from public.records u
          where u.collection = 'users' and u.id = c.payload->>'authorId'
        ), 'Someone'),
        'body', left(c.payload->>'body', 280),
        'at', c.payload->'createdAt'
      ) into last_comment
      from public.records c
      where c.collection = 'comments'
        and c.payload->>'postId' = post_id
        and c.payload->>'parentId' is null
        and c.payload->>'createdAt' = next->'lastComment'->>'at'
        and left(c.payload->>'body', 280) = next->'lastComment'->>'body'
      limit 1;
      if last_comment is null then
        raise exception 'The latest comment preview must match a saved comment';
      end if;
      merged := jsonb_set(merged, '{lastComment}', last_comment, true);
    end if;
  end if;
  if coalesce((next->>'views')::int, 0) = coalesce((cur->>'views')::int, 0) + 1 then
    merged := jsonb_set(merged, '{views}', next->'views', true);
  end if;
  if coalesce((next->>'shares')::int, 0) = coalesce((cur->>'shares')::int, 0) + 1 then
    merged := jsonb_set(merged, '{shares}', next->'shares', true);
  end if;

  -- 4. "I'm looking": add or remove only yourself.
  if (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from jsonb_array_elements_text(coalesce(cur->'lookingIds', '[]'::jsonb)) v where v <> me)
     is distinct from
     (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from jsonb_array_elements_text(coalesce(next->'lookingIds', '[]'::jsonb)) v where v <> me) then
    raise exception 'You can only change your own looking status';
  end if;
  merged := jsonb_set(merged, '{lookingIds}', coalesce(next->'lookingIds', '[]'::jsonb), true);

  -- 5. Search party: members claim or finish zones; the meeting details stay the family's.
  if cur->'searchParty' is not null and jsonb_typeof(cur->'searchParty') = 'object' then
    if (cur->'searchParty' - 'zones') is distinct from (coalesce(next->'searchParty', 'null'::jsonb) - 'zones') then
      raise exception 'Only the family can change the search party';
    end if;
    merged := jsonb_set(merged, '{searchParty}', next->'searchParty', true);
  elsif (cur->'searchParty') is distinct from (next->'searchParty') then
    raise exception 'Only the family can open a search party';
  end if;

  -- 6. Danger: "still happening" / "cleared" lists change by you only.
  if (cur->'danger') is distinct from (next->'danger') then
    if cur->'danger' is null or jsonb_typeof(cur->'danger') <> 'object' then
      raise exception 'This is not a danger alert';
    end if;
    if (cur->'danger' - 'stillIds' - 'clearIds' - 'clearedAt') is distinct from (next->'danger' - 'stillIds' - 'clearIds' - 'clearedAt')
      or (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from jsonb_array_elements_text(coalesce(cur->'danger'->'stillIds', '[]'::jsonb)) v where v <> me)
         is distinct from
         (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from jsonb_array_elements_text(coalesce(next->'danger'->'stillIds', '[]'::jsonb)) v where v <> me)
      or (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from jsonb_array_elements_text(coalesce(cur->'danger'->'clearIds', '[]'::jsonb)) v where v <> me)
         is distinct from
         (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from jsonb_array_elements_text(coalesce(next->'danger'->'clearIds', '[]'::jsonb)) v where v <> me) then
      raise exception 'You can only add your own danger update';
    end if;
    merged := jsonb_set(merged, '{danger}', next->'danger', true);
  end if;

  -- 7. KhumbulEkhaya: anyone answers "are they wanted"; only the person in the
  --    post can claim it ("this is me") and then answer for themselves.
  claimed_old := cur->'khumbu'->>'claimedByUserId';
  claimed_new := next->'khumbu'->>'claimedByUserId';
  if claimed_old is distinct from claimed_new and not (claimed_old is null and claimed_new = me) then
    raise exception 'Only the person in the post can claim it';
  end if;
  is_claimed := coalesce(claimed_new = me, false);
  if (cur->'khumbu') is distinct from (next->'khumbu') then
    if (coalesce(cur->'khumbu', '{}'::jsonb) - 'claimedByUserId' - 'claimedAt' - 'subjectResponse' - 'subjectNote' - 'wantedAnswers')
       is distinct from (coalesce(next->'khumbu', '{}'::jsonb) - 'claimedByUserId' - 'claimedAt' - 'subjectResponse' - 'subjectNote' - 'wantedAnswers') then
      raise exception 'You cannot change the details of this post';
    end if;
    if not is_claimed and (
      (cur->'khumbu'->'subjectResponse') is distinct from (next->'khumbu'->'subjectResponse')
      or (cur->'khumbu'->'subjectNote') is distinct from (next->'khumbu'->'subjectNote')) then
      raise exception 'Only the person in the post can answer for themselves';
    end if;
    merged := jsonb_set(merged, '{khumbu}', next->'khumbu', true);
  end if;

  -- 8. Status and outcome: only the person in the post (not going home, or
  --    "my whereabouts are known"). Families close their own cases directly.
  if (cur->'status') is distinct from (next->'status') or (cur->'outcome') is distinct from (next->'outcome') then
    if not is_claimed or coalesce(next->>'status', '') not in ('not_going_home', 'found', coalesce(cur->>'status', '')) then
      raise exception 'Only the family can change the status of this case';
    end if;
    merged := jsonb_set(merged, '{status}', next->'status', true);
    merged := jsonb_set(merged, '{outcome}', coalesce(next->'outcome', 'null'::jsonb), true);
  end if;

  -- 9. Reports and history are append-only, and new entries must be yours.
  n_old := jsonb_array_length(coalesce(cur->'flags', '[]'::jsonb));
  if (select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from jsonb_array_elements(coalesce(next->'flags', '[]'::jsonb)) with ordinality t(e, i) where i <= n_old)
     is distinct from coalesce(cur->'flags', '[]'::jsonb)
     or exists (select 1 from jsonb_array_elements(coalesce(next->'flags', '[]'::jsonb)) with ordinality t(e, i) where i > n_old and e->>'byUserId' is distinct from me) then
    raise exception 'Reports cannot be edited';
  end if;
  merged := jsonb_set(merged, '{flags}', coalesce(next->'flags', '[]'::jsonb), true);

  n_old := jsonb_array_length(coalesce(cur->'events', '[]'::jsonb));
  if (select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from jsonb_array_elements(coalesce(next->'events', '[]'::jsonb)) with ordinality t(e, i) where i <= n_old)
     is distinct from coalesce(cur->'events', '[]'::jsonb)
     or exists (select 1 from jsonb_array_elements(coalesce(next->'events', '[]'::jsonb)) with ordinality t(e, i) where i > n_old and e->>'byUserId' is distinct from me) then
    raise exception 'The case history cannot be edited';
  end if;
  merged := jsonb_set(merged, '{events}', coalesce(next->'events', '[]'::jsonb), true);

  merged := jsonb_set(merged, '{updatedAt}', to_jsonb(floor(extract(epoch from clock_timestamp()) * 1000)::bigint), true);

  update public.records r
  set payload = merged,
      updated_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  where r.collection = 'posts' and r.id = post_id;

  return merged;
end;
$$;

-- File (or unfile) your own post into a Spotlight you belong to.
create or replace function public.lula_link_spotlight_post(spotlight_id text, post_id text, linking boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  me text := (select public.lula_uid());
  sp jsonb;
  ids jsonb;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  select r.payload into sp from public.records r
  where r.collection = 'spotlights' and r.id = spotlight_id
  for update;
  if sp is null then
    raise exception 'That Spotlight is not available';
  end if;
  if not public.lula_is_admin() and not exists (
    select 1 from public.records p
    where p.collection = 'posts' and p.id = post_id and p.payload->>'authorId' = me
  ) and (linking or sp->>'ownerId' is distinct from me) then
    raise exception 'You can only file your own posts';
  end if;
  if linking and not public.lula_is_admin()
     and not (coalesce(sp->'memberIds', '[]'::jsonb) @> jsonb_build_array(me)) and sp->>'ownerId' is distinct from me then
    raise exception 'Join the Spotlight before posting to it';
  end if;

  select coalesce(jsonb_agg(v), '[]'::jsonb) into ids
  from jsonb_array_elements_text(coalesce(sp->'postIds', '[]'::jsonb)) v
  where v <> post_id;
  if linking then
    ids := jsonb_build_array(post_id) || ids;
  end if;

  sp := jsonb_set(sp, '{postIds}', ids, true);
  update public.records r
  set payload = sp,
      updated_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  where r.collection = 'spotlights' and r.id = spotlight_id;
  return sp;
end;
$$;

revoke all on function public.lula_post_interact(text, jsonb) from public;
revoke all on function public.lula_link_spotlight_post(text, text, boolean) from public;
grant execute on function public.lula_post_interact(text, jsonb) to anon, authenticated;
grant execute on function public.lula_link_spotlight_post(text, text, boolean) to anon, authenticated;

/* ---------------------------------------------------------------------------
 * Patch fields on a post with a jsonb merge, in one statement.
 *
 * The client uses this instead of writing back a copy of the post it read
 * earlier: two writers touching the same case at once (a "did you get help?"
 * nudge and a search zone being claimed, say) used to mean the slower write
 * silently threw away the other one. Postgres does the merge, so the record
 * can only move forward.
 * ------------------------------------------------------------------------- */
/* ------------------------------------------------------------------ *
 * Be on the lookout
 *
 * The rules are the same ones the app runs offline (src/app/core/utils/lookout.ts);
 * this is the server-side copy so two phones cannot both close a lookout, and so
 * the case LulaFind publishes lands in the same transaction as the "no" that
 * caused it. Nothing else in this file can post a case on someone's behalf.
 * ------------------------------------------------------------------ */

create or replace function public.lula_lookout_visible(lookout_id text, viewer text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select viewer is not null and exists (
    select 1 from public.records r
    where r.collection = 'lookouts'
      and r.id = lookout_id
      and (
        r.payload->>'userId' = viewer
        or viewer in (select jsonb_array_elements_text(coalesce(r.payload->'askedIds', '[]'::jsonb)))
        or exists (
          select 1 from public.records f
          where f.collection = 'follows'
            and f.payload->>'followingId' = r.payload->>'userId'
            and f.payload->>'followerId' = viewer
            and coalesce(f.payload->>'status', 'accepted') = 'accepted'
        )
      )
  );
$$;

revoke all on function public.lula_lookout_visible(text, text) from public;
grant execute on function public.lula_lookout_visible(text, text) to anon, authenticated;

-- The person edits their own lookout: it is their safety status.
create or replace function public.lula_patch_lookout(lookout_id text, patch jsonb)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  owner text;
begin
  select r.payload->>'userId' into owner
    from public.records r
   where r.collection = 'lookouts' and r.id = lookout_id;

  if owner is null then
    raise exception 'no such lookout';
  end if;

  if not (public.lula_is_self(owner) or public.lula_is_admin()) then
    raise exception 'not allowed';
  end if;

  update public.records
     set payload = payload || patch,
         updated_at = ((extract(epoch from now()) * 1000)::bigint)
   where collection = 'lookouts' and id = lookout_id;
end;
$$;

/*
 * A follower answers "are they okay?".
 *
 * One "no" flags the person. The case is published here - built from the
 * person's own record and the area they named - and only when that person
 * turned "Let LulaFind post a case about me" on. If they did not, the answer is
 * still recorded and their followers are still told; there is simply no post.
 */
create or replace function public.lula_answer_lookout(lookout_id text, answerer text, they_are_ok boolean)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor text := (select public.lula_uid());
  lo jsonb;
  owner text;
  owner_row jsonb;
  privacy jsonb;
  asked jsonb;
  answers jsonb;
  now_ms bigint := ((extract(epoch from now()) * 1000)::bigint);
  everyone_ok boolean := false;
  publish boolean := false;
  post_id text;
  who text;
begin
  if actor is null or actor <> answerer then
    raise exception 'Sign in to answer';
  end if;

  -- Lock the row: two followers answering at the same time must not both read
  -- "everyone said yes" and both close it.
  select r.payload into lo
    from public.records r
   where r.collection = 'lookouts' and r.id = lookout_id
     for update;

  if lo is null then
    raise exception 'That lookout is not here any more';
  end if;

  owner := lo->>'userId';
  if owner = actor then
    raise exception 'Only the people following you can answer this';
  end if;

  if not public.lula_lookout_visible(lookout_id, actor) then
    raise exception 'not allowed';
  end if;

  asked := coalesce(lo->'askedIds', '[]'::jsonb);
  if jsonb_array_length(asked) > 0 and not asked ? actor then
    raise exception 'You were not asked about this lookout';
  end if;

  -- One answer each, and the first one stands: a change of heart does not
  -- un-flag someone, and a second tap changes nothing.
  if exists (
    select 1 from jsonb_array_elements(coalesce(lo->'answers', '[]'::jsonb)) a
     where a->>'byUserId' = actor
  ) then
    return;
  end if;

  answers := coalesce(lo->'answers', '[]'::jsonb)
    || jsonb_build_object('byUserId', actor, 'ok', they_are_ok, 'at', now_ms);

  if they_are_ok then
    select jsonb_array_length(asked) > 0 and not exists (
      select 1 from jsonb_array_elements_text(asked) want
       where not exists (
         select 1 from jsonb_array_elements(answers) a
          where a->>'byUserId' = want and coalesce((a->>'ok')::boolean, false)
       )
    ) into everyone_ok;
  end if;

  if not they_are_ok then
    update public.records
       set payload = payload || jsonb_build_object(
             'answers', answers,
             'status', 'escalated',
             'closedAt', now_ms,
             'closedReason', 'escalated'),
           updated_at = now_ms
     where collection = 'lookouts' and id = lookout_id;

    select r.payload into owner_row
      from public.records r
     where r.collection = 'users' and r.id = owner;

    privacy := coalesce(owner_row->'privacy', '{}'::jsonb);
    publish := coalesce((privacy->>'allowSafetyAlertPosts')::boolean, false);

    if publish then
      post_id := 'p_lookout_' || lookout_id;
      who := coalesce(nullif(owner_row->>'displayName', ''), 'A LulaFind member');

      insert into public.records (collection, id, owner_id, payload, updated_at)
      values (
        'posts', post_id, owner,
        jsonb_build_object(
          'id', post_id, 'type', 'missing', 'status', 'active', 'danger', null,
          'authorId', owner, 'anonymous', false, 'askWanted', false,
          'title', 'Have you seen ' || who || '? They may be missing',
          'body', 'LulaFind asked ' || jsonb_array_length(asked) || ' followers to check on ' || who
                  || ' after 24 hours, and someone said something is wrong.'
                  || case when coalesce(lo->>'note', '') <> ''
                          then E'\n\nThey wrote: "' || (lo->>'note') || '"' else '' end
                  || E'\n\nIf you see them, do not approach. Call 10111.',
          'media', '[]'::jsonb,
          'province', coalesce(owner_row->>'province', 'GP'),
          'town', coalesce(owner_row->>'town', ''),
          'lastSeenAt', coalesce((lo->>'locationAt')::bigint, (lo->>'startedAt')::bigint),
          'lastSeenWhere', coalesce(nullif(lo->>'area', ''), coalesce(owner_row->>'town', '')),
          'contactLabel', 'Message on LulaFind', 'contactValue', '', 'contactVisibleTo', 'everyone',
          'createdAt', now_ms, 'updatedAt', now_ms,
          'audience', coalesce(nullif(privacy->>'safetyAlertAudience', ''), 'followers'),
          'spotlightId', case when privacy->>'safetyAlertAudience' = 'surname'
                              then nullif(privacy->>'safetyAlertSpotlightId', '') else null end,
          'chatEnabled', false, 'allowComments', true, 'allowShare', true,
          'appPosted', true, 'lookoutId', lookout_id
        ),
        now_ms
      )
      on conflict (collection, id) do nothing;

      update public.records
         set payload = payload || jsonb_build_object('escalatedPostId', post_id),
             updated_at = now_ms
       where collection = 'lookouts' and id = lookout_id;
    end if;

    return;
  end if;

  update public.records
     set payload = payload || jsonb_build_object(
           'answers', answers,
           'status', case when everyone_ok then 'cleared' else 'checking' end,
           'closedAt', case when everyone_ok then now_ms else null end,
           'closedReason', case when everyone_ok then 'all_ok' else '' end),
         updated_at = now_ms
   where collection = 'lookouts' and id = lookout_id;
end;
$$;

/*
 * The 24-hour clock, server side.
 *
 * The app also runs this check whenever someone opens it, but a follower should
 * not have to have the app open for the question to be asked. The pg_cron
 * example below is written with line comments on purpose: a schedule expression
 * inside a block comment would end the comment early.
 */
-- Schedule the check once, to fire on its own:
--   select cron.schedule('lula-lookout-due', 'every five minutes', 'select public.lula_lookout_ask_due()');
-- (or the usual cron syntax: five minutes = star-slash-5 followed by four spaces and stars)
create or replace function public.lula_lookout_ask_due()
returns integer language plpgsql security definer set search_path = pg_catalog as $$
declare
  due record;
  followers jsonb;
  now_ms bigint := ((extract(epoch from now()) * 1000)::bigint);
  asked integer := 0;
begin
  for due in
    select r.id, r.payload
      from public.records r
     where r.collection = 'lookouts'
       and coalesce(r.payload->>'status', 'active') = 'active'
       and r.payload->>'askedAt' is null
       and coalesce((r.payload->>'checkAt')::bigint, 0) <= now_ms
       for update
  loop
    select coalesce(jsonb_agg(distinct f.payload->>'followerId'), '[]'::jsonb) into followers
      from public.records f
     where f.collection = 'follows'
       and f.payload->>'followingId' = due.payload->>'userId'
       and coalesce(f.payload->>'status', 'accepted') = 'accepted';

    update public.records
       set payload = payload || jsonb_build_object(
             'askedIds', followers,
             'askedAt', now_ms,
             'status', case when jsonb_array_length(followers) > 0 then 'checking' else 'active' end),
           updated_at = now_ms
     where collection = 'lookouts' and id = due.id;

    asked := asked + 1;
  end loop;

  return asked;
end;
$$;

revoke all on function public.lula_patch_lookout(text, jsonb) from public;
revoke all on function public.lula_answer_lookout(text, text, boolean) from public;
revoke all on function public.lula_lookout_ask_due() from public;
grant execute on function public.lula_patch_lookout(text, jsonb) to authenticated;
grant execute on function public.lula_answer_lookout(text, text, boolean) to authenticated;
grant execute on function public.lula_lookout_ask_due() to authenticated;

create or replace function public.lula_patch_post(post_id text, patch jsonb)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  target_author text;
begin
  select r.payload->>'authorId' into target_author
    from public.records r
   where r.collection = 'posts' and r.id = post_id;

  if target_author is null then
    raise exception 'no such post';
  end if;

  -- The author, an admin, or a volunteer claiming a search zone. A volunteer
  -- may only ever touch the searchParty field; nothing else is theirs to change.
  if not (
    public.lula_is_self(target_author)
    or public.lula_is_admin()
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
