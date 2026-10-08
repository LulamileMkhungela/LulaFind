-- LulaFind: let members interact with posts they did not write.
--
-- Why: the "lula update" policy only lets a post's author rewrite it. That is
-- right for the title, photos and details, but it also blocked everyone else
-- from voting Idea / No idea, sharing, "I'm looking", search-party zones,
-- danger "still happening", the KhumbulEkhaya "this is me" flow and reports.
-- It also stopped a member (not the owner) from filing a post into a Spotlight.
--
-- These two SECURITY DEFINER functions accept only the narrow changes each
-- flow needs and rebuild counters on the server, so nobody can edit someone
-- else's case or stuff the vote count.
--
-- The bottom of this file also adds:
--   * "lula spotlight join" - a policy that lets a member add or remove ONLY
--     themselves in a community's member list. Without it, joining a Spotlight
--     works only through lula_set_spotlight_membership(), and a deployment that
--     never ran that function's grant answers "join" with permission denied.
--   * the execute grant on lula_set_spotlight_membership, repeated here because
--     a missing grant is exactly the failure above and a grant is safe to redo.
--
-- Run once in the Supabase SQL editor (safe to re-run). schema.sql includes it.

create or replace function public.lula_post_interact(post_id text, next jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  me text := (select public.lula_uid());
  cur jsonb;
  k text;
  allowed text[] := array[
    'voterIds', 'upvotes', 'commentCount', 'views', 'shares', 'lookingIds',
    'searchParty', 'danger', 'khumbu', 'flags', 'events', 'lastComment', 'lastLike', 'updatedAt', 'status', 'outcome'
  ];
  my_new text;
  claimed_old text;
  claimed_new text;
  is_claimed boolean;
  merged jsonb;
  last_comment jsonb;
  last_like jsonb;
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
  my_new := next->'voterIds'->>me;
  if my_new is not null and my_new not in ('up', 'like', 'support', 'sad') then
    raise exception 'Unknown vote';
  end if;
  merged := cur;
  merged := jsonb_set(merged, '{voterIds}', coalesce(next->'voterIds', '{}'::jsonb), true);
  -- Rebuild the counter from the resulting voter map instead of adjusting a
  -- possibly stale client count. This makes a reaction switch exact after a
  -- refresh, even when an older record was written with a mismatched counter.
  merged := jsonb_set(merged, '{upvotes}', to_jsonb((
    select count(*)
    from jsonb_each_text(coalesce(next->'voterIds', '{}'::jsonb)) as votes(user_id, reaction)
    where reaction in ('up', 'like', 'support', 'sad')
  )), true);

  -- Rebuild the preview from the authenticated member. The client can carry
  -- lastLike optimistically, but cannot author its identity or display name.
  if my_new is not null then
    select jsonb_build_object(
      'userId', me,
      'displayName', coalesce(u.payload->>'displayName', 'Someone'),
      'at', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    ) into last_like
    from public.records u
    where u.collection = 'users' and u.id = me;
    merged := jsonb_set(
      merged,
      '{lastLike}',
      coalesce(last_like, jsonb_build_object(
        'userId', me,
        'displayName', 'Someone',
        'at', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
      )),
      true
    );
  end if;

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
    if ((cur->'searchParty') - 'zones') is distinct from (coalesce(next->'searchParty', 'null'::jsonb) - 'zones') then
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
    if ((cur->'danger') - 'stillIds' - 'clearIds' - 'clearedAt') is distinct from ((next->'danger') - 'stillIds' - 'clearIds' - 'clearedAt')
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

-- ── joining and leaving a surname community ────────────────────────────────
--
-- PostgreSQL RLS policies cannot reference an `old` row inside WITH CHECK.
-- Membership therefore uses lula_set_spotlight_membership(), a locked
-- SECURITY DEFINER RPC that changes only the caller's membership.
drop policy if exists "lula spotlight join" on public.records;

-- The membership function's own grant. Repeated here because a missing grant is
-- the same permission-denied failure seen from the other side, and a grant that
-- is already in place costs nothing to restate.
grant execute on function public.lula_set_spotlight_membership(text, boolean) to anon, authenticated;
