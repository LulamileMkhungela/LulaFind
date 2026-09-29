# LulaFind — competitor and market research

Researched 29 September 2026. This is the source document behind the feature
decisions; the code that came out of it is listed at the end.

## 1. The problem, in numbers

| Fact | Figure | Source |
| --- | --- | --- |
| Missing persons cases processed by SAPS in one reporting year | ~4,900–5,000 | SAPS via parliament (2025) |
| Missing persons reported 1995–March 2024 | ~38,322 | National Bureau for Missing Persons |
| Children reported missing per year (average) | ~1,697 — one every five hours | Missing Children SA / SAPS |
| Children reported missing in 2024 | 632 (742 in 2023) | SAPS national spokesperson |
| Children reported missing over ten years | 8,743 | SAPS |
| Still missing without trace since 2023 | 742 — roughly 250 a year, never found | SAPS |
| Reunited over five years (2020–2025) | 17,968, of whom 2,963 were under 18 | SAPS |
| Bodies recovered in the same period | 3,099 (mostly drowning) | SAPS |
| Proportion of children never found / found dead | 23% | Missing Children SA |
| Pink Ladies, Jan–Jun 2025 | 291 cases: 138 found, 143 still missing, 10 dead | The Pink Ladies |

Sources: [SAPS figures via Mike Bolhuis project notes](https://www.mikebolhuis.co.za/post/project-national-bureau-for-missing-persons-database-in-south-africa),
[Daily Maverick, June 2025](https://www.dailymaverick.co.za/article/2025-06-01-sas-missing-kids-and-the-agony-of-parents-who-never-stop-hoping/),
[IOL, Dec 2024](https://iol.co.za/news/crime-and-courts/2024-12-25-south-africa-has-too-many-missing-children/),
[EWN, Feb 2025](https://www.ewn.co.za/2025/02/05/increase-in-missing-childrens-cases-sparks-widespread-concern),
[TimesLIVE, Sept 2026](https://www.timeslive.co.za/news/south-africa/2026-09-17-behind-sas-missing-women-is-a-hunt-for-much-larger-answers/).

**The window that decides the case.** SAPS policy has *no* waiting period — a
report must be taken immediately at any station, and an SAPS 55(A) form must be
completed so the photograph can be circulated. In practice families are still
told to "wait 24 hours", or they avoid the police entirely and post on Facebook
instead. Once a case ages past the first days it goes cold, and communities
then search with no structure, no intelligence and no coordination. That is the
gap LulaFind sits in.

## 2. What the failures actually look like

* Families post to Facebook groups instead of opening a case, so nothing
  reaches the police circulation system (Missing Children SA, Pink Ladies).
* Family groups multiply per case and go unmoderated. Tips, rumours and
  accusations mix together and the family cannot tell a credible sighting from
  noise; misinformation has derailed real investigations
  ([Search Investigations](https://www.searchinvestigations.org/blog/social-media-missing-persons-cases)).
* Scam posts copy real missing-child photos, ask for money, and turn off
  comments ([THV11](https://www.thv11.com/article/news/crime/new-scam-uses-missing-children-posts-to-steal/91-9f6ae665-16c3-4a27-a278-cd916baccd98)).
* Publish-first platforms put a child's face, address and last-known place in
  front of strangers with nobody checking the post first.
* The guidance families need (SAPS 55 form, one spokesperson, a recent photo,
  what they wore) is scattered across NGO pages that are hard to read on a phone.

## 3. Every South African player found

Scraped 29 September 2026 from the Play Store listing, the company site, and the
NGO's own reporting page in each case.

| App / body | What it is | Feature set, as advertised |
| --- | --- | --- |
| **Missing People: Safety Network** (Kyox LLC, `io.kyox.missingpeople`) | SA community search platform; the closest direct competitor (100+ downloads) | Live map of cases near you; search and filter by name, location, category, status; guided reporting for missing people, hijacked vehicles and pets; multiple photos; optional reward; **choose what is public** (name, contact details); optional police case number; sightings with location, date, details, photos; **alerts by area - nationwide, city or custom radius**; high-priority child-case alerts; watchlist; comments; success stories; support hub; **human moderation for child cases**; **guardian consent for children**; reporter confirms they are authorised; report/block; delete account in-app |
| **MySAPS** (SAPS, official) | Official police app | Anonymous crime tip-offs; station finder; People of Interest (missing, unknown, wanted); AMBER alerts; FCS (GBV/child protection) contacts; service complaints; notifications for protests, events, wanted persons |
| **Namola** (Community Wolf; 700k+ downloads) | SA's largest personal-safety app | SOS to GPS location; 24/7 operators; **Safety Score and Safety Overlay** (area risk grid built on their Safety Intelligence API); family tracker with Places and smart alerts; travel history; community/watch feed with verified members; **broadcast alerts from CPFs and community leaders**; paid tiers (R30/R60+) |
| **iFearLESS** (SA) | Panic-button app that also advertises missing-person help | One-tap alert to assigned contacts; live GPS tracking of last-known location; connects to nearby helpers |
| **Missing Peoples App (MPA)** | International, trafficking-aware | Missing persons **and pets**; worldwide reports; 25k+ reports claimed; **critical 72-hour window messaging**; real-time alerts |
| **Pink Ladies** (NGO) | The search organisation families actually call | WhatsApp intake on 072 214 7439; a missing-person form after a SAPS case number exists; flyers circulated on Facebook; volunteers print and place flyers; physical search from their base |
| **Missing Children SA** (NGO) | Police-partner NGO | 072 647 7464 (24/7), intake form, statistics, family support |
| **Bureau for Missing Persons** (SAPS) | The national circulation system | SAPS 55(A) form to circulate a photo; SAPS 92 form to close it; escalation line 021 918 3512 / 3449 / 3452, missing@saps.gov.za |
| Also checked, not a model: **GRIT** (panic + evidence vault), **MySOS**, Life360, Nextdoor, Citizen, Ring Neighbors | | |

## 4. Competitor feature matrix

| Feature | Missing People: Safety Network (SA) | MySAPS (SAPS) | Namola | Nextdoor / Citizen (US) | LulaFind |
| --- | --- | --- | --- | --- | --- |
| Community missing-person feed | Yes | Alerts list only | No | Pet/elderly posts | Yes |
| Last-known-location map | Yes | Station finder | Yes (SOS) | Yes (incidents) | Case page with place and province |
| **Geographically targeted alert to members** | Radius/city | WEA-style, official | No | Yes (hyperlocal) | **Yes — province + member radius, children-only switch** |
| Structured sighting / tip on the case | Yes (photo, location, date) | No | No | Comments | **Yes — lead on the case, place, province, time** |
| Lead checked against CCTV/police/records | Human moderation | Official cases | No | No | **Yes — "checked" badge, source recorded** |
| Child cases reviewed before publication | Yes | Official | No | No | **Yes — review queue; alert fires on approval** |
| Case number on the post | Optional field | Native | No | No | Yes |
| Escalation to partners with consent | No | No | Response centre | No | Yes (consent-gated, nothing auto-sent) |
| Emergency and NGO directory (SA) | Support hub | FCS/GBV contacts | Response centre | No | Yes (`/help`, GBV channel note) |
| Poster generator | No | No | No | No | **Yes — templates, share/print** |
| KhumbulEkhaya (person is alive, does not want to be found) | No | No | No | No | **Yes — unique to LulaFind** |
| Child can never claim their own case | n/a | n/a | n/a | n/a | **Yes** |
| Guardian consent required for a child case | Yes | n/a | n/a | n/a | **Yes - checked in the composer and recorded on the case** |
| First-hours checklist tracked on the case (SAPS 55(A), case number, officer, spokesperson, poster, NGOs) | No | No | No | No | **Yes** |
| Case-closure reminder (SAPS 92, tell the officer) | No | No | No | No | **Yes** |
| "Station says wait 24 hours" escalation path (Bureau for Missing Persons) | No | No | No | No | **Yes - on every case and in the FAQ** |
| Investigating officer kept private to the family | No | n/a | n/a | n/a | **Yes - never in the poster or share text** |
| Reunions page with the finder credited and time-to-find | Success stories (no credit) | No | No | No | **Yes, with contributor credit** |

Adjacent apps checked and rejected as models: Namola (alarm/response, not
search), MySOS (panic button), Life360 (family location), Citizen (scanner feed,
premium tier), Amber Alert GPS apps (one-way notifications). None of them let a
family run a case with the community.

## 5. Principles taken from the research

1. **The alert is the product.** Everything else exists to make one message
   worth reading. Geo-target the message, keep it short, never let it become
   background noise. (AMBER/NamUs practice: alerts are *always* geographically
   targeted, never nationwide.)
2. **A child case is checked before it is broadcast.** False alerts train people
   to ignore real ones; every serious system reviews child cases first.
3. **Separate a sighting from a rumour.** A lead needs a place, a time, what the
   person wore, and - where possible - a check against something official.
   Record the source of every check.
4. **Do not publish what can harm.** No home address, no secret detail, no
   naming suspects. Warn when a post drifts that way.
5. **Scams target grief.** Money requests and payment-for-information are
   reported loudly, and the app never asks for money.
6. **Answer the practical question in the first hours.** SAPS 55 form, case
   number, one spokesperson, a clear recent photo - on a phone, not in a PDF.

## 6. What shipped

| # | Feature | Where it lives |
| --- | --- | --- |
| 1 | **Case alerts** to members in the province the case happened in, honouring each member's alert preferences (switch, children-only, province). Author and suspended accounts are never alerted. | `alertCase()` in `core/services/data.service.ts`, sent from `createPost()` |
| 2 | **Alert preferences on the profile**, not just on the phone, so a case posted from any device reaches the right area. | `AlertPrefs` in `core/models/types.ts`, `saveAlertPrefs()`, Settings → Alerts |
| 3 | **Distance on every case alert** — "12 km from you" or "outside your alert radius", from the member's own last location fix (nothing uploaded). | `distanceKm()` in `core/utils/format.ts`, `devicePoint()`, notifications page |
| 4 | **Child-case review queue.** A case about a person under 18 is held, an admin reads it, and only publishing it sends the area alert. Rejecting it alerts nobody. | `pendingCases` / `approveCase()` / `rejectCase()` in `core/services/moderation.service.ts`, Review tab in the admin screen |
| 5 | **Leads surfaced on the case.** The case page counts leads, shows the newest one and how many are checked, and scrolls to them. | `pages/post/post-detail.component.ts` |
| 6 | **"Checked" badge with the source**, set only by an admin against CCTV, police, records or a photo. | `sightingVerified` on the post, `verifySighting()` in the moderation service |
| 7 | **First-hours checklist** on every case post: the SAPS 55(A) form, case number, investigating officer (private), recent photo, one spokesperson, poster placement and telling the NGOs - ticked by the family, counted on the case. | `CASE_STEPS` in `core/models/types.ts`, `tickStep()` / `saveOfficer()` in the data service, checklist card on the case page |
| 8 | **Guardian consent for a child case**: required in the composer, refused by the service without it, and recorded as a consent entry on the post. | `guardianConsent` on `CreatePostInput`, `isChildSubject()` guard |
| 9 | **Case closure the official way**: closing a case reminds the family to complete a SAPS 92 so the person leaves the police circulation list. | Case page closure note, `markFound` toast |
| 10 | **Escalation when a station refuses**: "there is no waiting period" plus the Bureau for Missing Persons number, on every open case and in the help directory. | `NO_WAIT_NOTE` in `core/data/sa-help.ts`, case page callout |
| 11 | **Reunions page** (`/found`): closed cases, how long it took, and the member who was named as finding them, with their contributor badge. | `pages/found/found.component.ts` |
| 12 | **FAQ page** carries the long answers (SAPS 55 form, the 24-hour myth, what never to post, how to tell a real case from a scam, who gets an alert). | `/faqs`, `core/data/faqs.ts` |

## 7. Mined but not built yet (in priority order)

0. **Live map of cases near you.** The direct competitor has one and it is the
   first thing its listing advertises. LulaFind deliberately has no map yet:
   a map of where children were last seen is a targeting tool for the wrong
   people. The honest gain is a distance-sorted "near me" list, which gives the
   same answer without publishing coordinates.
1. **Search-party zones.** Named areas, who took which one, what came of it,
   and a first-48-hours board. No South African search app offers this and it is
   the single thing a family does manually on WhatsApp today.
2. **First-72-hours checklist as a tracked task**, not a wall of text: open a
   case, get the number, one spokesperson, recent photo, clothes, poster in the
   right places. Show progress on the case.
3. **Post-quality guard before publishing**: warn when a post contains a street
   address, a hidden detail, or a named suspect.
4. **Anti-scam reporting shortcut** on case posts ("this looks like a scam"),
   feeding the existing report queue with its own reason and a fast path.
5. **Cross-border / trafficking leads**: a case flag for "believed taken across
   a border" that widens the alert to national partner networks, mirroring
   INTERPOL-style cooperation.
6. **NGO and SAPS case-number verification** for high-reach cases, so an
   official post can carry a verified mark rather than only a sighting badge.
