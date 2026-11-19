# Spark design

Mode: operate (a task tool, used daily). Expression lives in type, colour and small details, not in decoration.

## Direction

A friendly paper notebook with one hot pen. Warm cream paper and soft brown-black ink, a single vermilion accent ("spark") used sparingly, and six supporting hues that code entry types. Headings are a soft serif, body and labels are a humanist grotesque at a generous size. Monospace is kept for numbers, counts and code only; labels are plain sentence case, never tiny capitals. Dark mode is a warm charcoal, not blue-black. Follows `prefers-color-scheme`; there is no toggle.

## Palette

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | #f8f2e8 | #1b1815 | page |
| `--surface` | #fffaf1 | #26221e | cards, dialogs, hover rows, provider forms |
| `--sunken` | #f0e7d7 | #14110f | sidebar, inset panels, next-step box |
| `--input` | #fffdf8 | #121010 | fields |
| `--border` | #e8decc | #3a342d | hairlines, card edges |
| `--border-strong` | #d2c4a9 | #5a5247 | fields, outlined buttons |
| `--ink` | #2e2923 | #efe8dc | text |
| `--muted` | #6a6152 | #b3a998 | secondary text |
| `--accent` | #d93a15 | #ff6a3d | primary button, active marks, focus |
| `--accent-hover` | #c2300e | #ff825c | primary hover |
| `--accent-ink` | #bd2f0d | #ff8a63 | links and text in accent (AA on bg) |
| `--on-accent` | #ffffff | #1a0a04 | text on accent |
| `--wash` | #fce8dc | #35221a | focus ring, selected bar row, pressed rows |
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

Simulated material (anything a model wrote on its own): a dashed `--t-competitor` outline on `--sunken`, mono 11px, labelled "Simulated" (`.by-simulation`). It is used on To review rows, the editor mark, the Validation card title and the brief's "Guesses to test". It never appears on owner-written entries. The Validation card uses a 3px `--t-competitor` top rule; stage rows carry a 3px left bar: `--t-experiment` done, `--accent` running or waiting, `--error` stopped or failed.

## Type

Self-hosted under `dist/assets/fonts` (latin subset, SIL OFL), because the server CSP only allows same-origin styles and fonts.

- Display: Fraunces (variable, opsz auto), 500. Page titles, section headings, brand wordmark in italic.
- Body: Instrument Sans (variable 400-700), 15px / 1.55.
- Meta: DM Mono 400/500. Breadcrumb, entry-type labels, stage tags, dates, counts, footer.
- Scale: 12.5 / 14 / 16 / 20 / 26 / 36 px (`--fs-xs` to `--fs-2xl`); 32 and 26 px for page titles on desktop and phones. Body text is 16px, card prose 15px.
- Labels (field names, stat names, table heads) are 12.5px semibold sans, sentence case, no letter-spacing. A rounder face would suit the mood even more; only the three bundled families are used until one is approved and added under `dist/assets/fonts`.

## Spacing, radius, motion

- Space: 4 / 8 / 12 / 16 / 24 / 32 / 48 (`--s1` to `--s7`).
- Radius: 6 (tags) / 10 (controls, inset panels, menus) / 18 (cards, drawer, dialog); buttons and pills are fully round. Cards sit on a soft warm shadow with a 1px hairline; lists inside cards stay ruled rows.
- Easing: `cubic-bezier(0.23, 1, 0.32, 1)` ease-out everywhere. Durations 120 / 180 / 240 ms. Only transform, opacity and colour are animated, except the entry-row bar (top/bottom, 180 ms).
- Micro-interactions: buttons press to scale 0.97; entry rows grow their type-coloured bar from a short tick to the full row height on hover; on brand hover the flame of the mark stretches up and the spark chip flicks off 45 degrees (hover-capable devices only); dialog and toast enter with `@starting-style` (8px rise, opacity); link underlines fade in; focus ring is a 3px accent wash.
- Cards fade in and rise 8px with a 50ms stagger; the drawer slides in over 260ms with the iOS-style curve; reordered cards glide to their new slot (FLIP, 220ms). Hover effects on buttons are gated by `(hover: hover)`. `prefers-reduced-motion` collapses all transitions.

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

