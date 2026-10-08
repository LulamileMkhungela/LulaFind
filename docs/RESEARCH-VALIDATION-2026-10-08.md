# LulaFind: evidence-led product and implementation review

**Date:** 8 October 2026  
**Baseline:** `a6529498c0c6fe859cea5a665523a0b48932a41f`  
**Scope:** research and local validation only. No application, database, or deployment changes.

## Executive answer

**LulaFind already implements many relevant competitor patterns. It is not yet defensible to say they all work well end-to-end, or that it outperforms those competitors.** The immediate opportunity is to make existing safety promises true at the database, notification, and privacy boundaries—not to add every feature from every app.

Keep the family-owned case workflow, structured sightings, practical South African guidance, printable posters, consent-aware contact, and community coordination. Prioritise server-enforced publication review, private case data, reliable preference-aware alerts, and safe closure before maps, additional AI, or more social features.

This is a targeted technical/product review, not an exhaustive penetration test, legal opinion, systematic literature review, or live competitor usability study.

## 1. Method and limits

Reviewed repository research and verification documents, application configuration, data adapters, case creation and alert services, search coordination, reunion rendering, escalation, SQL access policies/RPCs, and push implementation. Cross-checked selected claims against current public listings, official guidance, and research commentary.

Evidence labels used below:

- **Implemented:** identifiable application code; not a claim of successful production deployment.
- **Locally tested:** commands executed against this checkout.
- **Static finding:** follows from inspected source; deployment may differ and requires staging reproduction.
- **Advertised:** vendor documentation/listing, not independently measured effectiveness.
- **Proposed:** recommendation, not shipped work.

### Requested research/design services

Connector availability was checked individually for Elicit, Consensus, NotebookLM, Copilot, Figma, Visily, Uizard, Claude, and v0. All returned **unsupported**. No account sessions, generated designs, multi-model validations, or research outputs from those tools were used or invented. Public web search and page extraction were available instead. No personal case records were uploaded to external AI services.

### What was actually run

| Check | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | Passed; lockfile dependencies installed without changing the lockfile |
| `npm test` | **303 tests passed across 8 files** |
| `npm run lint` | Passed |
| `npm run build` | Passed; two component stylesheet-budget warnings |

Build warnings: create-post stylesheet 12.50 kB against 12 kB; post-detail stylesheet 17.81 kB against 12 kB. Initial build estimate: 1.35 MB raw / 337.77 kB transfer, not a measured real-device network load.

The suite logs expected simulated failure paths and jsdom canvas limitations. Passing tests are not proof of production RLS, native push delivery, poster pixel correctness, or real-device usability. `lulafind.spec.ts` uses MockApi; `docs/E2E-BROWSER.md` explicitly records demo mode. Existing screenshots are historical evidence, not newly executed browser tests. Test-generated changes to two existing documentation files were restored after the run.

**Not performed:** deployed database inspection, real-user data access, live notification/email sends, native device tests, load tests, current browser E2E, competitor app installation, interviews, or production migrations.

## 2. Competitor patterns worth adopting—and their limits

These are feature comparisons, not an unsupported ranking of which company is “best.” Failure risks are design analysis unless a specific observed incident is cited.

