-- Apply only after review/testing against the deployed schema. Run in a transaction.
begin;

-- Status is shared only with the owner and an accepted connection in either direction.
create or replace function public.lula_status_connected(person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select public.lula_uid() is not null and (
    person = public.lula_uid() or exists (
      select 1 from public.records f where f.collection = 'follows'
        and coalesce(f.payload->>'status', 'accepted') = 'accepted'
        and ((f.payload->>'followerId' = public.lula_uid() and f.payload->>'followingId' = person)
          or (f.payload->>'followerId' = person and f.payload->>'followingId' = public.lula_uid()))
    )
  );
$$;
revoke all on function public.lula_status_connected(text) from public;
grant execute on function public.lula_status_connected(text) to anon, authenticated;

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
    -- Granted, never self-declared (see lula_verifications in schema.sql).
    'verified', public.lula_verified(id),
    'anonymous', coalesce(payload->'anonymous', 'false'::jsonb),
    'findableProfile', coalesce(payload->'findableProfile', 'false'::jsonb),
    'safetyBeacon', coalesce(payload->'safetyBeacon', 'false'::jsonb),
    'lastBeaconAt', 'null'::jsonb,
    'followers', case when show_stats then coalesce(payload->'followers', '0'::jsonb) else '0'::jsonb end,
    'following', case when show_stats then coalesce(payload->'following', '0'::jsonb) else '0'::jsonb end,
    'karma', case when show_stats then coalesce(payload->'karma', '0'::jsonb) else '0'::jsonb end,
    'contributorCredits', case when show_stats then coalesce(payload->'contributorCredits', '0'::jsonb) else '0'::jsonb end,
    -- What this member gave the network, by kind. Only the aggregate reaches
    -- this view: never a case, never a location, never a lead's detail. It is
    -- the same shape models/impact.ts reads, and zeroes when the member has
    -- hidden their stats or has not contributed yet.
    'impact', case
      when show_stats then jsonb_build_object(
        'signals', coalesce((payload #>> '{impact,signals}')::int, 0),
        'searches', coalesce((payload #>> '{impact,searches}')::int, 0),
        'posters', coalesce((payload #>> '{impact,posters}')::int, 0),
        'communities', coalesce((payload #>> '{impact,communities}')::int, 0),
        'care', coalesce((payload #>> '{impact,care}')::int, 0)
      )
      else '{"signals":0,"searches":0,"posters":0,"communities":0,"care":0}'::jsonb
    end,
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
      when not public.lula_status_connected(id) or payload->'checkIn' is null or payload->'checkIn' = 'null'::jsonb then 'null'::jsonb
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


-- Restrictive policies supplement the ordinary record policies. They do not
-- grant access by themselves. Two distinct participants, a connection in at
-- least one direction, and both message settings are required for new chat.
create or replace function public.lula_chat_members_allowed(thread_payload jsonb)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  with members as (
    select array_agg(v) as ids from jsonb_array_elements_text(
      case when jsonb_typeof(thread_payload->'participantIds') = 'array'
        then thread_payload->'participantIds' else '[]'::jsonb end) v
  )
  select coalesce((select
    cardinality(m.ids) = 2 and m.ids[1] <> m.ids[2] and public.lula_uid() = any(m.ids)
    and public.lula_status_connected(case when m.ids[1] = public.lula_uid() then m.ids[2] else m.ids[1] end)
    and (select count(*) from public.records u where u.collection = 'users' and u.id = any(m.ids)
      and coalesce(u.payload #>> '{privacy,allowMessages}', 'true') = 'true'
      and coalesce(u.payload->>'suspended', 'false') = 'false'
      and not (coalesce(u.payload->'blockedUserIds', '[]'::jsonb) ?
        (case when u.id = m.ids[1] then m.ids[2] else m.ids[1] end))) = 2
    and (nullif(thread_payload->>'postId', '') is null or exists (
      select 1 from public.records p where p.collection = 'posts' and p.id = thread_payload->>'postId'
        and coalesce(p.payload->>'chatEnabled', 'false') = 'true'))
    from members m), false);
$$;
create or replace function public.lula_chat_thread_allowed(thread_id text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select exists (select 1 from public.records t where t.collection = 'threads'
    and t.id = thread_id and public.lula_chat_members_allowed(t.payload));
$$;
revoke all on function public.lula_chat_members_allowed(jsonb) from public;
revoke all on function public.lula_chat_thread_allowed(text) from public;
grant execute on function public.lula_chat_members_allowed(jsonb) to anon, authenticated;
grant execute on function public.lula_chat_thread_allowed(text) to anon, authenticated;

drop policy if exists "lula chat connection insert" on public.records;
create policy "lula chat connection insert" on public.records as restrictive for insert to anon, authenticated
with check (public.lula_is_admin() or (collection <> 'threads' or public.lula_chat_members_allowed(payload))
  and (collection <> 'messages' or public.lula_chat_thread_allowed(payload->>'threadId')));

drop policy if exists "lula chat connection update" on public.records;
create policy "lula chat connection update" on public.records as restrictive for update to anon, authenticated
using (public.lula_is_admin() or collection <> 'messages' or public.lula_chat_thread_allowed(payload->>'threadId'))
with check (public.lula_is_admin() or collection <> 'messages' or public.lula_chat_thread_allowed(payload->>'threadId'));

-- Participants may update unread counts but may not replace the members of an
-- existing conversation or reassign a message to another thread or sender.
create or replace function public.lula_guard_chat_identity()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if old.collection = 'threads' and (new.collection <> old.collection or
    new.payload->'participantIds' is distinct from old.payload->'participantIds' or
    new.payload->'postId' is distinct from old.payload->'postId' or new.id <> old.id) then
    raise exception 'Thread participants cannot be changed';
  end if;
  if old.collection = 'messages' and (new.collection <> old.collection or
    new.payload->'threadId' is distinct from old.payload->'threadId' or
    new.payload->'fromUserId' is distinct from old.payload->'fromUserId' or new.id <> old.id) then
    raise exception 'Message identity cannot be changed';
  end if;
  return new;
end;
$$;
drop trigger if exists lula_guard_chat_identity on public.records;
create trigger lula_guard_chat_identity before update on public.records
for each row execute function public.lula_guard_chat_identity();

commit;
