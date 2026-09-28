# Backend setup and live check

Last updated: 28 September 2026. This file is the source of truth for what is connected and what is not. Where it disagrees with `README.md`, follow this file.

---

## How the two backends are split

| Backend | Used for | Not used for |
|---------|----------|-------------|
| **Supabase** | Email/password, email confirmation and password recovery; the app's signed-in session, profiles, RLS and all app data/photos. Google uses `signInWithIdToken` only to establish this Supabase session. | Google OAuth redirects for the Google button |
| **Firebase** | Google identity on Android, iOS and web. Firebase Authentication obtains Google's ID token, which the app exchanges with Supabase. | App data, Firestore in the active flow, email/password and recovery |

The Google button follows this path: **Firebase Google sign-in → Google-issued ID token → Supabase `signInWithIdToken` → existing profile/data/RLS flow**. It does not use Supabase's Google OAuth redirect. Email/password, recovery, and the existing Apple path are kept separate.

The app picks its data adapter at startup in `src/app/app.config.ts`:
1. If `environment.supabaseUrl` and `environment.supabaseKey` are set → **SupabaseApi** and the Supabase Auth client.
2. Else if `environment.dataMode === 'firebase'` → **FirebaseApi** for Firestore data.
3. Otherwise → **MockApi** and local demo credentials.

Both `environment.ts` and `environment.prod.ts` set `dataMode: 'supabase'` and include the publishable Supabase key. Email/password and recovery use Supabase Auth. Firebase Google sign-in is bridged into the same Supabase session for the app's existing RLS-protected data.

---

## Configuration status (26 September 2026)

| Piece | What the repository confirms |
|-------|------------------------------|
| Supabase source configuration | `environment.ts` contains the project URL and publishable key; this does not prove a live request succeeds. |
| Records schema | `supabase/schema.sql` uses `(collection, id)` as the key, `owner_id uuid`, and `payload jsonb`. The hosted schema and policies have not been checked from this code session. |
| Story privacy migration | `supabase/story-privacy.sql` is the idempotent migration for an existing project. It backfills legacy reply/viewer projections into private rows, strips them from story payloads, and replaces the known RLS policies. It has not been run against the hosted database. |
| Auth source code | Email/password and recovery stay on Supabase. Google uses Firebase Auth and exchanges the Google ID token through Supabase `signInWithIdToken`; the Google button does not call `signInWithOAuth`. |
| Supabase providers and SMTP | Google and Email provider settings and SMTP must be verified in the dashboard; code cannot enable providers or guarantee mail delivery. |
| Firebase Web App ID | Blank in both environment files intentionally. Copy the real `appId` from Firebase Console → Project settings → General → Your apps → Web app. |
| Android OAuth client | The local Android config currently has the Web OAuth client but no Android OAuth client. Register signing SHA-1 fingerprints, then download an updated `google-services.json`. |
| iOS Google configuration | `GoogleService-Info.plist`, bundle ID `com.lulafind.app`, and reversed-client URL scheme are present. Xcode/device sign-in still needs testing. |
| Live writes, Google token exchange, and email delivery | Not verified against hosted services in this session. |
| Android/iOS sign-in | Native Android/iOS builds and Google sign-in round-trips have not been verified on a device. |

---

## `records` table schema and RLS

The Supabase adapter stores domain records in one flat table. The authoritative, repeatable SQL is [`supabase/schema.sql`](../supabase/schema.sql): it defines `id text`, `collection text`, `owner_id uuid`, `payload jsonb`, and `updated_at bigint`, with a composite primary key on `(collection, id)`. The adapter reads and writes `payload` (not `data`).

For a new project, run `supabase/schema.sql`. For the existing project, run `supabase/story-privacy.sql`; it replaces the known `lula read`/write policies, migrates old embedded story replies and viewers into separate RLS-protected records, removes those private projections from each story row, and installs the same audience checks used by the new-project schema. It also removes the old broad Spotlight-update and reports-read policies, replacing unrestricted membership writes with `lula_set_spotlight_membership()`.

The photos bucket is private. New uploads are stored as object paths, and the adapter obtains a one-hour signed URL only after RLS confirms the viewer can access the referencing post or story. This prevents a permanent public storage URL from bypassing story audiences (a signed link can still be shared while it remains valid). Full `users` records are readable only by their owner (or a trusted moderator); the `lula_user_profiles_public` view strips email/admin fields and returns exact check-in coordinates only during an opted-in, active live share. Town/province sharing is off until the person opts in; stats and Spotlight membership follow their visibility switches. In Supabase, assign `app_metadata.role` (`admin` or `moderator`) only through a trusted server/Admin API; RLS ignores client-editable profile flags for privileges. The app also orders Supabase records by the schema's `updated_at` column (not the nonexistent `created_at` column), so cloud reads no longer silently fall back to local demo data for that query error.

