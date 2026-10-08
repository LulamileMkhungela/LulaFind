# Implementation and verification status — 8 October 2026

## Overall status: in progress, not production-certified

The user clarified that “don't patch” means durable complete implementations, not a prohibition on code changes. This implementation follows the earlier research review. It does **not** claim that every app feature works in production, that all competitor features are implemented, or that LulaFind outperforms competitors.

## Seeing it: the hosted preview

The development server runs on **port 4200** and is shown to the user as a live preview
panel (labelled *LulaFind app (live preview)*) beside the workspace file tree. It is a
running process, not a file, so it does not appear in the file list.

Because a reviewer has no account, a development build on a preview host starts on the
sample dataset (banner visible) and the welcome screen offers **Explore the sample data** —
one tap signs in the seeded demo account and lands on `/home`. The rule is
`shouldDefaultToDemo(host, production)`:

| Situation | Sample data |
|---|---|
| Production build, any host | never |
| `*.e2b.app` preview host | on |
| Development build opened from another machine (phone, LAN, other proxy) | on |
| Development build on `localhost` / `127.0.0.1` / `[::1]` | off |
| `?demo=0` in the URL | off for that tab, and remembered (an explicit `?demo=1` wins until `?demo=0`) |

Four unit tests cover that table. Verified in Chromium through an HTTPS `*.e2b.app` host
with no query string, embedded in an iframe like the preview panel: the button appears, one
tap reaches `/home`, a case page opens the search board, the session survives reopening the
panel, and there are no page errors.

## Completed implementation: interactive search coordination

A case now exposes a collapsible **Community search board**. This turns the previously service-only search-party concept into an interactive workflow:

- Owner/moderator creates 1–20 distinct public search areas and a public meeting point, with optional meeting time.
- Volunteers explicitly claim, release, complete and reopen their own areas.
- Completion notes, server timestamps, coverage counts, progress indicator and All / Available / My areas / Completed filters.
- Coordinator pause/resume; paused or closed cases cannot accept volunteer mutations.
- Refresh reads authoritative server state; saved success is shown only after the command succeeds. A conflict retains the user's note and requests refresh.
- No volunteer live GPS tracking; public-content and physical-safety reminders.
- Keyboard-operable native controls, accessible statuses and errors, 320/390px browser checks.

### Database implementation, not merely UI guards

`lulafind/supabase/search-coordination.sql` provides a narrow JWT-authenticated PostgreSQL command. It locks the case row and changes one versioned zone rather than overwriting a stale zones array. Blocked/suspended users, anonymous callers, invisible cases and unauthorised operations are rejected.

The generic `lula_patch_post` RPC is now owner/moderator-only and refuses search-board replacement. A table trigger validates volunteer transitions even when the older whole-post interaction RPC is used. The compatibility SQL installer no longer restores anonymous search-party mutation.

The production adapter does not fall back to a full-row write or local success when the new command is missing. It reports that server coordination is not enabled and that nothing was saved.

The configured **Supabase** backend and **development MockApi** support the new workflow. The optional legacy **Firestore-only data adapter** explicitly refuses coordination until an equivalent server-authorised command is implemented. Firebase Authentication used with Supabase is unaffected. Do not describe this as support for every data adapter.

### Related fixes

Real PostgreSQL execution exposed ambiguous JSONB subtraction expressions in the pre-existing post-interaction function. Both schema and standalone installer now parenthesise the extracted JSONB values correctly.

`sync-search-schema.mjs` keeps the standalone module, schema installation and compatibility installer aligned. Tests check for drift without rewriting source.

## Evidence from this session

| Validation | Latest result | What it establishes |
|---|---|---|
| `npm test` | **322 passed / 9 files** | Application/service/component tests; includes 19 new search-coordination tests |
| `npm run test:db` | **28 passed** | Real PostgreSQL semantics through PGlite, repository schema, RLS and RPCs; Supabase-owned auth/storage objects supplied by fixtures |
| `npm run lint` | Passed | TypeScript lint |
| `npm run build` | Passed | Production compile; two pre-existing style-budget warnings remain |
| `tools/e2e-search-board.mjs` | **7 passed**, no page errors | Real Chromium, synthetic demo cases: create, reload, volunteer claim, complete, reopen/release, pause, responsive board |
| `tools/e2e-journeys.mjs` | **40 passed**, no problems or console errors | Real Chromium, local data mode: account creation, post publication/edit, comments, reports, following, stories, search, poster and navigation; some checks are screen rendering rather than full feature journeys |
| `tools/e2e-lookout.mjs` | **17 steps**, no problems or console errors | Local data mode; consent-on/off and “I'm here” removal; 24-hour passage simulated |
| `tools/e2e-drive.mjs` | **FAIL: 3 related findings**, 29 steps, no console errors | First-hours checklist is not exposed on case page; its open/tick/count assertions remain failing |

