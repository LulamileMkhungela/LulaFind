# Backend setup and live check

Last updated: 28 September 2026. This file is the source of truth for what is connected and what is not. Where it disagrees with `README.md`, follow this file.

---

## How the two backends are split

| Backend | Used for | Not used for |
|---------|----------|-------------|
| **Firebase Auth** (project `lulafinds-app`) | Accounts: email + password, Google, the verify-email and reset-password emails | Any app data |
| **Supabase** | All app data (`public.records`) and photos (`photos` bucket) | Accounts — `supabase.auth` is not used |

Supabase trusts the Firebase ID token through **Third-Party Auth**. The app sends that token on every request (`createClient(..., { accessToken })` in `src/app/core/data/supabase-api.ts`) and row security reads the caller from `public.lula_uid()` in `supabase/schema.sql`. That function accepts only tokens issued for `lulafinds-app` and only for **verified** email addresses, and returns the Firebase UID. `owner_id` is `text`, because Firebase UIDs are not UUIDs.

Code map:

| File | Role |
|------|------|
| `src/app/core/data/firebase-auth.ts` | `FirebaseAuthBridge`: Firebase sign-up/in, Google (popup on web, native sheet on Android/iOS via `@capacitor-firebase/authentication`), reset, sign-out; returns Supabase-shaped users so `AuthService` barely changed |
| `src/app/core/data/supabase-api.ts` | Creates the Supabase client with the Firebase token; `currentUid()` replaces `supabase.auth.getUser()` |
| `src/app/core/services/auth.service.ts` | Unchanged flow; uses the bridge when present |
| `supabase/schema.sql` | Firebase-native RLS; also upgrades an old Supabase-Auth project in place |
| `scripts/set-admin.mjs` | Sets the `lulafind_role` custom claim (`admin`/`moderator`) with the Admin SDK |

### Account flows

- **Email sign-up:** Firebase creates the account and sends its verification email. The person is signed out until they click the link. Their name, province and town are kept on the device and turned into the LulaFind profile on the first verified log-in. If they verify and log in on another device, the app asks for those details there.
- **Log-in with an unverified email:** a new verification link is sent and log-in is refused.
- **Google:** web uses a popup; Android/iOS use the native Google sheet. A first-time Google user completes the short profile form.
- **Forgot password:** Firebase emails a link; the person sets the new password on Firebase's page, then logs in. (If you later point the email action URL at `/auth`, the app also handles `?mode=resetPassword&oobCode=…` itself.)
- **Admins/moderators:** custom claim `lulafind_role`, set only with `scripts/set-admin.mjs`. Do not use a claim called `role` — Supabase would try to switch to a Postgres role with that name.

---

## One-time setup (do these in order)

1. **Firebase console → Authentication → Sign-in method:** enable **Email/Password** and **Google**.
2. **Firebase → Authentication → Settings → Authorised domains:** add every web origin you use (e.g. `lulafind.co.za`, the Arena preview host). `localhost` is there by default.
3. **Supabase → Authentication → Sign In / Providers → Third-Party Auth → Add provider → Firebase**, project ID `lulafinds-app`. Without this Supabase rejects every Firebase token and signed-in writes fail.
4. **Supabase → SQL editor:** run `supabase/schema.sql`, then `supabase/post-interactions.sql`. Both are safe to re-run. Do **not** run anything in `supabase/legacy/`.
5. **Android:** add the app's SHA-1 and SHA-256 fingerprints (debug and release) in Firebase → Project settings → Android app, then download a fresh `google-services.json` into `android/app/`. Google sign-in fails without them.
6. **iOS:** in Xcode add the `REVERSED_CLIENT_ID` from `GoogleService-Info.plist` as a URL scheme (Target → Info → URL Types).
7. `npx cap sync` after `npm install`.

Firebase's free Spark plan is enough: no Cloud Functions or Identity Platform are needed. Signed-in requests reach Postgres as the `anon` role (there is no `role: authenticated` claim), so the grants and policies cover `anon, authenticated` and every write checks `lula_uid()`. Logged-out visitors have no UID and can only read public rows.

### Existing accounts

People who registered with Supabase Auth before this change must sign up again with Firebase. Their old rows keep the old UUID owner ids and are no longer editable by anyone but a database admin. Delete them or re-own them by hand if needed.

---

## `records` table and RLS

`supabase/schema.sql` defines `id text`, `collection text`, `owner_id text` (the Firebase UID), `payload jsonb` and `updated_at bigint`, keyed on `(collection, id)`. The photos bucket is private; objects live under `<firebase uid>/…` and are served with one-hour signed URLs after RLS confirms the viewer can see the post or story. Full `users` rows are owner-only; `lula_user_profiles_public` strips private fields.

Tested locally in PGlite (a stubbed `auth.jwt()`, running as `anon` with RLS forced): upgrading an old uuid-owner table, re-running the script, own-profile create, cross-account writes denied, unverified email denied, tokens from another Firebase project denied, Idea vote RPC, public reads while logged out, admin claim. **Not** run against the hosted project.

---

## What you still need to do before launch

| Step | Why |
|------|-----|
| The one-time setup above | Nothing live works until Third-Party Auth is on and the schema is run |
| Revoke the Firebase Admin key that was committed under `uploads/` | It was pushed to a public repository |
| Replace `SUPPORT_EMAIL` in `src/app/core/config.ts` | Use a monitored address |
| Add a real privacy policy URL | Required by the Play Store and App Store |
| Configure FCM for push notifications | Needs APNs for iOS |
| Test sign-up, verification, reset and Google on real devices | Not exercised from this sandbox (Firebase and Supabase are unreachable here) |

---

## Feature check — from the source code

| Feature | Wired in source | Live on a real account |
|---------|----------------|----------------------|
| Create, edit, delete a post | `DataService.createPost`, `updatePost`, `deletePost` → `SupabaseApi.savePost`, `deletePost` | Not watched on a live account in this check |
| Create, join, edit, delete a Spotlight | Owner edits use `SupabaseApi.saveSpotlight`; joins/leaves use `lula_set_spotlight_membership()` to avoid broad row-update rights | Not watched |
| 24-hour stories — disappear after expiry | `expiresAt` set to `Date.now() + 86400000`; `SupabaseApi.stories()` filters at read time | Not watched for 24 hours |
| Follow / unfollow | `DataService.toggleFollow` → `SupabaseApi.follow`, `unfollow` | Not watched with two accounts |
| Private chat (three-gate: chatEnabled + upvote + mutual follow) | `ChatService.gate()` checks all three; `ChatService.ensureThread` creates the thread | Not watched with two accounts |
| Report a post | `ModerationService.report()` currently saves to the local device store; cloud report persistence is not wired | Local demo only |
| Contact us | `mailto:` link in Help and Settings → opens mail app | Link confirmed in source |
| Sign out | Clears `localStorage` session, sets `user` signal to null, navigates to `/auth` | Not watched on a device |
| Real-time updates | `SupabaseApi.init()` subscribes to `postgres_changes` on the `records` table | Not watched with a second device |
| Guest browse wall | Shows a sign-up prompt after the 4th post card for unauthenticated users | Confirmed in `home.component.ts` |
| Admin panel | `/admin` now guarded by `adminGuard` — only users with `isAdmin: true` can access it | Not watched with an admin account |

---

## What this check does not prove

- A Supabase write succeeded from a signed-in account (the table may not exist yet)
- An email arrived in an inbox
- Push notifications fire on a device
- A real Android or iOS build compiles and runs
- Supabase RLS policies are in place and correct
- Firebase sign-up, verification email and Google sign-in work end to end