The migration has not been run against the hosted project from this session. After applying it, run `supabase/verify-rls.sql` in the SQL editor; it inserts rollback-only fixtures and asserts sanitized public profiles, owner-only full profiles, denied self-assigned privileges, public/follower/Spotlight visibility, story-photo signing, author-only insights, legacy post status, private follow approval, and denied cross-audience reply writes. Then smoke-test with two real accounts. `lula_post_visible()` treats legacy posts with a missing status as active, not SQL `NULL`/hidden.

---

## Redirect URLs (required for OAuth and recovery)

In Supabase → **Authentication → URL Configuration → Redirect URLs**, add:

```
http://localhost:4200/auth
http://localhost:4200/**
https://localhost/auth
https://localhost/**
capacitor://localhost/auth
https://lulafind.co.za/auth
https://lulafind.co.za/**
https://**.e2b.app/**
```

Add the exact preview origin if the wildcard is rejected. These allowed redirects are for password recovery and the existing Apple redirect path. Google sign-in uses Firebase's native/web Google sign-in and Supabase's ID-token exchange, so it does not return through a Supabase OAuth redirect. Enable Google in Supabase Auth and configure the matching Google Web OAuth client; keep any client secret in the Supabase dashboard, never in app source. Password-reset email redirects return to `/auth?mode=newpass`.

---

## Firebase Google sign-in setup

1. In [Firebase Console](https://console.firebase.google.com/) → **Authentication → Sign-in method**, enable **Google** for project `lulafinds-app`.
2. Under **Project settings → General → Your apps**, open the Firebase **Web App** and copy its exact Firebase `appId` (the value beginning with `1:`) into the `appId` field in both `src/environments/environment.ts` and `src/environments/environment.prod.ts`. Do not use the iOS `GOOGLE_APP_ID` or an OAuth client ID in this field.
3. For Android, add SHA-1 fingerprints for each signing certificate at **Project settings → Your apps → Android app → SHA certificate fingerprints**. Get local fingerprints from Android Studio's **Gradle → signingReport** task. For Play Store releases, also add the **App signing key certificate SHA-1** shown under Play Console → **App integrity → App signing**. Download the updated `google-services.json` and put it at `android/app/google-services.json`; it is intentionally ignored by Git.
4. For iOS, verify the `GoogleService-Info.plist` belongs to bundle ID `com.lulafind.app` and that its `REVERSED_CLIENT_ID` is the `CFBundleURLSchemes` entry in `ios/App/App/Info.plist`. Both are present in this workspace. Run `npx cap sync ios`, build in Xcode, and test on an iOS device.
5. In Supabase → **Authentication → Providers → Google**, enable the provider and configure the same Google Web OAuth client used by Firebase. This is the verifier for `signInWithIdToken`; Google does not use the Supabase redirect URI in the app's Google flow.
6. Run `npx cap sync` after changing plugin or native config, then test Android on a device/emulator with Google Play Services and iOS on a device. Native builds were not available in the code session because Java/JAVA_HOME and Xcode were not available.

The Web App ID could not be fetched from Firebase during this code session (the Firebase Management API request was unreachable), so both source values remain blank instead of using a guessed ID. The local Firebase Admin service-account JSON under `uploads/` is excluded from the current source tree and ignored. It was present in an earlier repository commit, so revoke/rotate that service-account key in Google Cloud IAM; a private GitHub repository does not make a committed private key safe.

---

## What you still need to do before launch

| Step | Why |
|------|-----|
| Verify the remote `records` columns match `supabase/schema.sql` (`payload`, composite key, UUID owner) | The source was inspected; the hosted database was not queried in this session. |
| Run `supabase/story-privacy.sql` and then `supabase/verify-rls.sql` in the SQL editor | Migrates private story data and policies; the rollback-only check verifies audience, follow-request, reply/view, and legacy-status rules. |
| Confirm Supabase Email and Google providers are enabled and configure email delivery | Email confirmation/recovery and Google ID-token verification depend on dashboard settings not verified by a local build. |
| Add the exact Firebase Web App ID to both environment files | Browser Google sign-in requires the actual Web App configuration from Firebase Console. |
| Register Android signing SHA-1 fingerprints and download a fresh `google-services.json` | Required so Firebase/Google can validate Android builds; the downloaded JSON is ignored by Git. |
| Test native Google sign-in on Android and iOS | Xcode/device and Android signing-provider setup were unavailable in this session. |
| Replace `SUPPORT_EMAIL` in `src/app/core/config.ts` | Use a monitored business/support address before public launch. |
| Add a real privacy policy URL | Required by both the Play Store and App Store; the current Terms screen is a placeholder. |
| Configure FCM for push notifications | Requires the FCM server key and APNs configuration for iOS. |
| Test full auth recovery and OAuth round-trips with real accounts | Confirms provider settings, callbacks, and email delivery on actual domains/devices. |

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
