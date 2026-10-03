# Session state — 2026-10-03 (round 4)

Four complaints, one audit: joining a Spotlight said "permission denied"; a photo
upload errored; a photo alone was not allowed to be a post; the Spotlight pages
were not a community. `docs/DESIGN-audit-and-fixes.md` has the causes and the
reasoning for each. What belongs here is where the code moved.

- **A membership never depends on one RPC again.** `SupabaseApi.setSpotlightMembership`
  goes RPC → narrow row update (CAS on `records.updated_at`) → device queue, and only
  a refusal *about the person* (suspended, owner leaving) still reaches them.
  `DataService.spotlightSync()` is what a page shows as a one-line notice, and it is
  read from the queue, not from which call just ran. `spotlightMembershipQueued()` is
  the API seam for that; Mock and Supabase implement it, Firebase inherits false.
- **Media has one size ceiling and no `fetch()`.** `core/utils/media-encode.ts`
  (`jpegUnder`, `storableBlob`, `dataUrlToBlob`, `approxBytes`, `MAX_STORED_BYTES`)
  replaced the `fetch(data:)` call that made every upload throw; the picker refuses an
  over-ceiling clip by size before reading it; `MAX_UPLOAD_BYTES` derives from the same
  number, so the client cannot promise past the bucket's 5 MB.
- **`lf-media-img` / `lf-media-video`** resolve `storage://photos/…` at render time,
  retry an expired signature once, and then say "not available here yet" with a retry.
  They replaced raw `<img>`/`<video>` in the feed card, the post page (post media, the
  repost embed, comments and replies) and chat. Both extend one `@Directive` base — an
  undecorated abstract class is invisible to the template compiler (NG8002).
- **A photo is a post.** `createPost` needs title, body or attachment — one of them;
  `autoTitle()` derives the headline; province is inherited from the profile and the
  town is optional. A stuck attachment no longer takes the post down with it
  (`MediaUploadError.recoverable` → "Post without the photo" / "Try again"), and
  comments upload each file on their own (`commentMediaNotice`).
- **Send is a sheet** (`lf-send-sheet`, mounted once in `app.component.ts`, driven by
  `PostActionsService.sendTarget()`): the post, the mutual-follow list, a note, Send.
  `ChatService.sendPost` returns false when it is not allowed instead of throwing.
- **Spotlight rebuilt as a hub and a directory** (`pages/spotlight/spotlight-detail.component.ts`,
  `pages/tabs/spotlight.component.ts`), with `?spotlight=` prefilling the composer's
  audience and `?tab=members` deep-linking the member list.
- **SQL that is safe to re-run**: `"lula spotlight join"` (a member may rewrite a
  spotlight row only to move themselves in `memberIds`), the membership function's
  execute grant, and check 9 in `check-setup.sql`.

The card's `…see more` threshold went 120 → 150 → **130**: it is an estimate of three
clamped lines on a phone-width card, and the test renderer reports zero height, so
measuring is not available here. `components.spec.ts` pins the label's wording.

# Session state — 2026-09-29 (round 3)

## Post card, checked against LinkedIn line by line

Fixed on `lf-post-card` (the differences were real, not cosmetic):

- **The poster's headline** now sits under their name, which is LinkedIn's
  second header line and was missing here (`authorHeadline()`).
- **Text clamps to three lines**, not four, with a muted "…see more" that reads
  like LinkedIn's link rather than a bold button.
- **The header aligns to the top** of the avatar block instead of centring it.
- **The embedded original** in a reshare shows the original author's headline
  (falling back to the province) instead of "province · category".
- Stats line sized like LinkedIn's (13px), body text 14.5px/1.4.

What is still deliberately not LinkedIn: the category chip above the text (this
is a missing-person app; the chip is the label) and the private-chat row under
the action bar (chat opens only for "Have an idea" plus a mutual follow). The
react button says "Have an idea" rather than "Like" by your instruction.

## The story card is reachable from any feed now

`feedWithRails(posts, 8, { shortRail: true })`: a feed that never reaches its
8th post gets **one story rail after its last post** (previously a short feed had
no rail at all). A feed with nothing in it renders the story rail **above the
empty state**, so the story card is always somewhere on Home. Rails still never
appear above the first post, and a feed that does reach an 8th post uses the
normal slots (Stories 8, People 16, Stories 24) with no extra rail.

## Tests

134 pass (`npx ng test --watch=false`), including new render tests that mount
the **post page** (asserting the case-details accordion and the poster link are
gone from it) and **Home** (asserting the story rail and its "Create story" card
are in the DOM), plus the pure `feedWithRails` cases for the short-feed rail.

