-- Spotlight posts are public reading.
--
-- A Spotlight is a surname community page. Anyone who opens the page must see
-- what the community filed there - otherwise the page is an empty shell and the
-- family's appeal reaches nobody. Joining is what lets you *post* to it.
--
-- Before this file, `lula_post_visible` required `lula_spotlight_member` for
-- `audience = 'surname'`, so a guest or a non-member opening a Spotlight got
-- nothing at all: the app listed the posts and Postgres refused to hand them
-- over. The app and the database must agree, and this is the database agreeing.
--
-- Run once, in the Supabase SQL editor. Safe to re-run.

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
          -- A Spotlight post is readable by anyone: the page is public and
          -- joining is only what allows posting to it.
          or (p.payload->>'audience' = 'surname'
            and coalesce(p.payload->>'spotlightId', '') <> '')
        )
    );
$$;

-- The function is called from RLS policies, so the grants must stay as they are.
revoke all on function public.lula_post_visible(text, text) from public;
grant execute on function public.lula_post_visible(text, text) to anon, authenticated;

-- Prove it: every filed post should now be visible to a signed-out visitor.
-- select count(*) filter (where public.lula_post_visible(id, null)) as readable,
--        count(*) as filed
--   from public.records
--  where collection = 'posts' and payload->>'spotlightId' is not null;
