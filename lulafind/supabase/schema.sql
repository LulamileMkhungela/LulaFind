create table if not exists public.records (
  collection text not null,
  id text not null,
  owner_id uuid,
  payload jsonb not null,
  updated_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  primary key (collection, id)
);

alter table public.records enable row level security;

grant select on public.records to anon;
grant select, insert, update, delete on public.records to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.records;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

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
        and exists (
          select 1 from public.records f
          where f.collection = 'follows'
            and f.payload->>'status' = 'accepted'
            and f.payload->>'followerId' = (select auth.uid()::text)
            and f.payload->>'followingId' = records.payload->>'authorId'
        )
      )
    )
  )
  or (
    collection = 'comments'
    and exists (
      select 1 from public.records p
      where p.collection = 'posts'
        and p.id = records.payload->>'postId'
        and (
          coalesce(p.payload->>'audience', 'public') = 'public'
          or p.payload->>'authorId' = (select auth.uid()::text)
          or records.payload->>'authorId' = (select auth.uid()::text)
        )
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
    and exists (
      select 1 from public.records t
      where t.collection = 'threads'
        and t.id = records.payload->>'threadId'
        and (select auth.uid()::text) in (
          select jsonb_array_elements_text(coalesce(t.payload->'participantIds', '[]'::jsonb))
        )
    )
  )
);

drop policy if exists "lula insert" on public.records;
create policy "lula insert" on public.records
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and (
    collection = 'notifications'
    or (collection = 'users' and id = (select auth.uid()::text))
    or payload->>'authorId' = (select auth.uid()::text)
    or payload->>'fromUserId' = (select auth.uid()::text)
    or payload->>'followerId' = (select auth.uid()::text)
    or (
      collection = 'threads'
      and (select auth.uid()::text) in (
        select jsonb_array_elements_text(coalesce(payload->'participantIds', '[]'::jsonb))
      )
    )
    or collection = 'spotlights'
  )
);

drop policy if exists "lula update" on public.records;
create policy "lula update" on public.records
for update to authenticated
using (
  owner_id = (select auth.uid())
  or id = (select auth.uid()::text)
  or payload->>'authorId' = (select auth.uid()::text)
  or (collection = 'notifications' and payload->>'userId' = (select auth.uid()::text))
  or (collection = 'follows' and (payload->>'followerId' = (select auth.uid()::text) or payload->>'followingId' = (select auth.uid()::text)))
  or (
    collection = 'threads'
    and (select auth.uid()::text) in (
      select jsonb_array_elements_text(coalesce(payload->'participantIds', '[]'::jsonb))
    )
  )
  or (
    collection = 'messages'
    and exists (
      select 1 from public.records t
      where t.collection = 'threads'
        and t.id = records.payload->>'threadId'
        and (select auth.uid()::text) in (
          select jsonb_array_elements_text(coalesce(t.payload->'participantIds', '[]'::jsonb))
        )
    )
  )
)
with check (
  owner_id = (select auth.uid())
  or id = (select auth.uid()::text)
  or payload->>'authorId' = (select auth.uid()::text)
  or (collection = 'notifications' and payload->>'userId' = (select auth.uid()::text))
  or (collection = 'follows' and (payload->>'followerId' = (select auth.uid()::text) or payload->>'followingId' = (select auth.uid()::text)))
  or collection = 'threads'
  or collection = 'messages'
);

drop policy if exists "lula delete" on public.records;
create policy "lula delete" on public.records
for delete to authenticated
using (
  owner_id = (select auth.uid())
  or id = (select auth.uid()::text)
  or payload->>'authorId' = (select auth.uid()::text)
  or payload->>'followerId' = (select auth.uid()::text)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4']
)
on conflict (id) do nothing;

drop policy if exists "lula photos read" on storage.objects;
create policy "lula photos read" on storage.objects
for select to anon, authenticated
using (bucket_id = 'photos');

drop policy if exists "lula photos write" on storage.objects;
create policy "lula photos write" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "lula photos update" on storage.objects;
create policy "lula photos update" on storage.objects
for update to authenticated
using (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "lula photos delete" on storage.objects;
create policy "lula photos delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
