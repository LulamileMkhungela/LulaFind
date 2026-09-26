-- Run this once in the Supabase SQL editor.
-- Checked 26 September 2026: the records table exists, but these extra rights do not.
-- Without this file, a second person cannot join a Spotlight, a report stays only on the phone that filed it,
-- and the person being followed cannot remove that follower.

drop policy if exists "lula spotlight update" on public.records;
create policy "lula spotlight update" on public.records
for update to authenticated
using (collection = 'spotlights')
with check (collection = 'spotlights');

drop policy if exists "lula reports read" on public.records;
create policy "lula reports read" on public.records
for select to authenticated
using (collection = 'reports');

drop policy if exists "lula follow remove" on public.records;
create policy "lula follow remove" on public.records
for delete to authenticated
using (
  collection = 'follows'
  and payload->>'followingId' = (select auth.uid()::text)
);