# Session state — 2026-09-29 (round 2)

## What this round changed, in the order the review asked for it

1. **Reactions are LinkedIn's, with "Have an idea" as the default.**
   `DEFAULT_REACTION_LABEL` ("Have an idea") lives in `core/models/types.ts`.
   The button reads that until you react, then reads the reaction you chose
   (Like / Support / Sad / Have an idea) in that reaction's colour. Quick tap =
   default reaction; hold (420ms mouse hover) opens the tray of four; release
   over one to pick it. Only `up` opens private chat - `ChatService.gate`
   checks `voterIds[me] === 'up'`, so Like/Support/Sad never unlock a chat.
2. **Feed rails moved to where they were asked to be.** `feedWithRails()`
   (`core/utils/feed.ts`) is now a tested pure function: Stories after the 8th
   post, People after the 16th, Stories after the 24th. Nothing above the first
   post, nothing after the last one. No "fallback" rail at the end of a short
   feed any more.
3. **Reshares look like LinkedIn's.** A repost card opens with
   "You reposted this" / "<Name> reposted this" and the repost glyph above the
   header, then the reposter's own words, then the original inside a bordered
   frame with its own avatar, name, headline, time and globe. Same line and same
   frame on the post page.
4. **The post page is now a post.** The case-facts accordion, the contact card
   and the row of pills (poster, help, escalate, location) are gone from it.
   What is left: the post, the stats line, the LinkedIn action bar
   (react / Comment / Repost / Send), one compact private-chat line when the
   poster enabled it, then "This is me / Not me" or "Mark as found /
   Still searching", then the comments. The poster page moved to the author's
   "..." menu so it is still reachable.
5. **Comments are LinkedIn's.** One composer in the flow (the duplicate footer
   composer is gone), "Most relevant / Most recent", then bordered comment cards
   with the author's name + bio, comment text, and a Like / Reply / count / time
   row inside the card. Replies indent under "View N replies". Editing a comment
   shows "Edited" and deleting says "Comment deleted".
6. **Stories stop disappearing.** The viewer keeps its own copy of the story, so
   a background rail refresh cannot pull it out from under the reader. Reading
   time is longer (6s + ~0.5s a word, floor 9s, ceiling 45s). The moment someone
   engages - types a reply, opens the viewer list, holds to read - auto-advance
   switches off for that visit; a plain tap still moves on. On the last story the
   bar stops instead of closing the viewer. The reply box stays "typing" while it
   has text in it, so dismissing the keyboard no longer resumes the timer.
7. **Camera on Android is handled instead of thrown.** `PlatformService.hasPlugin()`
   wraps `Capacitor.isPluginAvailable`, `MediaService` never calls a plugin that
   is not in the build, asks for the camera permission before using it, and falls
   back to the phone's photo picker with a plain notice ("This build has no camera
   module..."). `PermissionsService` is a real wrapper now: it checks and requests
   Camera / Geolocation / PushNotifications and reports "Not in this build"
   instead of a raw UNIMPLEMENTED error. To get the camera itself, rebuild the
   APK after `npx cap sync` - the Gradle settings already include the plugin.
8. **Posters.** Two new templates, `halo` (mesh-gradient glass card) and `pulse`
   (neon grid, ringed portrait) join the existing six, so there are eight modern
   designs. Tested in `lulafind.spec.ts`.

Everything above is covered by `npx ng test --watch=false`: 128/128 pass, and
`ng build --configuration production` is clean.

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

## Session: LinkedIn-style UI pass (2026-09-29)

**Before you run the app**
- Re-run BOTH `supabase/schema.sql` and `supabase/post-interactions.sql`. The vote RPCs now accept `up`, `like`, `support`, `sad` (and legacy `down`). Without this, reactions other than "Have an idea" are rejected by Supabase.
- Android: `npm run build && npx cap sync android`, then rebuild the APK. `@capacitor/filesystem` was added (poster sharing) and `@capacitor-firebase/authentication` was missing from the generated gradle files. The Camera plugin error came from a stale native sync. `MediaService` now also falls back to the system file picker if the plugin is still missing.