## Home hierarchy

Order is fixed: capture (a 2px ink field, 19px type, the one big primary button), then "needs you" (count chips `.need-chip` that scroll to the grill questions and To review; review groups are `<details>`, open when 3 or fewer), then the assistant run (steps collapse into a "N steps" summary once the run finishes), then "Where I left off" and the four work lists.

## Entry editor

A document, not a form. Header row: mono mode label, three pills (`.pill`: type with a type-colour square, stage, a "+ category" text pill), a save status (`.save-status`: Saved / Saving / Unsaved changes / error), a ⋯ menu (`details.menu`: Open brief, Founder review, Move to trash) and close. Title is a 36px Fraunces textarea with no box; notes are a borderless, auto-growing writing area. Existing entries autosave (900 ms debounce, plus on close and before any navigation); new ones use Save entry. Links are removable chips with a "+ link" popover (search, first match on Enter). Type-specific fields sit in a collapsible Details section (opens by itself when the notes are empty). Voice and attachments are one "Audio & files" list: one `.file-row` per file (inline player and duration for audio, row menu for Transcribe, Download, Trash), Record / Add file below, and the transcript review box only while a transcript is pending. Ideas get tabs (Overview, Research, Numbers, Test) with an accent dot on Test when Spark is waiting for you. Sheet is 820px wide; under 560px it is full screen.

## Motion additions

All use `--ease`, 120-240 ms, transform and opacity only, and collapse under `prefers-reduced-motion`.

- Capture: the button shows "Adding…" in ink while the request runs, and the new inbox row drops in with a wash flash (`.entry-row.fresh`).
- Assistant steps: each new step slides up 6px and its square ticks (scale 2.2 to 1, accent to ink); only steps added since the last paint animate.
- To review: Accept slides the row right and turns its bar emerald; Discard slides it left and turns the bar red; the request runs in parallel and a failure restores the row.
- Test progress: `.vt-bar`, one segment per stage (emerald done, accent pulsing for the running or waiting stage, red for stopped or failed), and a check before "Done".
- Editor: tab underline scales in from the centre, panes fade up 4px, menus and popovers pop from 0.96 scale at their trigger corner.

## Marks

`.by-assistant` (solid square, wash) and `.by-simulation` (hollow square, dashed ultramarine) share one size, font and padding so they read as a pair.

## Entry dashboard

An idea opens as a grid of cards, not a column. Other entry types use the same grid with two cards (details, links and files).

- Grid: 3 equal columns at 1200px and up, 2 columns to 700px, 1 column below. `grid-auto-flow: row dense` with 6px implicit rows; each card measures itself (ResizeObserver) and sets `grid-row-end: span N`, so cards pack without holes. Gap is 20px.
- Cards (ids): `kpis` (4 key tiles), `hero` (the AI summary: verdict, strongest signal, biggest risk, collapsed numbers and competitors, one next step), `charts` (buy rate by segment with click or hover detail, and the price range), `numbers` (your price against the test price, where each sale goes, customers needed against capacity), `details`, `timeline` (stages), `research`, `links`, `comp` (competitors grouped direct, indirect, substitutes, numbered, with a positioning map). Default widths: kpis, hero, charts, numbers 2; comp 3; the rest 1.
- Each card has a grip at its top right. Drag it to reorder (pointer events; the other cards move live). Its menu has Move up or left, Move down or right, Wider, Narrower, Compact height or Full height, and Reset layout, so everything works from the keyboard. Layouts are saved per entry type in `ui-layout.json` in the data directory (`/api/ui-layout`) and applied to every entry of that type. Below 700px there is no drag and no width control; the grip menu keeps the move actions and the grip is a 44px target.
- Compact height caps a card at 300px and scrolls inside it. Detail that needs room opens in the right-hand drawer (test run, research and papers, numbers, competitor search) so the page never turns into one long scroll.
- Simulated material gets one small dashed "Simulated" pill per card. Links inside cards are ink, not accent; the accent is used for the primary button, the hero card's top rule, the next-step label and focus.
