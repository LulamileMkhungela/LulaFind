-- Search coordination v1. Apply after schema.sql and post-interactions.sql.
-- Authoritative definitions also embedded at the end of schema.sql.
-- No service credentials or client-supplied actor IDs. Commands lock one case row.
begin;

create or replace function public.lula_patch_post(post_id text, patch jsonb)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  cur jsonb;
  me text := public.lula_uid();
begin
  select payload into cur from public.records where collection = 'posts' and id = post_id for update;
  if me is null or cur is null or not (cur->>'authorId' = me or public.lula_is_admin()) then
    raise exception 'Only the case owner or a moderator can edit this case';
  end if;
  if exists(select 1 from public.records where collection = 'users' and id = me and payload->>'suspended' = 'true') then
    raise exception 'Your account is suspended';
  end if;
  if patch ? 'searchParty' then
    raise exception 'Use the search coordination commands to change the search board';
  end if;
  if (patch ? 'id' and patch->>'id' is distinct from post_id)
    or (patch ? 'authorId' and patch->>'authorId' is distinct from cur->>'authorId') then
    raise exception 'Case identity cannot be changed';
  end if;
  update public.records set payload = payload || patch where collection = 'posts' and id = post_id;
end;
$$;
revoke all on function public.lula_patch_post(text, jsonb) from public, anon;
grant execute on function public.lula_patch_post(text, jsonb) to authenticated;

-- Defence in depth for the older whole-post interaction RPC: a volunteer may
-- change ONE of their own assignments, never replace other people's zones.
create or replace function public.lula_guard_search_board()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  me text := public.lula_uid();
  before_party jsonb := old.payload->'searchParty';
  after_party jsonb := new.payload->'searchParty';
  before_zone jsonb;
  after_zone jsonb;
  changes integer := 0;
  actor_profile jsonb;
  author_profile jsonb;