**What changed**
- Theme: black by default, six selectable backgrounds in Settings (`SettingsService.BACKGROUNDS`).
- Top nav: avatar, search, bell. Bottom tabs: Home, Spotlight, Create, Chats, Menu. Ask Lula lives only on the Chats page (rule-based, `core/data/ask-lula.ts`, not a live AI model).
- Feed: a stories rail and a people rail alternate after every 8th post. Feeds shorter than 8 posts show the stories rail at the end.
- Reactions: Have an idea (default tap), Like, Support, Sad; long press opens the picker. Any reaction unlocks chat.
- Repost sheet + `/repost/:id` composer, Send, ⋯ menu (`PostActionsService`).
- Post detail rewritten: read, react, comment (LinkedIn threading), then This is me / Not me (adult cases) or Mark as found / Still searching (poster). Facts, contact, help and chat sit under "Case details". The ground-search, danger and location-check panels were removed from this page (the routes and services still exist).
- Vehicle, danger and story post types are retired (`RETIRED_POST_TYPES`): hidden from feeds, rejected by `createPost`. Existing rows are not deleted.
- Poster: six canvas templates (Signal, Aurora, Editorial, Beacon, Ubuntu, Noir) in `core/utils/poster.ts`, shown after publishing a missing / left-home / pet post.
- Stories: viewer pauses while typing, holding, hidden, or (owner) reading replies; longer time for text. Composer text is now a signal so Share enables while typing.

### Follow-up (same day)
- Only "Have an idea" (`up`) opens private chat. Like / Support / Sad are reactions only. The lock button on a card gives "Have an idea".
- "No idea" is gone completely: no `down` vote, no `downvotes` field, no crossed-out bulb or thumb-down icons, and the SQL vote RPCs no longer accept or count it. Re-run both SQL files.
- Story composer defaults to a black background (`STORY_BLACK = -1`), with other colours as options. The composer now follows the app theme instead of fixed light colours.
- De-duplication: feeds and lists keep one copy per post id; a post's heading, name and last-seen lines are hidden when the text already says them; the Menu no longer repeats Alerts, Spotlight or Privacy (bell, tab and gear already do that).

## Merge with main (PR #9 work from `arena/01a0ea80-lulafind`)

Main had a parallel build of the same areas. Where both touched the same screen, this branch's version won because it matches the latest requirements (LinkedIn top nav, Ask Lula only on Chats, black default story, only "Have an idea" unlocks chat, no vehicle/danger/story types, six poster templates).

Kept from main: `lastLike`/`lastComment` and the "X commented on this" line on cards, comment `likedIds`, the `repost` notification kind (now sent by `repost()`), `suggestedPeople` (now ranks the people rail), the "who reacted" sheet (rewritten for the four reactions, opens from the reaction count on cards and post detail), `.gitignore`/README changes.

Dropped from main (still in git history at `2e94389`): floating Lula assistant, discover rail, text-template poster composer + `poster-parse` + `poster-visual`, `reshare()`/`reshareOf`/`repostCount` (duplicate of `repost()`/`repostOf`).

## Round 4 — research round: alerts, review and leads (commit `68f3df0`)

**Private chat is mutual follow only.** A reaction never unlocks chat, and no
copy anywhere promises it: `ChatService`'s gate has no `'vote'` reason, and a
test fails the build if the gate ever mentions a reaction again.

**Case alerts exist now.** `DataService.alertCase()` sends a new missing or
KhumbulEkhaya case to members in the province it happened in, honouring each
member's own `alertPrefs` (switch, children-only, province) which Settings
keeps on their profile. The author and suspended accounts are never alerted.
Each alert shows a distance from the member's own last location fix.

**A child case is checked before it is broadcast.** Under-18 cases are created
`under_review`; the admin screen has a Review tab where an admin publishes
(which sends the alert and reports how many members it reached) or rejects
(off the feed, no alert). `ModerationService.pendingCases/approveCase/rejectCase`.

**Leads are surfaced.** The case page counts leads, shows the newest one and how
many are checked, and an admin can mark a sighting as checked against CCTV,
police, records or a photo (`sightingVerified`, already modelled, now visible).

**Density.** Help, settings, safety centre, profile and create-post prose were
trimmed; the long answers live on `/faqs`, generated from `LULA_TOPICS` plus
housekeeping entries. New answers: SAPS 55 form, the 24-hour myth, what never
goes in a case post, spotting a scam, who receives an alert, and the review
queue.

**Story composer.** Full-screen black canvas by default, typing straight on it
(WhatsApp-status style), with a privacy choice; colours are the fallback, not
the default.

**Research file.** `docs/RESEARCH-COMPETITORS.md` holds the SA figures with
sources, the competitor matrix and the features mined but not built yet
(search-party zones, first-72-hours checklist, post-quality guard, scam
shortcut, cross-border flag, NGO/SAPS verification).

**Every journey, gated and finished.** `tools/e2e-journeys.mjs` drives a real browser through
sign-up (five steps, each one refusing to advance without its own data), the composer, comments,
the action row, editing, reporting, following, search, the poster maker, the story composer and
sign-in - 40 verdicts, read back from the app's own store. It found and fixed:

- the composer lost everything typed if the phone rang mid-post: it now keeps the text and says so,
  with **Start fresh** to throw it away (the story composer does the same);
- the story **Share** button was disabled with no reason - now it always answers a tap and names
  what is missing;
- a removed post rendered as an empty screen - now "This post is no longer available" with the way
  back home;
- `/admin` bounced a signed-in non-admin home with no explanation - now it says why;
- the action row clipped the longest label ("Have …"). It is now measured at 390 / 360 / 320 px:
  every word stays whole, and nothing overlaps.

The results table and the honest list of what a browser run cannot click (camera, share sheet,
push, the admin actions, the cron) are in `docs/JOURNEYS.md`.

**The last-seen control now exists.** `privacy.showLastSeen` was read by the profile and lookout
screens but no screen could set it. Settings → Privacy & data now has **Show my town and last
seen**, and the lookout run drives it: off reaches the account (`showLastSeen:false`, screenshot
`03b`) and the toast says what an open lookout still shows, then back on. The run is 17 steps,
0 problems.

**Measured: responsive, aligned, quiet, quick.** `tools/e2e-quality.mjs` renders 18 screens x 6
widths (320 / 360 / 390 / 414 / 768 / 1024) with real content and reads the numbers off the page:
**0 sideways scroll, 0 off-edge elements, 0 clipped words, 0 targets under 24px, 0 overlapping
controls, 0 contrast failures** (was 53 low-contrast text runs at every width, 15-16 tiny targets,
3 clipped words). What it found and I fixed:

- `Tips` and `Terms & privacy` rendered **without a title** - the header showed the home search bar;
- the `Chats` row cut a full sentence off with an ellipsis; it wraps now;
- `Share this tip` was a 111x13 button; follower counts 82x15; the audience picker 178x15 inside a
  21px label; `Browse as guest` 123x15; round icon buttons 36x36; consent checkboxes 19x19 - all
  raised to comfortable sizes;
- white on `--lf-primary` failed AA in dark mode, red-as-text used the fill red, and dark links
  sat at 4.06:1: new `--lf-primary-fill` / `--lf-signal-text` tokens, and a dark `--lf-link`;
- the "Local data mode" banner was white on blue at 3.46:1 - now a quiet card strip.

**Production build had no minification** (`optimization` off): 2.3 MB of readable JS. Now minified
+ brotli/gzip with a one-year cache on hashed files (`tools/serve-www.mjs`, preview on :4300):
**first load 456 kB, FCP 128-160 ms**; reload 0 kB. Route change 11-24 ms, tap-to-change 23-27 ms,
0 long tasks, 0 layout shift. `docs/QUALITY.md` has the tables and the honest limits (no network
throttling, one engine, no screen-reader pass).

**A fast preview that still has the development switches.** A production build deliberately
disables `?data=local` and `?demo=1` (a real build must never invent data), so the production
preview cannot be used interactively here - the hosted project is unreachable. `ng build
--configuration development --optimization=true` gives a minified build that still has the dev
switches: served by `tools/serve-www.mjs` on 4300 (brotli/gzip, SPA fallback, one-year cache on
hashed files), it renders the home feed with FCP 60-200 ms and 0 console errors. The production
numbers in `docs/QUALITY.md` come from the real production build before that.

**Data saver was a switch that changed nothing.** Settings → Appearance had "Data saver (smaller
images)" and "Autoplay media in the feed", both stored and rendered, and no code read either one.
While measuring the first load I found why the app pulls ~98 script files: `PrefetchService` walks
the route table after start-up and imports every screen on purpose, so taps are instant - which is
~550 kB of JavaScript nobody asked for on a phone in Soweto. Now:

- Data saver (renamed "less background loading") stops the walk, and so does the phone's own
  `navigator.connection.saveData`, a 2G link, or being offline. Cold load: **387 kB / 61 requests
  instead of 596 kB / 105**. A screen then costs its chunk when opened - 19 ms and 24 kB for
  Spotlight on localhost, one round-trip on a real network;
- Autoplay (renamed "Autoplay stories") decides whether a story advances on its own;
- `core/prefetch.spec.ts` pins the rule (5 tests, suite now 182).

**Corrected load numbers.** The earlier table in docs/QUALITY.md (456 kB, FCP 128-160 ms) was wrong:
warm cache, and a window that ended before the last chunks arrived. `tools/measure-load.mjs` uses a
fresh context per run: cold load is **596 kB / 105 requests / FCP 224-288 ms**, reload 0 kB. The
production config also had optimization off (2.3 MB of readable JS) - now minified and served
compressed by `tools/serve-www.mjs`.
