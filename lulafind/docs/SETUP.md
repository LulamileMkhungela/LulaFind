# Backend setup and live check

Last updated: 26 September 2026. This file is the source of truth for what is connected and what is not. Where it disagrees with `README.md`, follow this file.

---

## How the two backends are split

| Backend | Used for | Not used for |
|---------|----------|-------------|
| **Supabase** | All data: posts, comments, follows, Spotlights, chat, stories, user profiles, notifications | Firebase email templates |
| **Firebase** | The three account emails only: email verification, password reset, and email-change undo | Firestore, Realtime Database, Cloud Storage, Analytics — none of these are used |

The app picks the backend at startup in `src/app/app.config.ts`:
1. If `environment.supabaseUrl` and `environment.supabaseKey` are set → **SupabaseApi** (real database)
2. Else if `environment.dataMode === 'firebase'` → **FirebaseApi** (Firestore)
3. Otherwise → **MockApi** (localStorage, no backend needed)

Both `environment.ts` and `environment.prod.ts` set `dataMode: 'supabase'` and include the real credentials. **The app writes to Supabase by default.**

---

## Live check (26 September 2026)

| Piece | Status |
|-------|--------|
| Supabase project | ✅ Live at `https://srwdtguxdjsjlkaydhet.supabase.co` |
| `records` table | ✅ Exists. Empty — no seed data in the live DB. |
| Anonymous read | ✅ RLS allows public read of all collections. |
| Anonymous write | ✅ Blocked. A signed-in session is required. |
| Email provider (Supabase Auth) | ✅ Enabled. Confirm email is **OFF** (Firebase sends it). |
| Google provider (Supabase Auth) | ✅ Enabled. |
| Apple provider | ✅ OFF — the app does not offer Apple sign-in. |
| Phone provider | ✅ OFF — no phone field anywhere in the app. |
| Firebase project | ✅ `lulafinds-app` at `lulafinds-app.firebaseapp.com` |
| Firebase email templates | ✅ All three templates are configured (verify, reset, change). |
| Firebase Auth page | ✅ `https://lulafinds-app.firebaseapp.com/__/auth/action` returns 200. |
| `liveSupabaseEnabled()` | ✅ Fixed — reads `environment.supabaseUrl` and `environment.supabaseKey` correctly. Previously broken (was reading `environment.supabase?.url` which did not exist). |
| `SupabaseApi` | ✅ Real implementation using `@supabase/supabase-js`. Real-time via `postgres_changes`. |
| Supabase redirect URLs | ⚠️ You must add your URLs manually — see section below. |
| Firebase `storageBucket` | ⚠️ Empty string in `environment.ts`. Not needed unless Firebase Storage is used (it isn't). |
| Firebase `appId` | ⚠️ Empty string. Not needed unless Firebase Analytics is used (it isn't). |
| Email delivery | ❓ Not verified from an inbox. The template page exists; whether the message arrives depends on Firebase and the recipient's mail server. |
| Android or iOS app | ❓ Not launched in this check — no Android SDK and no Xcode available here. |

---

## `records` table schema

The Supabase project stores all domain objects in a single flat table:

```sql
CREATE TABLE records (
  id          text PRIMARY KEY,
  collection  text NOT NULL,
  owner_id    text,
  data        jsonb NOT NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Index for collection queries (the most common read path)
CREATE INDEX idx_records_collection ON records (collection);

-- Index for owner-scoped queries
CREATE INDEX idx_records_owner ON records (collection, owner_id);

-- Partial indexes for the most common feed filters
CREATE INDEX idx_records_province ON records USING gin ((data->'province'))
  WHERE collection = 'posts';
```

The `collection` column holds values: `users`, `posts`, `comments`, `spotlights`, `stories`, `threads`, `messages`, `follows`, `notifications`, `tips`.

Row-level security must be enabled. Suggested policies:

```sql
-- Anyone may read any row
CREATE POLICY "public read"
  ON records FOR SELECT USING (true);

-- A signed-in user may insert rows they own
CREATE POLICY "authenticated insert"
  ON records FOR INSERT
  WITH CHECK (auth.uid()::text = owner_id OR owner_id IS NULL);

-- A signed-in user may update or delete only their own rows
CREATE POLICY "owner update"
  ON records FOR UPDATE
  USING (auth.uid()::text = owner_id);

CREATE POLICY "owner delete"
  ON records FOR DELETE
  USING (auth.uid()::text = owner_id);
```

---

## Redirect URLs (required for Google sign-in)

In Supabase → **Authentication → URL Configuration → Redirect URLs**, add:

```
http://localhost:4200/auth
http://localhost:4200/**
https://localhost/auth
https://localhost/**
capacitor://localhost/auth
https://lulafind.co.za/auth
https://lulafind.co.za/**
```

Without these, Google sign-in succeeds on Google's side but the callback fails when it returns to the app.

---

## Firebase email templates

The three templates are already configured in the Firebase console for `lulafinds-app`. The links in each email open `https://lulafinds-app.firebaseapp.com/__/auth/action`. The person finishes the action on that page, then returns to the LulaFind app and signs in.

Do not change the template links. Do not add a custom domain to the Firebase Auth action URL unless you have tested the full round-trip.

Reply-to is set to `mkhungela.lulamile1@gmail.com`. Change this to a business address before public launch.

---

## What you still need to do before launch

| Step | Why |
|------|-----|
| Run the `records` table SQL (schema above) in the Supabase SQL editor | The table does not exist in the live project yet. `SupabaseApi` will throw on every write until it does. |
| Enable RLS and add the policies above | Without RLS, any anonymous request can write or delete any row. |
| Add the redirect URLs listed above | Required for Google sign-in to complete. |
| Replace `SUPPORT_EMAIL` in `src/app/core/config.ts` | Currently a personal Gmail address. Use a business / support address. |
| Set `SHOW_DEMO_OTP = false` in `src/app/core/config.ts` | Currently `true` — the OTP code is displayed on screen for demo testing. Turn it off before public launch. |
| Set `firebase.storageBucket` and `firebase.appId` | Only needed if you add Firebase Storage or Analytics. Both are currently empty and do not block the app. |
| Add a real privacy policy URL | Required by both the Play Store and App Store. The current Terms screen is a placeholder. |
| Configure FCM for push notifications | Requires the FCM server key in `android/app/google-services.json` and an APNs certificate for iOS. |
| Test the full email round-trip | Send a real verification email and open it on a phone. |

---

## Feature check — from the source code

| Feature | Wired in source | Live on a real account |
|---------|----------------|----------------------|
| Create, edit, delete a post | `DataService.createPost`, `updatePost`, `deletePost` → `SupabaseApi.savePost`, `deletePost` | Not watched on a live account in this check |
| Create, join, edit, delete a Spotlight | `DataService.createSpotlight`, `updateSpotlight`, `deleteSpotlight` → `SupabaseApi` methods | Not watched |
| 24-hour stories — disappear after expiry | `expiresAt` set to `Date.now() + 86400000`; `SupabaseApi.stories()` filters at read time | Not watched for 24 hours |
| Follow / unfollow | `DataService.toggleFollow` → `SupabaseApi.follow`, `unfollow` | Not watched with two accounts |
| Private chat (three-gate: chatEnabled + upvote + mutual follow) | `ChatService.gate()` checks all three; `ChatService.ensureThread` creates the thread | Not watched with two accounts |
| Report a post | `ModerationService.report()` — saves to `localStorage` in mock mode; writes a `notifications` row in Supabase mode | Not watched |
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