begin
  if new.collection <> 'posts' or before_party is not distinct from after_party then return new; end if;
  select payload into actor_profile from public.records where collection = 'users' and id = me;
  select payload into author_profile from public.records where collection = 'users' and id = old.payload->>'authorId';
  if me is null or actor_profile is null or actor_profile->>'suspended' = 'true'
    or coalesce(author_profile->'blockedUserIds', '[]'::jsonb) ? me
    or coalesce(actor_profile->'blockedUserIds', '[]'::jsonb) ? (old.payload->>'authorId')
    or not public.lula_post_visible(old.id, me) then
    raise exception 'This search is not available to this account';
  end if;
  if old.payload->>'status' <> 'active' then raise exception 'This search case is not active'; end if;
  if old.payload->>'authorId' = me or public.lula_is_admin() then return new; end if;
  if before_party is null or before_party = 'null'::jsonb or before_party->>'open' <> 'true'
    or jsonb_typeof(after_party) is distinct from 'object'
    or (before_party - 'zones') is distinct from (after_party - 'zones')
    or jsonb_array_length(before_party->'zones') is distinct from jsonb_array_length(after_party->'zones') then
    raise exception 'Only the coordinator can change the search board';
  end if;
  for before_zone, after_zone in
    select b.value, a.value from jsonb_array_elements(before_party->'zones') with ordinality b
    join jsonb_array_elements(after_party->'zones') with ordinality a using (ordinality)
  loop
    if before_zone is not distinct from after_zone then continue; end if;
    changes := changes + 1;
    if (before_zone - array['takenBy','done','note','version','updatedBy','updatedAt'])
      is distinct from (after_zone - array['takenBy','done','note','version','updatedBy','updatedAt'])
      or coalesce((after_zone->>'version')::integer, -1) <> coalesce((before_zone->>'version')::integer, 0) + 1
      or after_zone->>'updatedBy' is distinct from me
      or jsonb_typeof(after_zone->'done') is distinct from 'boolean'
      or jsonb_typeof(after_zone->'note') is distinct from 'string'
      or length(after_zone->>'note') > 500 then
      raise exception 'Invalid search area update';
    end if;
    if not coalesce((
      -- Claim an available area without changing its previous report.
      (before_zone->>'takenBy' is null and before_zone->>'done' = 'false'
        and after_zone->>'takenBy' = me and after_zone->>'done' = 'false'
        and before_zone->'note' = after_zone->'note')
      -- Release your unfinished area, preserving its report.
      or (before_zone->>'takenBy' = me and before_zone->>'done' = 'false'
        and after_zone->>'takenBy' is null and after_zone->>'done' = 'false'
        and before_zone->'note' = after_zone->'note')
      -- Complete/reopen your own area (not another volunteer's).
      or (before_zone->>'takenBy' = me and after_zone->>'takenBy' = me
        and before_zone->'done' is distinct from after_zone->'done')
    ), false) then raise exception 'You can only update your own search area'; end if;
  end loop;
  if changes <> 1 then raise exception 'Change one search area at a time'; end if;
  return new;
end;
$$;
drop trigger if exists lula_guard_search_board on public.records;
create trigger lula_guard_search_board before update on public.records
for each row execute function public.lula_guard_search_board();
revoke all on function public.lula_guard_search_board() from public, anon, authenticated;

create or replace function public.lula_coordinate_search(post_id text, command jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  me text := public.lula_uid();
  cur jsonb;
  party jsonb;
  zone jsonb;
  updated_zone jsonb;
  zones jsonb;
  actor_profile jsonb;
  author_profile jsonb;
  action text := command->>'action';
  coordinator boolean;
  now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  names text[];
  point text := btrim(coalesce(command->>'meetAt', ''));
  meeting numeric;
  note text := btrim(coalesce(command->>'note', ''));
begin
  if me is null then raise exception 'Sign in to coordinate a search'; end if;
  select payload into actor_profile from public.records where collection = 'users' and id = me;
  if actor_profile is null or actor_profile->>'suspended' = 'true' then raise exception 'This search is not available to this account'; end if;
  select payload into cur from public.records where collection = 'posts' and id = post_id for update;
  if cur is null or not public.lula_post_visible(post_id, me) then raise exception 'This search is not available to this account'; end if;
  select payload into author_profile from public.records where collection = 'users' and id = cur->>'authorId';
  if coalesce(author_profile->'blockedUserIds', '[]'::jsonb) ? me
    or coalesce(actor_profile->'blockedUserIds', '[]'::jsonb) ? (cur->>'authorId') then
    raise exception 'This search is not available to this account';
  end if;
  if action = 'refresh' then return cur; end if;
  if cur->>'status' <> 'active' or cur->>'type' not in ('missing','khumbulekhaya','pet') then
    raise exception 'Only an active search case can have a search board';
  end if;
  coordinator := cur->>'authorId' = me or public.lula_is_admin();
  party := nullif(cur->'searchParty', 'null'::jsonb);
  if action = 'open' then
    if not coordinator then raise exception 'Only the case owner or a moderator can open a search board'; end if;
    if party is not null then raise exception 'This case already has a search board. Refresh to see it'; end if;
    if jsonb_typeof(command->'zones') is distinct from 'array'
      or exists (select 1 from jsonb_array_elements(command->'zones') v where jsonb_typeof(v) <> 'string') then
      raise exception 'Add 1–20 different areas';
    end if;
    select array_agg(btrim(value)) into names from jsonb_array_elements_text(command->'zones');
    if coalesce(cardinality(names), 0) not between 1 and 20
      or exists(select 1 from unnest(names) n where length(n) not between 1 and 100)
      or (select count(distinct lower(n)) from unnest(names) n) <> cardinality(names) then
      raise exception 'Add 1–20 different areas, each between 1 and 100 characters';
    end if;
    if length(point) not between 1 and 160 then raise exception 'Add a public meeting point, up to 160 characters'; end if;
    if command->>'meetWhen' is not null then
      meeting := (command->>'meetWhen')::numeric;
      if meeting < now_ms or meeting > now_ms + 2592000000 then raise exception 'Choose a meeting time within the next 30 days, or leave it blank'; end if;
    end if;
    select jsonb_agg(jsonb_build_object('id', post_id || '-zone-' || ord, 'name', n, 'priority', 'medium',
      'takenBy', null, 'done', false, 'note', '', 'version', 0) order by ord) into zones
      from unnest(names) with ordinality t(n, ord);
    party := jsonb_build_object('open', true, 'meetAt', point, 'meetWhen', meeting, 'zones', zones);
  elsif action in ('pause','resume') then
    if not coordinator then raise exception 'Only the case owner or a moderator can pause or resume a search'; end if;
    if party is null then raise exception 'This case has no search board'; end if;
    party := jsonb_set(party, '{open}', to_jsonb(action = 'resume'));
  elsif action in ('claim','release','complete','reopen') then
    if party is null then raise exception 'This case has no search board'; end if;
    if party->>'open' <> 'true' then raise exception 'This search is paused'; end if;
    select v into zone from jsonb_array_elements(party->'zones') v where v->>'id' = command->>'zoneId';
    if zone is null then raise exception 'That search area is no longer available'; end if;
    if (command->>'expectedVersion')::integer is distinct from coalesce((zone->>'version')::integer, 0) then
      raise exception 'This area changed. Refresh the board before trying again';
    end if;
    if action = 'claim' then
      if zone->>'takenBy' is not null or zone->>'done' = 'true' then raise exception 'Someone has already claimed or completed this area'; end if;
      updated_zone := zone || jsonb_build_object('takenBy', me);
    elsif action = 'release' then
      if zone->>'takenBy' is distinct from me or zone->>'done' <> 'false' then raise exception 'You can only release your own unfinished area'; end if;
      updated_zone := zone || jsonb_build_object('takenBy', null);
    elsif action = 'complete' then
      if zone->>'takenBy' is distinct from me or zone->>'done' <> 'false' then raise exception 'You can only complete your own unfinished area'; end if;
      if length(note) > 500 then raise exception 'Keep the area update under 500 characters'; end if;
      updated_zone := zone || jsonb_build_object('done', true, 'note', note);
    else
      if zone->>'takenBy' is distinct from me or zone->>'done' <> 'true' then raise exception 'You can only reopen an area you completed'; end if;
      updated_zone := zone || jsonb_build_object('done', false);
    end if;
    updated_zone := updated_zone || jsonb_build_object('version', coalesce((zone->>'version')::integer, 0) + 1, 'updatedBy', me, 'updatedAt', now_ms);
    select jsonb_agg(case when v->>'id' = zone->>'id' then updated_zone else v end order by ord)
      into zones from jsonb_array_elements(party->'zones') with ordinality t(v, ord);
    party := jsonb_set(party, '{zones}', zones);
  else raise exception 'Unknown search action';
  end if;
  cur := cur || jsonb_build_object('searchParty', party, 'updatedAt', now_ms);
  update public.records set payload = cur where collection = 'posts' and id = post_id;
  return cur;
end;
$$;
revoke all on function public.lula_coordinate_search(text, jsonb) from public, anon;
grant execute on function public.lula_coordinate_search(text, jsonb) to authenticated;
commit;
