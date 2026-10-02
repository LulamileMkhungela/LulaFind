-- Spotlight posts are public reading.
--
-- A Spotlight is a surname community page. Anyone who opens the page must see
-- what the community filed there - otherwise the page is an empty shell and the
-- family's appeal reaches nobody. Joining is what lets you *post* to it.
--
-- Before this file, `lula_post_visible` asked `lula_spotlight_member` for
-- `audience = 'surname'`, so a guest or a non-member opening a Spotlight got
-- nothing at all: the app listed the posts and Postgres refused to hand them
-- over. The app and the database must agree, and this is the database agreeing.
--
-- This version deliberately calls NO helper functions. An earlier version used
-- `lula_is_self`, which only exists on installs created since the schema was
-- refactored - running it on an older database failed with
-- "function public.lula_is_self(text) does not exist" and nothing was applied.
-- The only things this needs are `public.records` and `public.lula_uid()`,
-- which every install has (check-setup.sql check 1 proves the latter).
--
-- Run once, in the Supabase SQL editor. Safe to re-run: it replaces the
-- function in place and changes no data.

create or replace function public.lula_post_visible(post_id text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select person is not distinct from (select public.lula_uid())
    and exists (
      select 1 from public.records p
      where p.collection = 'posts'
        and p.id = post_id
        -- A case held for review is readable only by its author or an admin.
        -- Legacy rows with no status are active; NULL must not hide them.
        and (coalesce(p.payload->>'status', 'active') <> 'under_review'
          or p.payload->>'authorId' = person
          or coalesce((auth.jwt()->'app_metadata'->>'role') in ('admin', 'moderator'), false)
          or coalesce((auth.jwt()->>'lulafind_role') in ('admin', 'moderator'), false))
        and (
          coalesce((auth.jwt()->'app_metadata'->>'role') in ('admin', 'moderator'), false)
          or coalesce((auth.jwt()->>'lulafind_role') in ('admin', 'moderator'), false)
          -- A public case is readable by anyone, signed in or browsing as a guest.
          or coalesce(p.payload->>'audience', 'public') = 'public'
          -- Your own case.
          or (person is not null and p.payload->>'authorId' = person)
          -- Followers-only: an accepted follower of the author.
          or (p.payload->>'audience' = 'followers'
            and person is not null
            and exists (
              select 1 from public.records f
              where f.collection = 'follows'
                and coalesce(f.payload->>'status', 'accepted') = 'accepted'
                and f.payload->>'followerId' = person
                and f.payload->>'followingId' = p.payload->>'authorId'
            ))
          -- A Spotlight post is readable by anyone: the page is public and
          -- joining is only what allows posting to it.
          or (p.payload->>'audience' = 'surname'
            and coalesce(p.payload->>'spotlightId', '') <> '')
        )
    );
$$;

-- The function is called from RLS policies, so the grants must stay as they are.
-- A function this one replaces may have been created with an explicit owner; the
-- grants below are what PostgREST needs either way.
revoke all on function public.lula_post_visible(text, text) from public;
grant execute on function public.lula_post_visible(text, text) to anon, authenticated;

-- What you should see when this has worked, run in the same SQL editor:
--
--   select count(*) filter (where public.lula_post_visible(id, null)) as readable_by_a_guest,
--          count(*)                                                  as filed_spotlight_posts
--     from public.records
--    where collection = 'posts' and coalesce(payload->>'spotlightId', '') <> '';
--
-- A filed Spotlight post is readable by a signed-out visitor, so the two numbers
-- match - unless one of them is held for review, which is meant to be hidden from
-- everyone but its author.
--
-- If the numbers do not move at all, the RLS policy on `records` is not calling
-- this function, and the app and the database are disagreeing about who may read
-- a case. This prints the rule that is actually in force:
--
--   select qual from pg_policies
--    where schemaname = 'public' and tablename = 'records' and policyname = 'lula read';