| Product | Publicly evidenced pattern | LulaFind decision |
|---|---|---|
| Missing People: Safety Network | Guided reports, case map, structured sightings, watchlist, area/radius alerts, public-field controls, child moderation and guardian consent. Independent community platform, not emergency response. [10](https://play.google.com/store/apps/details?id=io.kyox.missingpeople) | Closest functional benchmark. Keep structured cases; strengthen server-side consent/review and privacy. A listing does not prove delivery, moderation quality, or safety outcomes. |
| MySAPS | Anonymous tip-offs, station/facility finder, missing-person information and FCS contacts. [6](https://apps.apple.com/za/app/my-saps/id1478487910) | Add clearly labelled official-channel handoff, without claiming a LulaFind post creates a police report or an official acknowledgement. |
| Namola | SOS/operator model, family location, places/geofences, and community safety are advertised. Its help page explicitly limits missing-person tracking to assistance requests or consented sharing. [2](https://www.namola.com/) [1](https://support.namola.com/missing-person) | Borrow transparent consent and service-coverage explanations. Do not imply LulaFind has responders, continuous tracking, or an operator centre. Vendor performance claims were not independently validated. |
| Life360 | Per-Circle location pause, with documented exceptions such as check-in and SOS. [1](https://support.life360.com/hc/en-us/articles/23053695148823-Share-My-Location) | Make consent precise: who sees which location, for how long, and what actions share it. Proposed expiry/revocation must be enforced server-side, not merely hidden by UI. |
| Citizen | Location-based alerts, incident updates, missing-person alerts and configurable zones/radius; listed coverage is market-dependent. [1](https://play.google.com/store/apps/details?id=sp0n.citizen&hl=en_US) | Borrow relevant alerts and correction history. Do not copy live incident spectacle, encourage confrontation, or imply US coverage translates to South Africa. |
| Nextdoor | Community reporting/moderation; policy distinguishes emergencies from using the app and routes specified misinformation to staff. [1](https://help.nextdoor.com/s/article/Do-not-engage-in-harmful-activity?language=en_US) | Separate support/comments from evidence. Give dangerous false claims a staffed escalation path and visible correction history. |
| Ring Search Party | Reporting describes AI-assisted lost-dog searches and camera-owner decisions to share possible matches, alongside opt-out/privacy controversy. This is secondary reporting, not a direct product test. [2](https://www.dispatch.com/story/news/local/2026/02/13/ring-dog-finding-search-party-feature-privacy-concerns-and-how-to-opt-out/88630818007/) | Borrow bounded community participation, not public human tracking or face matching. LulaFind can improve coordination through authorised zone tasks without surveillance. |

### Research implications beyond feature lists

SAPS confirms **no waiting period**, immediate reporting, a recent photo and identifying details, SAPS 55(A), investigating-officer contact, and SAPS 92 on return. This validates LulaFind's checklist direction, not an integration with SAPS. [1](https://www.saps.gov.za/services/report_missing_person.php)

Missing Persons Research Hub commentary identifies misleading sightings, harassment, lasting digital footprints, and the difficulty of linking social engagement to successful recovery. It is research-informed commentary—not a controlled trial proving an app works. Recommendation: measure useful leads and safe resolution rather than shares, and minimise identifiable closure content. [1](https://www.missingpersonsresearchhub.com/post/the-right-to-be-forgotten-and-missing-persons-on-social-media)

A peer-reviewed scoping review of online family/child research discusses parental consent, age verification, vulnerability, and privacy. Its domain is research recruitment/tracing, not missing-person app effectiveness; it supplies ethical context only. [3](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0204572)

There is a concrete warning against AI-first alert publication: local reporting describes false alerts involving old information and subsequent verification changes. This is evidence of reported incidents, not a population-wide error rate. Recommendation: source timestamps, stale-source checks, human review for high-risk alerts, and correction propagation. [3](https://www.timescall.com/2026/02/28/ai-misinformation-emergency-alerts-crimeradar-nextdoor/)

## 3. What is already in LulaFind

Paths below are relative to `lulafind/` unless prefixed otherwise.

| Capability | Repository evidence | Assessment |
|---|---|---|
| Case reporting, photos, categories and audience | `src/app/core/services/data.service.ts:createPost`; `pages/post/create-post.component.ts` | Implemented; server-side publication constraints need strengthening |
| Child guardian consent and review | `createPost`, `moderation.service.ts`, admin page | Implemented in application; database enforcement gap below |
| Case search | `core/data/supabase-api.ts:searchPosts`; search page | Implemented; scale/pagination and deployed authorisation not validated |
| Structured sightings | `pages/post/post-detail.component.ts` sighting form | Implemented: place, province, time and notes; separate private lead lifecycle recommended |
| Checklist and officer details | `data.service.ts:tickStep/saveOfficer` | Implemented; officer-field privacy is a blocker |
| Posters | `pages/post/poster.component.ts`; `core/utils/poster.ts` | Implemented; native export and pixel-level output not retested |
| Search parties and volunteer intent | `data.service.ts:openSearchParty/claimSearchZone/markLooking` | Already implemented, not a missing feature; authorisation and concurrency incomplete |
| Alerts and preferences | `data.service.ts:alertCase`; settings; push service/edge function | Implemented pieces; preference/recipient selection mismatch and delivery validation gaps |
| Found and still-searching workflow | post detail, `pages/found/found.component.ts` | Implemented; public closure copy contradicts rendered data |
| Support/escalation | `escalation.service.ts` | Contact links and self-reported notes, explicitly **nothing automatically sent** |
| Consent-aware safety/location/lookout | location/lookout/safety services | Implemented; subject-control journeys need deployed, adversarial validation |
| Social features | chats, Spotlights, stories, follow relationships | Existing breadth; do not expand at the expense of case reliability |

## 4. Release-blocking and high-priority findings

**All security findings below are static source findings, not evidence of exploitation or confirmation of deployed configuration.** Reproduce against an isolated staging database with synthetic cases before changing or deploying anything.

### P0 — “Private” officer details are inside the readable post

Evidence: `data.service.ts:2340` saves `plan.officerName` and `plan.officerContact` into the post. `supabase-api.ts:getOne/post` selects the complete `payload`. `supabase/schema.sql:465` permits reads of visible post rows, not a redacted field projection. Media signing does not remove these fields.

**Consequence:** a viewer allowed to read the post can receive the plan fields under the inspected schema even if the page hides them. “Family only” is not established by hiding a control.

**Required design:** separate private case records, with explicit owner/delegate/moderator permissions. Review contact values, exact coordinates, and sensitive lead attachments under the same rule.

**Acceptance:** unrelated and anonymous clients cannot obtain private fields through direct API, feed, search, realtime, export, cache, or storage URLs. Test positive access for authorised roles too.

### P0 — Child moderation is not a database-enforced state machine

Evidence: `data.service.ts:832` checks guardian permission; around line 865 assigns `under_review` for under-18 missing posts. SQL post insert/update rules at `schema.sql:503–622` check ownership/audience but do not require child consent or forbid author publication of a held case. `lula_touch_record` only supplies ownership/timestamps. The generic patch RPC permits author changes without a publication-field allowlist.

**Consequence:** bypassing the composer can bypass the intended review rule under these definitions. Passing MockApi review tests does not test this boundary.

**Required design:** server validation for child-subject categories, explicit unknown-age policy, recorded authorisation, moderator-only publication transitions, immutable approval events, and re-review rules for sensitive edits. Do not delay the person's access to emergency guidance while a community post is reviewed.

**Acceptance:** raw client writes cannot publish or self-approve a child case; unapproved media/alerts remain inaccessible; approval emits one authorised event.

### P0 — Generic search-party patch permits unauthorised changes

Evidence: `supabase/lula-patch-post.sql:22–58` is SECURITY DEFINER, grants execution to anon and authenticated, and allows a patch containing only `searchParty`/`updatedAt` without requiring identity or case visibility. `schema.sql:1298` contains the same broad key-only permission branch.

**Consequence:** the permission condition is not a volunteer-membership check; a caller can replace the search-party value for a known case under the standalone script's grants.

**Required design:** authenticated, visibility-aware, operation-specific commands: open party, claim/release own zone, complete assigned zone. Keep owner/moderator actions separate. Remove broad field replacement.

**Acceptance:** anonymous, unrelated, blocked and suspended callers are denied; volunteers cannot change another person's assignment, meeting point, or closed case.

### P1 — Alert settings do not match the recipient data path

Evidence: `data.service.ts:2268` reads `api.users()` and uses `alertPrefs`/`suspended`/province. `supabase-api.ts:379` obtains users from `lula_user_profiles_public`; `schema.sql:306–380` omits alertPrefs, forces suspended to false, and hides province when location is private. `alertCase` does not test case audience before fan-out, and does not enforce radius. The notification screen's radius calculation is a distance annotation, not delivery filtering.

**Consequence:** with this adapter/view, opt-out and children-only preferences cannot be reliably applied by this client loop; hidden province can broaden targeting. Notification text can also disclose a restricted case's subject/place to inappropriate recipients. Deployed impact needs reproduction.

**Required design:** trusted server fan-out that reads private preferences and enforces case visibility; do not expose private preferences publicly to repair it. Use chosen areas/coarse subscription cells where practical, not continuous tracking. Define no-location behaviour explicitly.

**Acceptance:** multi-account tests for opt-out, radius boundaries, province, child-only, restricted audience, blocked/suspended users, author exclusion, repeat delivery and closed cases. Notifications must never have broader visibility than the case.

### P1 — Search-zone claims can overwrite each other

Evidence: `data.service.ts:2679` re-reads a party then rewrites its entire zones array. Two concurrent clients may read the same version. A field-level post merge does not make nested-array updates conflict-safe. A claimant can also replace an existing taker in this method.

**Required design:** transactionally claim one zone with a current-owner/version precondition; show conflict feedback rather than silently taking it.

**Acceptance:** simultaneous claims on one zone yield one winner; simultaneous claims on distinct zones both survive; nobody releases another volunteer's claim without coordinator authority.

### P1 — Found page promises anonymity while rendering identifying content

Evidence: `pages/found/found.component.ts:34–63` says names are kept off the page, then renders `p.title` and `outcome.whereaboutsFound`. Titles may contain names; the existing `docs/VERIFICATION.md` even shows such a title. A closure page is not proof that a share caused a recovery.

**Required design:** separate opt-in public outcome summaries, remove sensitive titles/whereabouts by default, consent separately for finder attribution, revoke public media as appropriate, and retain a minimal non-identifying closed-status landing page.

**Acceptance:** closure removes identifying public fields across feed/search/poster/share endpoints and permitted caches. Explain that already downloaded screenshots or third-party copies cannot be recalled.

### P1 — Lead verification needs per-lead provenance

Evidence: post detail around lines 430–435 consults the post-wide `sightingVerified` while rendering individual sighting comments. This risks making one checked source look like verification of several distinct leads.

**Required design:** verification tied to a lead ID, reviewer, evidence reference, timestamp and limited meaning. “Community reported,” “family reviewed,” and “official source confirmed” must be distinct.

**Acceptance:** checking lead A never marks lead B checked; corrections retain attribution and a history.

## 5. Proposed end-to-end advancement plan

These are implementation specifications, **not features added in this pass**.

### Stage A — Establish the safety foundation

1. Versioned database migrations with a single authoritative schema path and rollback plan; reconcile standalone SQL variants.
2. Split public case, private case details, lead evidence and publication events.
3. Replace generic sensitive updates with narrow authorised commands.
4. Build a staging role matrix: anonymous, author, subject, guardian, follower, volunteer, blocked member, suspended member and moderator.
5. Audit all read surfaces and storage policy paths, not only visible screens.

**Exit gate:** P0 findings reproduced and addressed; negative direct-API tests pass against actual PostgreSQL/RLS. No production personal data required.

### Stage B — Make alerts dependable and controllable

- Transactional event/outbox when a case is approved or materially updated.
- Worker checks case status, visibility and current preferences; idempotency by event/recipient/channel.
- Retry with bounded backoff, token cleanup, failure queue and operational monitoring.
- Per-case choices: important updates, leads, closure only, digest, mute. Global province/area preferences remain defaults.
- Distinguish queued, provider accepted, failed, and in-app read. Do not label a push “seen” without evidence.
- Minimise lock-screen details and stop stale broadcasts after closure/revocation.

**Exit gate:** retries after interruption produce no duplicate notification rows; failures are visible operationally; Android/iOS background, foreground and cold-start deep links tested on real devices.

### Stage C — Advance case coordination rather than add another feed

- Private structured lead inbox with occurrence time versus submission time, timezone, factual notes, optional evidence, review state and safe handoff.
- Transactional zone board with named areas, assigned volunteers, expiry/completion and coordinator audit trail.
- Coarse “near me” list first; optional generalised map only after a threat review. Never show precise child/survivor whereabouts or volunteers' live locations publicly.
- Offline drafts clearly labelled **not submitted** until acknowledged; idempotent retry and visible pending state.
- Updateable poster links with generation date/status, printable accessible layout and explicit public preview.

**Exit gate:** two-device tests, poor-network recovery, zone conflict handling, and redaction checks. Existing case/poster flows remain usable without a map.

### Stage D — Safe closure and measurable quality

- Subject-controlled, reviewed “I am safe” handling without forced disclosure of an adult's location to family.
- Closure retracts unnecessary public exposure, ends alert/volunteer work and offers official-channel reminders.
- Takedown/export/retention controls with documented limits and local legal review, including POPIA implications. No compliance certification is implied by this review.
- Moderation triage, scam reporting, correction notices and appeals with staffing/response targets.

**Exit gate:** authorised closure/reopen journeys, deletion and media revocation tests, and no public sensitive closure details by default.

## 6. What “doing well” must mean

Agree product targets before release; the following are proposed measures, not achieved numbers:

- **Security/privacy:** zero unauthorised reads/writes in the defined role matrix; restricted data absent from unauthorised response bodies.
- **Reliability:** submitted work survives reconnect/restart; no duplicated commands or lost concurrent zone claims.
- **Moderation:** queue age, urgent-case review time, appeal outcomes and false-publication/correction rate.
- **Alerts:** eligible-recipient coverage, preference violations, duplicates, delivery failures and notification opt-outs—not raw send count.
- **Usability:** task completion and errors for reporting, sighting, moderation and closure; keyboard/screen-reader use; low-end Android and constrained-network testing.
- **Outcomes:** leads reviewed/actionable, family-reported usefulness, closure provenance and takedown turnaround. Do not equate engagement or a found flag with recovery caused by LulaFind.

Validate workflows with consenting participants and synthetic scenarios first: families, missing-person support workers, moderators and volunteers. Research sample sizes and evaluation success criteria should be agreed rather than invented here.

## 7. Corrections needed in earlier documents

Do not silently treat these as current evidence:

- `docs/RESEARCH-COMPETITORS.md` says radius targeting is implemented; inspected delivery logic does not enforce it.
- The same file lists search zones/checklists as future work while the current code already contains them.
- Claims such as “unique to LulaFind,” “no South African app offers this,” or “always geographically targeted, never nationwide” are not established by the reviewed evidence. The direct competitor explicitly advertises nationwide choice. [10](https://play.google.com/store/apps/details?id=io.kyox.missingpeople)
- Earlier broad “No” competitor cells should mean “not established by the source,” unless absence was actually verified.
- `README.md` calls the core API mock-only while app configuration and both environment files select Supabase with additional development modes.
- `docs/QUALITY.md` local timing figures cannot establish real-network instant loading.
- Historical test counts and setup instructions conflict across documents; this run's 303 tests do not validate all historical operational claims.
- The prior prevalence/statistics table was not revalidated against original datasets in this pass and should not be reused as independently confirmed evidence.

## Final recommendation

**Do not add every competitor feature. First make LulaFind's existing safety, privacy and delivery promises demonstrably true.** Then advance it through private evidence handling, dependable opt-in alerts, conflict-safe volunteer coordination, low-data accessibility and safe closure.

No application patch or production action was taken. This report is the only intended repository change.