PGlite is single-session. The stale-snapshot tests establish conflict semantics and preservation of independent claims, **not measured multi-connection contention or throughput**. Real-device push, deployed JWT verification/RLS, email delivery, storage behaviour and native packaging were not validated this session.

Local build warnings remain: create-post stylesheet 12.50 kB and post-detail stylesheet 17.81 kB, against a 12 kB warning budget.

### Why some browser scripts changed

Inspection confirmed that old scripts targeted controls no longer present:

- Welcome screen now says “Log In with email”; the submit button still says “Log in.”
- New posts use a structured text template; separate heading/location controls are for editing.
- Successful publication now returns to `/home`, so the test verifies the persisted case and feed navigation rather than assuming a detail-page redirect.
- Ask Lula was already retired; the test now checks its home redirect.
- Action buttons intentionally have screen-reader-only labels. Clipping measurement now excludes those hidden labels and separately requires accessible names for all four actions.

Assertions were strengthened: a known published case must be found by search, and the sign-in journey requires both wrong-password refusal and successful correct-password login. The missing case-checklist assertions were **not** removed or converted into passes.

Browser evidence can be written outside tracked docs with `LF_EVIDENCE_ROOT`. Session logs/screenshots are under `/home/user/lulafind-regression-evidence` and `/home/user/lulafind-search-evidence`; generated output is not committed. Historical checked-in evidence was not replaced.

## Deployment procedure — not executed

1. Back up/export the current staging schema and data. Record deployed SQL versions; this checkout does not establish what production has installed.
2. On an existing compatible staging database, run `supabase/post-interactions.sql`, then `supabase/search-coordination.sql`. The latter is transactional and repeatable. Fresh installations use `supabase/schema.sql`, which includes the module.
3. Test with real staging identities: owner, moderator, two unrelated volunteers, blocked user, suspended user and anonymous browser. Verify followers-only denial, stale claims and distinct-zone simultaneous claims from separate connections/devices.
4. Deploy the frontend only with the matching SQL. Older frontends' generic search-party field updates are deliberately denied; coordinate the rollout. Do not grant anonymous mutation to regain compatibility.
5. A rollback must disable the search-board UI or retain the safe command/permissions. **Do not reinstall the old permissive patch function.** No existing case/zone data is deleted by the module.

## Reproducible commands

From `lulafind/`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm test
npm run test:db
npm run build
npm start
```

With the dev server up, from the repository root:

```sh
bash tools/get-browser.sh
LD_LIBRARY_PATH=/tmp/alibs/lib node tools/e2e-search-board.mjs
LD_LIBRARY_PATH=/tmp/alibs/lib LF_EVIDENCE_ROOT=/home/user/lulafind-regression-evidence node tools/e2e-journeys.mjs
LD_LIBRARY_PATH=/tmp/alibs/lib LF_EVIDENCE_ROOT=/home/user/lulafind-regression-evidence node tools/e2e-lookout.mjs
LD_LIBRARY_PATH=/tmp/alibs/lib LF_EVIDENCE_ROOT=/home/user/lulafind-regression-evidence node tools/e2e-drive.mjs
```

`.github/workflows/quality.yml` adds these application, database and browser checks to CI, including the currently failing full checklist contract. **CI will not be fully green until that gap is resolved.** The workflow was added locally, not run on GitHub.

## Remaining release blockers and next complete workflows

1. Restore an accessible first-hours checklist with atomic private task persistence. Its methods/models exist, but the browser verifies that the current case page does not expose it.
2. Separate private case/lead data from readable post payloads. Officer details and other sensitive fields require database-level protection, not only hidden controls.
3. Enforce child-case consent/review and publication transitions at the database boundary.
4. Replace client alert fan-out with an authorised durable server workflow that honours private preferences and case audiences; test retry, deduplication and real-device delivery.
5. Per-lead rather than case-wide verification; privacy-safe found summaries and closure/takedown propagation.
6. Finish competitor-informed enhancements only after those foundations: coarse case discovery, per-case notification modes, private evidence review and lower-data workflows, with evaluated user journeys.

The research report remains a historical baseline. Search coordination findings are now addressed in source and local tests as described here; other findings have not been silently marked resolved.
