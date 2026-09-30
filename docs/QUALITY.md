# Is it responsive, aligned, quiet, quick to load, quick to answer?

Measured, not asserted. `tools/e2e-quality.mjs` renders **18 screens x 6 widths**
(320 / 360 / 390 / 414 / 768 / 1024 px) with real content — an account created through the real
sign-up screen, a real case and a real story posted first — and reads numbers off the rendered
page. Screenshots and the raw JSON are in `docs/e2e-quality/`.

```bash
bash tools/get-browser.sh
LD_LIBRARY_PATH=/tmp/alibs/lib node tools/e2e-quality.mjs
```

## The five questions, answered with numbers

### 1. Responsive — yes

| Width | Scrolls sideways | Hangs off the edge | Clipped words | Tiny targets | Overlapping controls |
| --- | --- | --- | --- | --- | --- |
| 320 px | no | 0 | 0 | 0 | 0 |
| 360 px | no | 0 | 0 | 0 | 0 |
| 390 px | no | 0 | 0 | 0 | 0 |
| 414 px | no | 0 | 0 | 0 | 0 |
| 768 px | no | 0 | 0 | 0 | 0 |
| 1024 px | no | 0 | 0 | 0 | 0 |

A horizontal rail that scrolls on purpose (the story strip, the filter chips) is not counted;
anything sticking out of a static block is.

### 2. Aligned — yes

The left edges of the main blocks on each screen are measured. One edge is the norm; two are
allowed (the 320 px screenshot of `Me` splits its two menu columns, and the same happens at
tablet width). Nothing exceeds that anywhere.

### 3. Not too much reading — yes

Words above the fold, worst screen at each width:

| Width | Most words on the first screen |
| --- | --- |
| 320 px | 153 |
| 360 px | 156 |
| 390 px | 156 |
| 414 px | 158 |
| 768 px | 216 |
| 1024 px | 217 |

The rule applied is the phone one (≤ 220 words up front on a screen ≤ 414 px); a desktop fits more
by design. It is a floor and a ceiling lower than a typical news page's standfirst.

### 4. Loads instantly — yes, and here is exactly what a phone downloads

Measured on the production build served by `tools/serve-www.mjs` (compressed,
hashed files cached for a year), each run a fresh cache and a fresh context:

| | Measured |
| --- | --- |
| First load (`/` or `/home`) | **FCP 224–288 ms**, TTFB 2–3 ms, 105 requests, **596 kB** (js 587, css 8) |
| The screen's own bundle before it paints | 315 kB transfer (the build's "initial total") |
| The rest of the app | ~280 kB, fetched **after** the first paint (see below) |
| Every tap after that | 11–24 ms (the code is already in memory) |

**Correction.** An earlier version of this page said 456 kB and FCP 128–160 ms.
That was measured with a browser cache that was not actually cold and a 900 ms
window that cut off before the last chunks arrived. The numbers above are from
`tools/measure-load.mjs`, which uses a new context per run and waits for the page
to settle. The app did not change; the measurement did.

**Why ~100 requests?** `core/services/prefetch.service.ts` walks the route table
after start-up and imports every screen's chunk, four at a time, yielding to the
browser in between. That is why tab switches are instant — the code is already
there. It is also ~550 kB of JavaScript the person did not explicitly ask for, so
it is now a choice:

| Data saver | Scripts | JavaScript | Page chunks fetched at boot |
| --- | --- | --- | --- |
| off (default) | 98 | 554 kB | 32 (every screen) |
| **on** | **61** | **387 kB** | **3** (only the ones actually opened) |

The switch is honoured in Settings → Appearance, and the same rule applies
without touching the app when the phone itself asks for less data
(`navigator.connection.saveData`), on 2G, or offline. With it on, a screen costs
one chunk when it is opened: measured 19 ms and 24 kB for Spotlight on this
machine, and one network round-trip on a real one.

### 5. Interacts instantly — yes

| Interaction | Measured |
| --- | --- |
| Bottom-tab route change (Spotlight / Chats / Me) | 11–24 ms to the new screen's first text |
| Tap → visible change (open comments, react, flip a setting) | 23–27 ms |
| Long tasks while scrolling 3 000 px | 0 |
| Cumulative layout shift over that scroll | 0 |

`prefers-reduced-motion` is honoured (the splash and its dots stop animating).

## What the audit found and what was fixed

**Layout**
- the feed action row clipped its longest label at 320 px (`Have …`); every word is now whole from
  320 px up in both the feed card and the post page;
- `Tips` and `Terms & privacy` rendered **without their titles** — the header showed the home
  search bar instead of a back button and a name. Both are now titled inner pages;
- the `Chats` row cut a full sentence off with an ellipsis (328 px of text in 226 px of space) —
  it wraps now;
- `Tips` opened on 226–264 words of emergency numbers and tips at 768 px and up; the reading rule
  now applies to phones, and the screen keeps its own title.

**Two switches that did nothing**
- "Data saver (smaller images)" and "Autoplay media in the feed" were stored and
  shown, and no code read them: not one byte or frame changed. Data saver now
  stops the background download of every screen (measured above) and autoplay now
  decides whether a story advances on its own — renamed to say what they do:
  "Data saver (less background loading)" and "Autoplay stories".

**Tap targets** (WCAG 2.5.8 asks 24 px; a thumb wants 44 px)
- `Share this tip` was a 111 x 13 px button → 40 px tall;
- the follower / following counts on the profile menu were 82 x 15 → 40 px tall;
- the audience picker on New post (a `select` 178 x 15 inside a 21 px label) → 34 px;
- `Browse as guest` on the sign-in screen was 123 x 15 → 40 px;
- every round icon button (back, bell, settings, search) was 36 x 36 → 40 x 40;
- `.lf-btn--sm`, `.lf-chip` and the Safety centre's consent checkboxes (19 x 19) were below the
  floor → 36 px and 24 px;
- `Get help` and other links written inside a sentence got a comfortable padded hit area.

**Contrast** (WCAG AA; 53 text runs failed at every width before, 0 after)
- white text on `--lf-primary` `#2d88ff` measured 3.4–3.9 : 1 in the dark theme — the fill is now
  `--lf-primary-fill` (`#1b6fe0`, white on it passes), while `--lf-primary` stays the link blue;
- red as *text* used the fill red `#e41e3f` (3.1–4.2 : 1); text now uses `--lf-signal-text`
  (`#c8102e` on light, `#ff5c72` on dark);
- dark-theme links measured 4.06 : 1 on cards and on the soft-blue chips — lifted to `#6cb2ff`;
- the "Local data mode" banner was white on `#2d88ff` (3.46 : 1) — it is now a quiet card-coloured
  strip with the app's own text colour. (It only appears with `?data=local`.)

## What this audit does not prove

- **No network throttling.** Everything runs against localhost, so the millisecond numbers are the
  app's own cost, not a 3G download time. The byte counts are the number that matters on mobile
  data: **596 kB on a cold first load, 387 kB with Data saver on**.
- **One web engine.** Chromium 153 only; Safari and the Android WebView (which is what the APK
  uses) are not measured here.
- **No screen reader pass.** Contrast, target size and label text are checked; announcement order
  and focus handling are not.
- **Colour-blindness is not simulated.** Contrast is computed from the real rendered colours.
