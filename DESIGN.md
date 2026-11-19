# Spark design

Mode: operate (a task tool, used daily). Expression lives in type, colour and small details, not in decoration.

## Direction

A calm paper notebook with one hot pen. Warm paper and ink neutrals, a single vermilion accent ("spark"), and six supporting hues that code entry types. Headings are a soft serif, body is a humanist grotesque, metadata is monospace, like marginalia. Dark mode is a warm charcoal, not blue-black. Follows `prefers-color-scheme`; there is no toggle.

## Palette

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | #f5f0e6 | #161412 | page |
| `--surface` | #fbf8f1 | #1f1c19 | dialogs, hover rows, provider forms |
| `--sunken` | #ebe4d4 | #100e0c | sidebar |
| `--input` | #fffdf8 | #121010 | fields |
| `--border` | #d9d0bd | #35302a | hairlines |
| `--border-strong` | #b9ad94 | #544d43 | fields, outlined buttons |
| `--ink` | #1c1915 | #ece6da | text, section rules |
| `--muted` | #655d4f | #a69e8e | secondary text |
| `--accent` | #d93a15 | #ff6a3d | primary button, active marks, focus |
| `--accent-hover` | #c2300e | #ff825c | primary hover |
| `--accent-ink` | #bd2f0d | #ff8a63 | links and text in accent (AA on bg) |
| `--on-accent` | #ffffff | #1a0a04 | text on accent |
| `--wash` | #f9e1d6 | #2d1c14 | focus ring, notices, pressed rows |
| `--error` | #b42318 | #ff8f80 | errors, danger |

Entry types (light / dark), used as small marks only (row bar, nav square), never as text colour:

| Type | Light | Dark |
| --- | --- | --- |
| inbox | accent | accent |
| idea (saffron) | #d4930d | #f0b429 |
| problem (magenta) | #d0307a | #ff6fa5 |
| experiment (emerald) | #0e9a78 | #3ddbaa |
| competitor (ultramarine) | #3a62d6 | #7599ff |
| note (stone) | #8c8577 | #a8a193 |
| technology (lime) | #6f9f1a | #b4dc4a |

No violet. No gradients. No glass blur.

## Type

Self-hosted under `dist/assets/fonts` (latin subset, SIL OFL), because the server CSP only allows same-origin styles and fonts.

- Display: Fraunces (variable, opsz auto), 500. Page titles, section headings, brand wordmark in italic.
- Body: Instrument Sans (variable 400-700), 15px / 1.55.
- Meta: DM Mono 400/500. Breadcrumb, entry-type labels, stage tags, dates, counts, footer.
- Scale: 11 / 13 / 15 / 19 / 26 / 36 px (`--fs-xs` to `--fs-2xl`); 30 and 23 px for the two largest on phones.

## Spacing, radius, motion

- Space: 4 / 8 / 12 / 16 / 24 / 32 / 48 (`--s1` to `--s7`).
- Radius: 4 (tags, forms) / 6 (controls) / 12 (dialog only). Not everything is a rounded card: lists are ruled rows, sections are headed by a 2px ink rule.
- Easing: `cubic-bezier(0.23, 1, 0.32, 1)` ease-out everywhere. Durations 120 / 180 / 240 ms. Only transform, opacity and colour are animated, except the entry-row bar (top/bottom, 180 ms).
- Micro-interactions: buttons press to scale 0.97; entry rows grow their type-coloured bar from a short tick to the full row height on hover; on brand hover the flame of the mark stretches up and the spark chip flicks off 45 degrees (hover-capable devices only); dialog and toast enter with `@starting-style` (8px rise, opacity); link underlines fade in; focus ring is a 3px accent wash.
- Hover effects on buttons are gated by `(hover: hover)`. `prefers-reduced-motion` collapses all transitions.

## Rationale

- The old UI was a green-grey dark panel set with system-ui: no identity. A warm paper base with one saturated vermilion reads as a notebook with a red pen, and the accent doubles as the "spark" brand.
- Type colour lives in a 3px bar and a 7px square, so a list of mixed entries is scannable at a glance without turning the page into a rainbow.
- The active nav item is a tab that merges into the page (same background as `--bg`, accent tick), the notebook-divider metaphor.
- Phone: sidebar becomes wrapping pills, fixed bottom action bar kept as is; verified no horizontal overflow at 390px.

## Logo

Mark: a lit match leaning on a ruled line, with one spark chip flicked off the rule. One colour, hand-written paths on a 24px grid (rule, thin stick, oval head, asymmetric flame with a cut-out inner core, chip), no strokes, no gradients. It reads as "spark" (match, flame, chip) and "notebook" (the ruled line). The flame leans and flicks its tip, and its core is negative space, so it cannot read as a droplet.

Explorations are in `docs/logo/explorations/`; `comparison.png` shows each at 16, 32 and 192 px:

- a, b, c (first round): a symmetric-flame match, a flame between rule stubs and a margin slash. Dropped: the flame read as a droplet or campfire, the slash as a generic icon.
- d, flame match at 45 degrees on a full rule with a chip.
- e, the same on a short underline with no chip. Dropped: weaker footing, loses the notebook rule.
- f, steeper (about 62 degrees) match on a full rule with a chip (chosen): the most confident angle, the longest stick, and the clearest stick-to-head-to-flame progression at 32 px and up.

Files: `dist/assets/spark-mark.svg` (currentColor), `dist/assets/favicon.svg` (paper mark on a vermilion rounded tile), `spark-180/192/512.png` (full-bleed vermilion, paper mark) and `spark-512-maskable.png` (mark scaled to fit the 80% safe zone), `docs/logo/spark-logo.svg` (mark plus "spark" in Fraunces italic 500, outlined to paths, follows the colour scheme). In the app the mark is vermilion; on icons it is paper (#fbf8f1) on vermilion. Manifest `theme_color` and `background_color` are paper (#f5f0e6).

## Hooks added outside CSS

- `dist/assets/app.js` `entryRow()`: `data-type="${r.type}"` on `.entry-row` (drives type colour).
- `dist/index.html`: inline SVG logo mark (see Logo) replaces the PNG in the brand link, preload links for two fonts, light/dark `theme-color`.
- `server.cjs`: `.woff2` MIME type added.

## Font licenses

All three families are SIL Open Font License 1.1, self-hosted in `dist/assets/fonts/` with their license texts:

- Fraunces: `OFL-Fraunces.txt` (Copyright 2018 The Fraunces Project Authors)
- Instrument Sans: `OFL-Instrument-Sans.txt` (Copyright 2022 The Instrument Sans Project Authors)
- DM Mono: `OFL-DM-Mono.txt` (Copyright 2020 The DM Mono Project Authors)

## Feature views

- Business math (`#math-panel`): a tinted ledger with a saffron top rule and dotted leaders between label and value.
- Find related research (`#papers-panel`): paper results reuse `.research-comparison` with an ultramarine left bar; linked competitors use an emerald bar.
- Where I left off (`section.notice`): vermilion-washed card, italic heading, mono caps labels.
- Founder review button: outlined in the accent.
- Brief (`#brief/<id>`): one-pager with mono caps section labels in a left column and a double rule under the title. Print forces the light palette regardless of colour scheme, hides all chrome, and avoids splitting sections across pages.
