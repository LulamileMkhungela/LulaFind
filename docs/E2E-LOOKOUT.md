# Be on the lookout — driven in a real browser

HeadlessChrome 153.0.8010.0 against `http://localhost:4200`, 17 steps, from
`tools/e2e-lookout.mjs`. Screenshots are in `docs/e2e-lookout/`.

```bash
bash tools/get-browser.sh
LD_LIBRARY_PATH=/tmp/alibs/lib node tools/e2e-lookout.mjs
```

Last run: **17 steps, 0 problems, 0 console errors, 0 dead clicks.**

No demo data and no seeded accounts: `?demo=0&data=local` is forced and the two
accounts in the run are created through the real five-step sign-up screen. Every
result below is read back from the app's own store in the browser, not asserted.
`?data=local` is a development switch (the app's real services, screens and
validation on a local store) because the hosted Supabase project is not reachable
from this container — that is the one thing this evidence is not.

## What it proves, in order

| # | Step | Screenshot |
| --- | --- | --- |
| 1 | A brand-new person signs up through the real sign-up screen | `01-signup-new-user` |
| 2 | In Settings, "Let LulaFind post a case about me" is **off** to start with | `02-settings-off` |
| 3 | They turn it on themselves, on the Settings screen; the store reads `alerts:true` | `03-allow-alerts-on` |
| 3b | They hide their own town with **Show my town and last seen**; the store reads `showLastSeen:false`, and the toast says a lookout still shows the area while it is open | `03b-last-seen-off` |
| 4 | The same choice sits in the Safety centre, where a lookout is started | `04-safety-centre` |
| 5 | The audience for the case the app may post: **Everyone** (also Followers / My spotlight) | `05-audience-everyone` |
| 6 | The lookout form: where they are going, and what their followers should know | `06-lookout-form-filled` |
| 7 | The lookout starts, with the location attached | `07-lookout-started` |
| 8 | A second new person signs up, follows them, and sees their **last seen** — visible to everyone, and naming the area | `08-other-profile-last-seen` |
| 9 | The follow is stored as accepted | `09-followed` |
| 10 | 24 h later the follower is asked on the home screen: **"Is Nandi Mokoena okay?"** — asked once only | `10-home-are-they-okay` |
| 11 | The lookout page shows the same question and who has answered | `11-lookout-page-ask` |
| 12 | One "no" flags them and the app publishes the case itself, at the audience they chose | `12-case-published` |
| 13 | The person the case is about opens their own post and sees **This case is about you** | `13-subject-sees-case` |
| 14 | They tap **I'm here** | `14-im-here` |
| 15 | The case is deleted and the safety centre comes back | `15-post-gone` |
| 16 | With the setting off, the same "no" flags them but publishes **nothing** | `16-no-permission-no-post` |

The 24 hours are simulated by moving the lookout's own timestamps back in the app's
store — the same fields the app reads — because a browser test cannot wait a day.
Everything else is the real code path. The scheduled ask (`lula_lookout_ask_due()`
in `supabase/schema.sql`) is written but has never been executed here: `psql` is
not installed in this container, so the app's own `runDue()` path is what is proven.

## The rules this run pins down

- **Last seen is visible to everyone.** The time always shows; the place follows the
  person's own setting, and an open lookout names the area the person themselves
  chose to share.
- **A lookout is shared with their followers** with the location attached.
- **24 h later the followers are asked, once.** The ask is stamped (`askedAt`) so a
  reload or a second load cannot ask twice, even with no followers.
- **All say yes → the lookout closes. One says no → they are flagged** and the app
  publishes a possible-missing-person case of its own.
- **Escalation is gated on the person's own settings**: "Let LulaFind post a case
  about me" plus the audience they picked (everyone / Spotlight / followers), set on
  the Safety centre **and** in Settings → Privacy & data.
- **"I'm here" deletes it**: the person the case is about opens the post, taps
  "I'm here", the case is deleted and the lookout is closed.

## Bugs this run found (all fixed at the source)

- the home prompt said "Is Someone you follow okay?" — lookout owners were never in
  the author cache;
- an escalated lookout disappeared from the owner's Safety centre, which made
  "I'm here" unreachable exactly when a case was live;
- "Be on the lookout around X" and "Place not shared" copy contradicted the area the
  person had named;
- lookout rows rendered as one run-on line;
- the ask could re-trigger itself into a write storm;
- Mark as found swallowed the app-posted case, so the person it was about never saw
  "This case is about you";
- a deleted post rendered as an empty screen.
