-- Prove the Spotlight read rule with a throwaway case.
--
-- Run this only when supabase/spotlight-public-read.sql has been applied and its
-- section 5 reported no Spotlight cases at all - then there is nothing real to
-- count, and this writes one case, asks as a signed-out visitor, and rolls the
-- whole thing back.
--
-- It is a separate file because of the rollback. Running a SQL script as one
-- piece makes it a single transaction, so a rollback at the end of the main file
-- would undo that entire file - functions, policy and all - and leave the
-- database exactly as it was before, with nothing to show for it.
--
-- Paste this file on its own, all of it, and read the `verdict` column.

begin;

insert into public.records (id, collection, payload, owner_id, updated_at)
values (
  'lula_selftest_spotlight', 'posts',
  jsonb_build_object(
    'id', 'lula_selftest_spotlight',
    'collection', 'posts',
    'authorId', 'lula_selftest_author',
    'audience', 'surname',
    'spotlightId', 'lula_selftest_spotlight_page',
    'status', 'active',
    'title', 'Throwaway case used to test the Spotlight read rule',
    'body', 'Written and removed by this test block. It never stays in the database.',
    'createdAt', 0, 'updatedAt', 0
  ),
  null, 0
);

set local role anon;
select
  case
    when public.lula_post_visible('lula_selftest_spotlight') then
      'FIXED - a signed-out visitor can read a Spotlight case'
    else
      'NOT FIXED - a signed-out visitor is still refused. Check that the policy in section 3 is installed.'
  end as verdict,
  public.lula_post_visible('lula_selftest_spotlight', null) as two_argument_helper_agrees;
reset role;

rollback;
