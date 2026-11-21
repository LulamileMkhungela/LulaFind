# The wall we were hitting

Every fact below was checked against the live project
(`srwdtguxdjsjlkaydhet`) on 21 November 2026 - not inferred from source.

## The backend is connected. This is what it answers

| Check | Result |
| --- | --- |
| Project | `srwdtguxdjsjlkaydhet` · eu-west-1 · `ACTIVE_HEALTHY` (db, rest, storage, auth, realtime) |
| Tables | `records` (9 RLS policies, RLS on), `push_tokens` (4 policies, RLS on), `lula_verifications` (RLS on, no client grants), view `lula_user_profiles_public` |
| Functions | 29, including `lula_post_visible`, `lula_patch_post`, `lula_post_interact`, `lula_uid` |
| Triggers | `lula_guard_record_update`, `lula_touch_record`, `lula_guard_verification`, `lula_send_push`, `lula_report_email` |
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

## 4. The verified badge was a flag anyone could set *(found and fixed)*

The badge on the card reads `author.verified`. In the demo data only a couple of
fixtures carried it, which is why only Thandi Mokoena and the moderation account
showed a badge - that part was honest. What was not honest was the source of the
flag: `verified` lived inside the profile `payload`, and the owner of that row is
allowed to write it (name, bio, town, privacy). Nothing stopped a member from
saving `verified: true` on themselves, and nothing in the product could grant a
badge to anybody, so "verified" was really "written into the seed data".

Now the badge is a granted fact:

| Piece | What it does |
| --- | --- |
| `lula_verifications` table | One row per verified account, with the note and who granted it. No `select`/`insert`/`update` grant to `anon` or `authenticated` - only the definer-rights RPC touches it. |
| `lula_verified(person)` | The only source of the badge; a SECURITY DEFINER predicate. |
| `lula_user_profiles_public` | `'verified', public.lula_verified(id)` instead of `payload->'verified'`, so the public read surface cannot carry a self-declared flag. |
| `lula_guard_verification` trigger | Refuses any client write that flips `verified` to `true`, and restores the stored value when a stale copy writes `false`, so saving a setting never removes a badge the server granted. **SECURITY INVOKER** - a definer-rights trigger sees `current_user = postgres` and waves everything through, which is exactly the bug that was found while testing this. |
| `lula_set_verified(person_id, granted, note)` | Admin-only RPC (JWT `lulafind_role` in `admin`/`moderator`); records who and why. Wired to `ModerationService.setVerified` and to **Admin → People → Verify member / Withdraw badge**. |

Applied to the live project as two migrations
(`verified_badges_are_granted`, `public_profile_reads_granted_badge`) and
verified: 7 profiles, `lula_guard_verification` present, 0 grants (backfill found
no pre-existing `verified: true` anywhere in the live data). The same DDL is in
`supabase/schema.sql`, and `npm run test:db` now proves the whole rule against a
real Postgres engine - 35 checks, 6 of them new:

```
PASS a member cannot set the verified flag on their own row
PASS editing other profile fields still works
PASS an admin grant makes the badge appear on the public profile
PASS a member cannot grant a badge to anyone
PASS a stale copy that drops the badge cannot remove the grant
PASS an admin can withdraw the badge
```

One thing the live project still needs: `network-status-chat-privacy.sql` has
not been applied there, so `public.lula_status_connected()` does not exist and the
deployed view still exposes check-in status to anyone (the repo's `schema.sql`
gates it on an accepted connection). The badge migration deliberately kept the
deployed check-in behaviour rather than failing - applying that script is now the
next backend step.
