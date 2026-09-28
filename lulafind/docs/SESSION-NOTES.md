# Session state — 2026-09-28

## Where things stand

`lulafind/` builds clean in dev and production, and `npx ng test --watch=false`
passes 114/114.

## Answering the user's question about the RLS error

The user asked whether the "story cannot be created" / row-level-security error
will still happen, and about a `...recursive?` error, quoting fields
`dbUidMatchesAppUid`, `suspended`, and RPC failure. **That diagnostic is not in
this repository** — grep for those names returns nothing. It is the user's own
script or an external one. What was added instead:

- `public.lula_debug_identity(app_uid text)` in `supabase/schema.sql` — read-only,
  `security definer`, returns `dbUid`, `appUid`, `dbUidMatchesAppUid`,
  `suspended`, `canWrite`, `postInteractRpc`, `spotlightRpc`.
- `SupabaseApi.whoAmI()` calls it and `init()` exposes
  `window.__lulaDebugWhoAmI()`; falls back to bare `lula_uid()` if the function
  does not exist yet.
- `IdentityReportFields` / `IdentityReport` / `describeIdentity()` in
  `supabase-api.ts`.
- `docs/SETUP.md` → "Proving a write will succeed" and "Recursive RLS".

Honest answer given to the user: the SQL has still never been run against a
hosted Postgres, so the insert error is not claimed fixed.

### Recursion status (checked statically, not executed)

All 16 functions parsed from `schema.sql` + `post-interactions.sql`. Every one
that reads `public.records` is `security definer` → recursion risk: none.
`lula_uid()` and `lula_touch_record()` are not definer and read no table.
No function or trigger is defined before `create table public.records`.

## Root cause found this session: silent edit reverts

`npm test` caught a real bug, not a test bug.

`checkWatched()` → `setOutcomeNudged()` read a post, then wrote the whole record
back. If `markFound()` closed the case in between, the late write put the old
copy back — the "my edit did not save" class of failure.

Fixed with compare-and-set rather than a test workaround:

- `LulaApi.savePost(p, options?)` now returns `boolean` and accepts
  `SavePostOptions { ifUnchangedSince?: number }` (`api.ts`).
- `LocalDb.upsertPost` returns `boolean`; skips the write when
  `ifUnchangedSince` does not match, and always skips an older `updatedAt`.
- `SupabaseApi.upsert(..., options?)` does a conditional
  `.update().eq('payload->>updatedAt', base)`, falls back to a normal upsert on
  error, returns whether the row was actually updated.
- `FirebaseApi.savePost` re-reads and compares before overwriting.
- `DataService.setOutcomeNudged` passes `{ ifUnchangedSince: p.updatedAt }`.
- `DataService.mergeCache` keeps the more recently updated record, so a slow
  in-flight read can no longer overwrite a newer write.
- `setOutcomeNudged` also stamps `updatedAt`.

## Other work completed this session

- **`lf-top-nav` migration** for admin, settings, safety-center, terms, tips,
  spotlight-detail, profile, saved, connections, search, post-detail. Search's
  searchbar + quick chips moved into the content area (they were clipped under
  the translucent bar). Chat room / poster / escalate / location-check / help
  switched to `[translucent]="false"`. `lf-nav-end` projects a page's own
  action next to Chats + Notifications. Saved and Connections' segmented
  filters were moved into the content; the profile "more" button was restored
  there. All now build with zero NG8113 warnings.
- **Auth**: `signInMarker` in localStorage — a cold start without it signs the
  session out ("sign out if you didn't sign in"); password-recovery links are
  exempt. `rememberSignIn()` wired into all 9 sign-in paths. Google sign-up now
  builds the profile from Google (`full_name` + email) and only asks for a name
  when Google has none. `emailAlreadyRegistered()` via Firebase
  `fetchSignInMethodsForEmail`, shown at the email step with a "Log in instead"
  link. `afterAuth()` navigates first and refreshes in the background.
- **Public profile Posts**: `LulaApi.postsByAuthor()` added (real
  `payload->>authorId` query, RLS still applies); profile no longer filters the
  viewer's feed.
- **Branding**: `scripts/generate-pwa-icons.mjs` (new, `npm run icons:pwa`),
  `@resvg/resvg-js` 2.6.2 now in package.json devDependencies,
  `icon-192/512/maskable-512.png` generated and visually checked, index.html and
  manifest.webmanifest wired, `display: standalone`.
- Perf: `afterAuth` no longer awaits `data.refresh()`; `loadStatic` caps story
  view queries at 24; Home's `recomputeGates()` is parallel.

## Traps hit

- **`node_modules` disappears on its own.** The sandbox excludes `node_modules`
  from persisted snapshots, so it is garbage-collected between commands. It
  vanished twice with no `git stash` involved. `npm install --no-audit --no-fund`
  restores it in ~15 s (490 packages, the network is fine). Symptom:
  `npx ng build` fails with "could not determine executable to run" while
  `npx ng test` still appears to work. Always re-check `ls node_modules/.bin/ng`
  before trusting a build result.
- `npx ng build` sometimes fails with "could not determine executable to run"
  when node_modules is half-present; `npx ng test` and `npm test` still worked.
- `/tmp/clean2.py` style loops: build output goes to **stderr**; capture both.

## Still open

- `supabase/schema.sql` has never been executed against Postgres. Re-run it and
  `check-setup.sql`, then `await window.__lulaDebugWhoAmI()` in the app.
- Audit every `upsert()` call passes a correct owner.
- Story-token error explanation is written in `docs/SETUP.md` but unverified.
- Report persistence (`ModerationService.report`) is still device-local.
- `SUPPORT_EMAIL`, privacy policy URL, FCM, live Firebase key revocation.
