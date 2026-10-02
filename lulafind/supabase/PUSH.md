# Push notifications (FCM) — setup

Push has three halves and they were only ever one-and-a-half done:

| Half | Where | State |
|---|---|---|
| Ask the phone and register the device | `src/app/core/services/push.service.ts` | done |
| File the token against the account | `public.push_tokens` + `SupabaseApi.savePushToken()` | **done in this change** |
| Send to that token | `supabase/functions/send-push/` | **done in this change** |

Until the second half existed, registering a device produced a token that lived
in `Preferences` on the phone — which no server can read. The app reported
"registered" and nothing ever arrived.

## 1. Create the table

Supabase dashboard → **SQL editor** → New query → paste `push-tokens.sql` → Run.

Safe to re-run. It creates `public.push_tokens` and four row-level-security
policies that let a person touch only their own tokens.

## 2. Deploy the sender

```bash
npx supabase functions deploy send-push
```

## 3. Give it the service account

Firebase console → **Project settings** → **Service accounts** → **Generate new
private key**. That downloads a JSON file.

```bash
npx supabase secrets set FCM_SERVICE_ACCOUNT="$(cat ~/Downloads/lulafinds-app-*.json)"
```

**This key never goes in the repo.** It signs tokens that can send a
notification as your project. If it ever lands in git, rotate it in Firebase
immediately — a leaked Admin key is not the same as a leaked publishable API
key, which is safe by design.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions
automatically, so there is nothing to set for those.

## 4. Hook the database to the function

**Use the Dashboard webhook. It is the documented, supported route.**

Supabase dashboard → **Database** → **Webhooks** → **Create a new hook**:

| Field | Value |
|---|---|
| Table | `public.records` |
| Events | `INSERT` |
| Filter | `record.collection = 'notifications'` |
| Type | Supabase Edge Function |
| Function | `send-push` |

Every in-app notification now also buzzes the phone. Nothing else in the app
changes — the bell still reads from the same rows.

### Why not a SQL trigger

An earlier revision of this repo shipped `supabase/push-webhook.sql`, a
hand-written trigger calling `supabase_functions.http_request(...)`. It has been
removed. `supabase_functions.http_request` is the helper Supabase's own webhook
feature uses internally; it is not a documented public API, its signature is not
guaranteed across project versions, and there is no way to confirm from here
that a given project even provisions the `supabase_functions` schema. Shipping
SQL that might fail, as the recommended path, is worse than pointing at the
button that always works.

The dashboard webhook creates an equivalent trigger behind the scenes and
Supabase injects the service-role authorization header itself — which is also
why no key appears anywhere in this repo.

## How a token gets there

1. App starts → `PushService.init()` → asks FCM for a token
2. FCM returns one → `registration` event → saved in `Preferences` **and**
   upserted into `public.push_tokens` against the signed-in account
3. FCM rotates the token later → `registration` fires again → the row is
   overwritten, because the upsert keys on the token rather than on the user
4. Cold start usually registers *before* the session is restored, so step 2
   runs with no identity. An `effect()` watching `signedIn()` re-files the
   stored token the moment someone signs in — which covers email, Google,
   demo and restored-session sign-in without any of them knowing push exists
5. Sign-out → `clearToken()` deletes only this device's row, so signing out on
   a phone does not silence the tablet

## Verifying it

Sign in on a device, then from the app console:

```js
await window.__lulaDebugStorage()   // unrelated, but proves Supabase is talking
```

To see the token landed, in the SQL editor (NULL uid is expected there):

```sql
select platform, app_version, created_at from public.push_tokens;
```

Then trigger a notification — a follower posting, or a Home Sweet Home answer —
and watch the function log:

Dashboard → **Edge Functions** → **send-push** → **Logs**.

(`npx supabase functions logs` was removed from recent CLI versions, which is
why it reports as an unknown command.)

## Notes

- **Web has no FCM.** `PushService` is a no-op in a browser and the spec pins
  that. Push is a native feature; the web build gets the in-app bell only.
- **Release builds need their own SHA-1.** The Android OAuth client in
  `google-services.json` carries a certificate hash. It matches the debug key
  you confirmed; a Play Store release is signed with a different key and will
  fail with `DEVELOPER_ERROR` until that SHA-1 is added to the same Firebase
  app and the JSON re-downloaded.
- **Dead tokens are pruned** by the function when FCM reports `UNREGISTERED`,
  so an uninstalled app stops costing a send.
