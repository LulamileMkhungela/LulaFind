# The wall we were hitting

Every fact below was checked against the live project
(`srwdtguxdjsjlkaydhet`) on 21 November 2026 - not inferred from source.

## The backend is connected. This is what it answers

| Check | Result |
| --- | --- |
| Project | `srwdtguxdjsjlkaydhet` · eu-west-1 · `ACTIVE_HEALTHY` (db, rest, storage, auth, realtime) |
| Tables | `records` (9 RLS policies, RLS on), `push_tokens` (4 policies, RLS on), view `lula_user_profiles_public` |
| Functions | 29, including `lula_post_visible`, `lula_patch_post`, `lula_post_interact`, `lula_uid` |
| Triggers | `lula_guard_record_update`, `lula_touch_record`, `lula_send_push`, `lula_report_email` |
| Realtime | `records` is in the `supabase_realtime` publication |
| Edge functions | `send-push` (v7), `send-report-email` (v7), both `ACTIVE` |
| Rows | posts 8 · users 7 · stories 8 · follows 6 · messages 4 · spotlights 3 · comments 2 · reports 1 |

The app resolves to the live backend: `environment.dataMode = 'supabase'`,
`liveSupabaseEnabled()` is true, and `apiFactory()` returns `SupabaseApi`.
Auth is Firebase (email/password + Google); the Firebase ID token is sent to
Postgres as a third-party JWT so `lula_uid()` can resolve the caller.

## What was actually wrong, and what was fixed

### 1. Voice notes could never have been uploaded  *(fixed)*

`schema.sql` grants the `photos` bucket
`image/*, video/mp4, video/quicktime, audio/webm, audio/ogg, audio/mp4,
audio/aac, audio/mpeg`, but the **live** bucket allowed only
`image/jpeg, image/png, image/webp, image/gif, video/mp4, video/quicktime`
with a 3 MB ceiling. Every voice note the recorder produces was refused by
Storage before it reached a row.

Fixed by migration `photos_bucket_restore_audio_and_limits`: the bucket is back
to 5 MB and the full list (plus `audio/wav`, which some Android recorders
produce).

### 2. Every filtered feed read was a full scan  *(fixed)*

The only `records` indexes were `(collection, updated_at)`, `(collection, id)`
and `(collection, payload->>'storyId')`. The feed, cards and search filter on
`payload->>'authorId'`, `payload->>'status'` and `payload->>'province'`, and
RLS itself reads `payload->>'...'` on nearly every policy.

Added (same migration, and now in `schema.sql` so a fresh project gets them):

```sql
records_posts_author_idx    (payload->>'authorId') where collection = 'posts';
records_posts_status_idx    (payload->>'status')   where collection = 'posts';
records_posts_province_idx  (payload->>'province') where collection = 'posts';
records_by_owner_idx        (owner_id)             where owner_id is not null;
```

### 3. The same data was asked for once per card  *(fixed in the client)*

`DataService.loadCommentsFor` was called by each card the moment it rendered,
so a feed of twenty posts opened twenty independent comment queries at once.
It now goes through `primeComments()`, which collects every card that mounts
in the same frame and fetches them as one parallel batch. The chat inbox had
the same shape and now fetches every missing preview in one `Promise.all`
instead of one await per thread.

## Still yours to do (not code)

- **Firebase Auth** must have the Supabase third-party provider configured
  with the same project, or `lula_uid()` is `NULL` and RLS refuses every write
  with `IDENTITY_REFUSED_COPY`. Verify in the app with
  `await window.__lulaDebugWhoAmI()`.
- **Push delivery** needs the FCM service account secret
  (`supabase/PUSH.md`); the functions are deployed but unconfigured.
- **Report email** needs the provider secrets (`supabase/report-email-webhook.sql`).
- **Email verification** for new accounts is Firebase-side; unverified accounts
  can read but not write by design.
