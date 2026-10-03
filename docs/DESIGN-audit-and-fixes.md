# Joining, uploading, posting and the Spotlight — what was broken and what it says now

Audited on 2026-10-03 against the four complaints it was opened with: joining a
Spotlight answered "permission denied", uploading a photo on a post errored, a
photo alone was not allowed to be a post, and the Spotlight pages were not the
place a surname community should be. The sixth item — every other permission and
validation failure — is the part that took the most code.

## 1. Joining a Spotlight said "permission denied"

`records` is written through one policy, `lula update`, and that policy only lets a
Spotlight's **owner** rewrite the row (`supabase/schema.sql`). A member's join was
therefore legal only through `lula_set_spotlight_membership()`, the SECURITY
DEFINER function. If that function was never installed, or installed without
`grant execute`, the raw Postgres text — `new row violates row-level security
policy for table "records"` — was what the toast read out.

Now, in order:

1. the RPC;
2. a narrow row update that changes only `memberIds` (+ the member count), with a
   compare-and-set on the row's `updated_at` so two people joining in the same
   second keep each other;
3. a device queue in `LocalDb`, replayed on `init()`, after a sign-in, and on the
   next refresh.

Only a refusal about the *person* is still told to them: a suspended account, or
the owner trying to leave their own community. Everything about the write path is
absorbed. `DataService.spotlightSync()` says which way it landed, and the
community page shows one line when a membership is this-device-only.

`supabase/post-interactions.sql` and `schema.sql` now also create
`"lula spotlight join"`, a policy that lets any signed-in person update a
spotlight row **only** to add or remove themselves in `memberIds` — every other
key in the payload must come back byte-identical, and `followers` may rise by at
most one. That is what makes step 2 legal instead of lucky. `check-setup.sql` gained
check 9, which says whether a join has any write path at all.

## 2. Uploading a photo errored

`MediaService` handed round `data:` URLs and `compress()` ran `fetch()` on them,
which is not supported for that scheme in the WebView — so the composer threw
before anything was saved. `src/app/core/utils/media-encode.ts` is the fix:
`jpegUnder()` steps dimension and quality down until the picture fits,
`storableBlob()` decides between the original bytes and a re-encode, and
`dataUrlToBlob()`/`approxBytes()` do the arithmetic without a network call. A file
is now never read into a data URL unless it can be stored: the picker refuses an
over-ceiling clip by size, in MB, before reading it.

The size ceiling lives in one place — `MAX_STORED_BYTES` (4.8 MB, the 5 MB
`photos` bucket with room for the wrapper) — and `supabase-api.ts` derives
`MAX_UPLOAD_BYTES` from it, so the client cannot promise what Storage will refuse.

Storage objects are private, so a record holds `storage://photos/<path>`, not a
URL. `lf-media-img` / `lf-media-video` (`shared/components/media-image.component.ts`)
resolve that marker when the tile is shown, retry once when the signature expired,
and only then say "photo not available here yet" with a tap to try again. They are
wired into the feed card, the post page, the comment thread, chat and the repost
embed — where a raw `<img>` used to show a broken icon.

## 3. A photo is a post

The composer used to demand a title of 8 characters, a body of 30, a province and
a town. Now one thing is enough: `DataService.createPost()` accepts a photo with no
title and no caption (it derives a title through `autoTitle()`), keeps the
province — a post must have one, and it inherits it from the profile when the
writer has not chosen — and treats the town as optional. With neither words nor a
photo, the message says exactly that.

When the attachment is the part that fails, the post does not die with it:
`uploadMedia` throws a `MediaUploadError` marked `recoverable`, the composer shows a
strip with **Post without the photo** and **Try again**, and `mediaFailed` says
which. Comment attachments got the same treatment one level down: each file uploads
on its own, the comment goes out with what survived, and
`DataService.commentMediaNotice()` tells the writer about the one that did not.

## 4. Post card and Spotlight, against LinkedIn

- **Card**: author line with headline and `+ Follow`, three-line clamp with a
  lower-case `…see more` inside the button (`aria-expanded` on it, threshold 130
  characters — an estimate, since the test renderer reports no height), the reaction
  stack with a tappable count, `Comment`, `Repost`, `Send`, the ⋯ menu, and the
  comment thread on its own page with LinkedIn's sort, named bubbles, replies,
  photo attachments and the "no comments yet" line.
- **Send** is a sheet, not the operating system's share dialog: the post at the top,
  the people who follow you back, an optional note, one Send. LinkedIn offers every
  connection; LulaFind can only offer mutual follows, because that is what a private
  thread requires here — so the empty state says that and offers the way to fix it.
  `ChatService.sendPost()` returns false rather than throwing when it is not allowed.
