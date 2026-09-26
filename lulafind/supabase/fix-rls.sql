create or replace function public.lula_follows_accepted(follower text, following text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.records
    where collection = 'follows'
      and payload->>'status' = 'accepted'
      and payload->>'followerId' = follower
      and payload->>'followingId' = following
  );
$$;

create or replace function public.lula_post_visible(post_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.records
    where collection = 'posts'
      and id = post_id
      and (
        coalesce(payload->>'audience', 'public') = 'public'
        or payload->>'authorId' = (select auth.uid()::text)
      )
  );
$$;

create or replace function public.lula_in_thread(thread_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.records
    where collection = 'threads'
      and id = thread_id
      and (select auth.uid()::text) in (
        select jsonb_array_elements_text(coalesce(payload->'participantIds', '[]'::jsonb))
      )
  );
$$;

revoke all on function public.lula_follows_accepted(text, text) from public;
revoke all on function public.lula_post_visible(text) from public;
revoke all on function public.lula_in_thread(text) from public;
grant execute on function public.lula_follows_accepted(text, text) to anon, authenticated;
grant execute on function public.lula_post_visible(text) to anon, authenticated;
grant execute on function public.lula_in_thread(text) to anon, authenticated;

drop policy if exists "lula read" on public.records;
create policy "lula read" on public.records
for select to anon, authenticated
using (
  (
    collection = 'posts'
    and (
      coalesce(payload->>'audience', 'public') = 'public'
      or payload->>'authorId' = (select auth.uid()::text)
      or (
        payload->>'audience' = 'followers'
        and public.lula_follows_accepted((select auth.uid()::text), records.payload->>'authorId')
      )
    )
  )
  or (
    collection = 'comments'
    and (
      payload->>'authorId' = (select auth.uid()::text)
      or public.lula_post_visible(records.payload->>'postId')
    )
  )
  or collection in ('spotlights', 'tips', 'follows')
  or (
    collection = 'stories'
    and (
      coalesce(payload->>'audience', 'public') = 'public'
      or payload->>'authorId' = (select auth.uid()::text)
    )
  )
  or collection = 'users'
  or (
    collection = 'notifications'
    and payload->>'userId' = (select auth.uid()::text)
  )
  or (
    collection = 'threads'
    and (select auth.uid()::text) in (
      select jsonb_array_elements_text(coalesce(payload->'participantIds', '[]'::jsonb))
    )
  )
  or (
    collection = 'messages'
    and public.lula_in_thread(records.payload->>'threadId')
  )
);
