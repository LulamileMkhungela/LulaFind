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
create or replace function public.lula_uid()
returns text language sql stable set search_path = pg_catalog as $$
  select case
    when auth.jwt()->>'iss' = 'https://securetoken.google.com/lulafinds-app'
     and auth.jwt()->>'aud' = 'lulafinds-app'
     and coalesce(auth.jwt()->>'email_verified', 'false') = 'true'
    then nullif(auth.jwt()->>'sub', '')
  end;
$$;
revoke all on function public.lula_uid() from public;
grant execute on function public.lula_uid() to anon, authenticated;

-- SECURITY DEFINER helpers avoid recursive RLS when one collection checks a
-- related row in records. The identity arguments are always clamped to lula_uid()
-- so calling these helpers through PostgREST cannot probe another account.
create or replace function public.lula_is_admin()
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select public.lula_uid() is not null
    and coalesce((auth.jwt()->>'lulafind_role') in ('admin', 'moderator'), false);
$$;

create or replace function public.lula_follows_accepted(follower text, following text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select follower is not distinct from (select public.lula_uid())
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
  select person is not distinct from (select public.lula_uid())
    and exists (
      select 1 from public.records s
      where s.collection = 'spotlights'
        and s.id = spotlight
        and person in (select jsonb_array_elements_text(coalesce(s.payload->'memberIds', '[]'::jsonb)))
    );
$$;

create or replace function public.lula_post_visible(post_id text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select person is not distinct from (select public.lula_uid())
    and exists (
      select 1 from public.records p
      where p.collection = 'posts'
        and p.id = post_id
        -- Treat legacy rows with no status as active; NULL must not hide them.
        and (coalesce(p.payload->>'status', 'active') <> 'under_review'
          or p.payload->>'authorId' = person
          or public.lula_is_admin())
        and (
          public.lula_is_admin()
          or coalesce(p.payload->>'audience', 'public') = 'public'
          or p.payload->>'authorId' = person
          or (p.payload->>'audience' = 'followers'
            and public.lula_follows_accepted(person, p.payload->>'authorId'))
          or (p.payload->>'audience' = 'surname'
            and public.lula_spotlight_member(person, p.payload->>'spotlightId'))
        )
    );
$$;

create or replace function public.lula_story_visible(story_id text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select person is not distinct from (select public.lula_uid())
    and exists (
      select 1 from public.records s
      where s.collection = 'stories'
        and s.id = story_id
        and (
          coalesce(s.payload->>'audience', 'public') = 'public'
          or s.payload->>'authorId' = person
          -- A follower is someone this viewer follows, not someone who follows the viewer.
          or (s.payload->>'audience' = 'followers'
            and public.lula_follows_accepted(person, s.payload->>'authorId'))
          or (s.payload->>'audience' = 'surname'
            and public.lula_spotlight_member(person, s.payload->>'spotlightId'))
        )
    );
$$;

create or replace function public.lula_story_owner(story_id text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select person is not distinct from (select public.lula_uid())
    and exists (
      select 1 from public.records s
      where s.collection = 'stories'
        and s.id = story_id
        and s.payload->>'authorId' = person
    );
$$;

create or replace function public.lula_in_thread(thread_id text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select person is not distinct from (select public.lula_uid())
    and exists (
      select 1 from public.records t
      where t.collection = 'threads'
        and t.id = thread_id
        and person in (select jsonb_array_elements_text(coalesce(t.payload->'participantIds', '[]'::jsonb)))
    );
$$;

-- Signed image URLs are issued only if this caller can read the story/post that
-- references the object. The storage bucket itself must remain private.
create or replace function public.lula_media_visible(file_path text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select person is not distinct from (select public.lula_uid())
    and exists (
      select 1
      from public.records r
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(r.payload->'media') = 'array' then r.payload->'media' else '[]'::jsonb end
      ) as item(value)
      where r.collection in ('posts', 'stories')
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
  select follower is not distinct from (select public.lula_uid())
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
revoke all on function public.lula_follows_accepted(text, text) from public;
revoke all on function public.lula_spotlight_member(text, text) from public;
revoke all on function public.lula_post_visible(text, text) from public;
revoke all on function public.lula_story_visible(text, text) from public;
revoke all on function public.lula_story_owner(text, text) from public;
revoke all on function public.lula_in_thread(text, text) from public;
revoke all on function public.lula_follow_insert_allowed(text, text, text) from public;
revoke all on function public.lula_media_visible(text, text) from public;
grant execute on function public.lula_is_admin() to anon, authenticated;
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
    owner_id = (select public.lula_uid())
    and (
      (collection = 'users'
        and id = (select public.lula_uid())
        and payload->>'id' = (select public.lula_uid())
        and coalesce(payload->>'isAdmin', 'false') = 'false'
        and coalesce(payload->>'suspended', 'false') = 'false')
      or (collection = 'posts' and payload->>'authorId' = (select public.lula_uid()))
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
)
with check (
  public.lula_is_admin()
  or (
    (collection in ('posts', 'comments', 'stories')
      and owner_id = (select public.lula_uid())
      and payload->>'authorId' = (select public.lula_uid()))
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
  )
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
    'voterIds', 'upvotes', 'downvotes', 'commentCount', 'views', 'shares', 'lookingIds',
    'searchParty', 'danger', 'khumbu', 'flags', 'events', 'updatedAt', 'status', 'outcome'
  ];
  my_old text;
  my_new text;
  claimed_old text;
  claimed_new text;
  is_claimed boolean;
  merged jsonb;
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
  if my_new is not null and my_new not in ('up', 'down') then
    raise exception 'Unknown vote';
  end if;
  merged := cur;
  merged := jsonb_set(merged, '{voterIds}', coalesce(next->'voterIds', '{}'::jsonb), true);
  merged := jsonb_set(merged, '{upvotes}', to_jsonb(greatest(0,
    coalesce((cur->>'upvotes')::int, 0) + (case when my_new = 'up' then 1 else 0 end) - (case when my_old = 'up' then 1 else 0 end))), true);
  merged := jsonb_set(merged, '{downvotes}', to_jsonb(greatest(0,
    coalesce((cur->>'downvotes')::int, 0) + (case when my_new = 'down' then 1 else 0 end) - (case when my_old = 'down' then 1 else 0 end))), true);

  -- 3. Counters: comments are counted, views and shares go up by one at most.
  merged := jsonb_set(merged, '{commentCount}', to_jsonb((
    select count(*) from public.records c where c.collection = 'comments' and c.payload->>'postId' = post_id)), true);
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