- **A Spotlight is a community page**: cover, round surname mark, verified line,
  tagline, `N members · N posts · N admins · province`, Join (or Post + Leave +
  a Member chip), and Posts / Members / About as a sticky tab row (`?tab=members`
  opens the member list directly). Members post straight away — there is no
  approval queue — and the page says so. Starting a post from it arrives in the
  composer with the audience already set to the surname.
- **The Spotlight tab** is a directory: search, an A–Z row, your own surname's page,
  the communities you have joined, and suggested ones ranked by same surname and
  same province. Creating one validates the surname, requires a province, and
  refuses a duplicate (same surname in the same province) with a link to the page
  that exists.

## 5. What a refusal is allowed to say

`supabase-api.ts` classifies every failure — `isIdentityError`,
`isNoIdentityError`, `isPermissionError`, `isMissingFunctionError` — and
`explain()` turns it into the next thing to do: confirm the email link, sign out
and in again, or have an admin run `supabase/schema.sql` and
`supabase/post-interactions.sql`. The words "row-level security" never reach a
person who cannot act on them.

## 6. The rest of the parity line: cards, chats, comments

The acceptance line was "post cards, chats, commenting, interactions on post
cards and details, as per LinkedIn". Sections 4 and 5 covered the card and the
comment thread; what was left was all in chat, plus three small things on the
detail page.

**Chat.** A room used to be a list of bubbles. On LinkedIn a message is a thing
you can act on, so `ChatService` gained `reactMessage` (one reaction per person,
keyed by who, the same shape a post's votes use), `editMessage` (yours, text
only, stamped "Edited") and `unsendMessage`. Unsend keeps the row and writes
"unsend" into the gap it leaves, because a message that vanishes silently reads
as a bug on an app where people arrange to meet strangers. The room now shows
reaction pills under a bubble, Delivered/Seen under the last thing you sent
(the thread only carries a read *flag*, so the line says `Seen` and never a
time we do not have), the other person's typing dots, an action row that appears
on hover or focus and behind a `⋯` on touch, and a header magnifier that filters
the thread to what matches — day dividers and sender lines read the filtered
list, so a search does not print three "Today" lines for one hit.

Typing markers live on the thread (`typing: { userId: at }`), are written at most
once every 2 s, expire after 6 s in the reader, self-clear 3 s after the last
keystroke, and never move `lastMessageAt` — a marker is not a message, and a
thread that jumps to the top of the inbox because someone hesitated is worse
than no indicator at all.

**Comments.** The composer carries the same face row a message box does, from one
component (`lf-emoji-row`), and an `@` typeahead. The list is deliberately not the
address book: only the post's author and people already in this thread, which is
what LinkedIn does and, on a missing-person post, the right rule — an `@` is how a
stranger gets pulled into a case. Picking a name writes `@Name `, the ids land on
`Comment.mentions`, and each named person who is not the poster gets a
`mention` notification. `@` in the middle of an email address is not a mention.
A commenter you do not follow gets a `+ Follow` chip beside their name.

**Names.** One profile hovercard, mounted once by the shell (`lf-user-hover-host`,
driven by `UserHoverService`), opened by `lfUserHover` on a card author, a
reposted author, a commenter and a chat peer. One instance because a card's
`overflow` would clip a popover of its own, and it never opens on tap: a thumb on
a name means "open the profile", which the link under the finger already does.

**A bug the tests found.** `LocalDb.upsertMessage` pushed unconditionally, so the
first edit, reaction or read mark on a message added a *second copy* of it to the
thread instead of replacing it. Supabase upserts by id, so this was the
device-only path — and the room would have shown a message twice. It now replaces
in place and leaves the inbox preview alone.

## Still with the operator

The deployed schema cannot be read from here, so this round ships SQL that is safe
to re-run plus a client that works without it. On the project: run `schema.sql`
then `post-interactions.sql`, then `check-setup.sql` — check 9 must PASS. Until
then, joins and posts work, and the member list is this-device-only, which the
page says out loud.

## Verified here

```bash
cd lulafind
npx ng build --configuration development   # no errors
npx ng test --watch=false                  # 232 tests
npm run lint                               # clean
```

The suite covers the rules that were broken: a photo on its own being a post, a
title derived for it, joining when the server refuses the write, a suspended
account being told instead of faked, comment attachments that half-upload, the
`storage://` marker being signed (and retried) before it reaches an `<img>`, the
community hub's tabs, and the Send list being mutual-follows only.
