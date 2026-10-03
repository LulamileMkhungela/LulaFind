-- Spotlight posts are public reading.
--
-- A Spotlight is a surname community page. Anyone who opens the page must see
-- what the community filed there - otherwise the page is an empty shell and the
-- family's appeal reaches nobody. Joining is what lets you *post* to it.
--
-- WHY THE PREVIOUS VERSION OF THIS FILE FAILED - TWICE
--
--   1. It called public.lula_is_self(), which a database created from the
--      original migration does not have, so Postgres refused the whole file:
--
--          ERROR 42883: function public.lula_is_self(text) does not exist
--
--      Nothing at all was installed.
--
--   2. It replaced only the *two-argument* lula_post_visible, and the posts
--      branch of the live read policy does not call that function at all - it
--      decides inline. So even a version that ran cleanly would have changed
--      nothing: the database would still hand a Spotlight post to nobody but a
--      member, and the page would still look empty to everyone else.
--
-- HOW THIS VERSION FIXES IT
--
-- It adds a policy instead of replacing the existing one. Postgres ORs
-- permissive policies together, so an extra policy can only ever widen access -
-- it cannot remove anyone's access, and it cannot lose a rule that some other
-- script has already added to your read policy. That matters here: the read
-- policy on a database like yours is a long expression covering comments,
-- stories, notifications, threads, messages and reports, and rewriting all of
-- it to change one line is how you break a rule nobody remembered was there.
--
-- This file depends only on what is proven to be in the live database:
-- auth.uid(), public.lula_follows_accepted(text, text), public.lula_is_admin()
-- and the records table.
--
-- Run in the Supabase SQL editor. Safe to re-run.

-- ── 1. The one-argument helper: may whoever is asking read this case? ────────
-- The comments branch of the read policy asks this question, so a comment on a
-- Spotlight post becomes readable at the same moment the post does - otherwise
-- the page opens with its conversation cut off.
create or replace function public.lula_post_visible(post_id text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select exists (
    select 1
    from public.records p
    where p.collection = 'posts'
      and p.id = post_id
      and (
        coalesce(p.payload->>'audience', 'public') = 'public'
        or p.payload->>'authorId' = (select auth.uid()::text)
        or (
          p.payload->>'audience' = 'followers'
          and public.lula_follows_accepted((select auth.uid()::text), p.payload->>'authorId')
        )
        -- A Spotlight post is readable by anyone: the page is public and
        -- joining is only what allows posting to it.
        or (
          p.payload->>'audience' = 'surname'
          and coalesce(p.payload->>'spotlightId', '') <> ''
        )
      )
  );
$$;

-- ── 2. The two-argument helper: the same question about a named person ──────
-- Other scripts (post-interactions) and the app ask this form. `person` is the
-- caller, so the author and follower branches compare against it - and each of
-- those branches also checks that the caller really is that person, so nobody
-- can pass someone else's id to read a case they were not given.
create or replace function public.lula_post_visible(post_id text, person text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select exists (
    select 1
    from public.records p
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
        or (person = (select auth.uid()::text) and p.payload->>'authorId' = person)
        or (
          p.payload->>'audience' = 'followers'
          and person = (select auth.uid()::text)
          and public.lula_follows_accepted(person, p.payload->>'authorId')
        )
        -- A Spotlight post is readable by anyone: the page is public and
        -- joining is only what allows posting to it.
        or (
          p.payload->>'audience' = 'surname'
          and coalesce(p.payload->>'spotlightId', '') <> ''
        )
      )
  );
$$;

-- ── 3. The widening: a Spotlight post is readable by anyone ─────────────────
-- Deliberately additive. It names the one thing that was wrong - a case filed
-- to a Spotlight being restricted to members - and leaves every other rule in
-- your read policy exactly as it is.
--
-- Three conditions, all required: the row is a post, it was filed to a
-- Spotlight, and it names that Spotlight. `coalesce(...) <> ''` matters because
-- a post with audience 'surname' but no Spotlight id is a broken row, and a
-- broken row must not become world-readable.
drop policy if exists "lula spotlight posts are public reading" on public.records;
create policy "lula spotlight posts are public reading" on public.records
for select to anon, authenticated
using (
  collection = 'posts'
  and payload->>'audience' = 'surname'
  and coalesce(payload->>'spotlightId', '') <> ''
);

-- ── 4. Grants: the functions are called from RLS, so these must stay ─────────
revoke all on function public.lula_post_visible(text) from public;
grant execute on function public.lula_post_visible(text) to anon, authenticated;
revoke all on function public.lula_post_visible(text, text) from public;
grant execute on function public.lula_post_visible(text, text) to anon, authenticated;

-- ── 5. Prove it ─────────────────────────────────────────────────────────────
-- The first query runs as the `anon` role, so row-level security really applies:
-- this is what a signed-out visitor gets. Expect both numbers to be greater than
-- zero, and the two to match - every Spotlight case the database holds should be
-- one a guest can read.
set role anon;
select
  count(*) filter (where payload->>'audience' = 'surname'
                     and coalesce(payload->>'spotlightId', '') <> '') as spotlight_cases_a_guest_can_read,
  count(*) filter (where payload->>'audience' = 'followers'
                     and payload->>'authorId' <> coalesce(auth.uid()::text, '')) as follower_only_still_hidden
from public.records
where collection = 'posts';
reset role;

-- And the policies standing on that table, to show the new one is installed.
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'records'
  and policyname = 'lula spotlight posts are public reading';

-- And the two-argument helper, asked about every Spotlight case by a signed-out
-- visitor. Expect the same number as the first query.
set role anon;
select count(*) as readable_via_the_two_argument_helper
from public.records
where collection = 'posts'
  and payload->>'audience' = 'surname'
  and public.lula_post_visible(id, null);
reset role;
