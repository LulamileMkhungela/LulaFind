# LulaFind post-card UI audit

**Audit date:** 5 October 2026  
**Reference:** LinkedIn Help and API documentation, plus the explicit LulaFind requirement that feed actions remain icon-only.

## Reference behaviours checked

- LinkedIn's post actions are reaction, comment, repost, and private send. Repost has two paths: repost directly, or repost with thoughts. [LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a525047)
- LinkedIn comments support replies, mentions, media, and Most relevant / Most recent sorting. [LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a524166)
- LinkedIn exposes reactions on both shares and comments, rather than treating a reaction as an anonymous counter. [Reactions API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/reactions-api?view=li-lms-2026-05)
- LinkedIn activity separates posts, comments, mentions, reposts, and reactions. [LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a567278)
- Post analytics are separate from the reader card and are only available to the owner. [LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a525196/view-post-analytics-for-your-content)

## Card anatomy checklist

| Layer | LulaFind implementation | Status |
|---|---|---|
| Activity context | `activity()` renders “X commented/reacted to this” above the card | Verified |
| Repost context | Reposter line plus original embedded post | Verified |
| Author header | Avatar, name, headline, Follow, time, province, audience, and More | Verified |
| Text | Title/facts followed by a three-line measured clamp and honest “see more” | Verified |
| Media | Full-width image/video, multi-media tiles, poster design, and lazy loading | Verified |
| Engagement summary | Real reaction stack/count, comments count, repost count | Verified |
| Action row | Reaction, comment, repost, and send icons; accessible names remain in the DOM but visible labels are visually hidden by the LulaFind requirement | Verified |
| Conversation preview | Most relevant top-level comment with author, body, time, and comment reaction count | Verified |
| Repost flows | Direct repost and repost-with-thoughts remain separate | Verified |
| Comments | Mentions, emoji, photo/video attachments, replies, sorting, follow, like, edit, delete, and author tag | Verified |
| Case interactions | Follow case, “I’m looking near this case”, structured sighting report, lead count, and verification state are separated below the LinkedIn card anatomy | Verified |

## Deliberate differences from LinkedIn

LulaFind should not become a brand clone or copy interactions that would be unsafe for a missing-person network.

- **Icon-only actions:** LinkedIn commonly displays action words on wider screens; LulaFind keeps the requested icon-only presentation and preserves accessible labels/tooltips.
- **Case context:** province, missing-person type, found state, lead verification, and safety actions are necessary domain information.
- **Network scope:** `Network` is limited to the viewer's accepted social graph, joined Spotlights, and related statuses rather than LinkedIn's broad activity distribution.
- **Privacy:** “I'm looking” declares volunteer intent without sharing live location. A structured sighting captures an event, not a continuous location trace.
- **Trust:** sighting verification, moderation, consent, and SAPS/Childline guidance are more important than maximizing repost reach.

## Evidence in the repository

- `src/app/core/components.spec.ts`: card anatomy, action-bar spread, read-more measurement, repost embeds, details layout, and reaction behavior.
- `src/app/core/screen-audit.spec.ts`: renders the named screens and checks copy density.
- `src/app/core/lulafind.spec.ts`: structured sighting persistence and “I'm looking” notification behavior.
- `src/app/shared/components/post-card.component.ts`: feed-card layout and responsive styles.
- `src/app/pages/post/post-detail.component.ts`: full post, comment thread, structured sighting sheet, and case actions.

## Remaining improvements, ranked

1. **Coarse case map:** show town/province or deliberately blurred case areas; never volunteer live positions.
2. **Search-party board:** expose the existing search-zone data as a family/volunteer dashboard with claim and complete actions.
3. **Per-case notification choice:** every update, leads only, found-only, digest, or mute.
4. **Owner analytics:** private reach and response metrics, clearly separated from public engagement counts.
5. **Provenance badges:** show submitted time, source, family check, and admin check independently; never turn a community lead into an official fact.
