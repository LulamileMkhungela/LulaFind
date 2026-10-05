-- LulaFind moderation-report policies.
-- Run this in Supabase SQL Editor after schema.sql.
-- It is safe to re-run. Reports are stored in public.records with
-- collection = 'reports' and payload.byUserId set to the reporting member.

begin;

grant select, insert, update, delete on public.records to anon, authenticated;

-- A member may read only their own reports. Admins may read the moderation queue.
drop policy if exists "lula report read" on public.records;
create policy "lula report read" on public.records
for select to anon, authenticated
using (
  collection = 'reports'
  and (
    public.lula_is_admin()
    or payload->>'byUserId' = (select public.lula_uid())
  )
);

-- The reporter is the only non-admin allowed to create a report for themselves.
drop policy if exists "lula report insert" on public.records;
create policy "lula report insert" on public.records
for insert to anon, authenticated
with check (
  collection = 'reports'
  and payload->>'byUserId' = (select public.lula_uid())
);

-- Only an admin may resolve, dismiss, or otherwise change a report.
drop policy if exists "lula report update" on public.records;
create policy "lula report update" on public.records
for update to anon, authenticated
using (collection = 'reports' and public.lula_is_admin())
with check (collection = 'reports' and public.lula_is_admin());

-- Only an admin may delete a report.
drop policy if exists "lula report delete" on public.records;
create policy "lula report delete" on public.records
for delete to anon, authenticated
using (collection = 'reports' and public.lula_is_admin());

commit;

select
  'report policies' as check,
  count(*) as installed
from pg_policies
where schemaname = 'public'
  and tablename = 'records'
  and policyname in (
    'lula report read',
    'lula report insert',
    'lula report update',
    'lula report delete'
  );
