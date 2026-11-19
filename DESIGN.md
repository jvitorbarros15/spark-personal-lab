# Spark design

Mode: operate (a task tool, used daily). Expression lives in type, colour and small details, not in decoration.

## Direction

A sunny kitchen-table notebook. Oat paper, soft cocoa ink and one marigold accent (the "spark"), with rounded type and round controls. Everything else is quiet: entry types are small dots, status is a soft pill, and semantic colour is kept to three meanings (good, risk, neutral). Labels are plain sentence case, never tiny capitals, and monospace is only for code. Dark mode is a warm cocoa, not blue-black. Follows `prefers-color-scheme`; there is no toggle.

## Palette

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | #faf5ee | #1d1a17 | page, competitor tiles, map plot |
| `--surface` | #fffdf9 | #272320 | cards, dialogs, menus, active nav item |
| `--sunken` | #f3ebde | #161310 | sidebar, empty states, neutral pills, chart tracks |
| `--input` | #ffffff | #1a1714 | fields |
| `--border` | #ebe1d1 | #3a342e | hairlines, card edges |
| `--border-strong` | #d4c6b0 | #5c5348 | outlined buttons, dashed "simulated" outlines |
| `--field` | #96897a | #8a7e6e | field borders (3:1 against the page and cards) |
| `--ink` | #2c2722 | #f1eadf | text |
| `--muted` | #675e52 | #b9ae9d | secondary text, neutral state |
| `--accent` | #f6ad37 | #f8b84e | primary button, brand tile, hero rule, direct competitors |
| `--accent-hover` | #f09d1c | #fbc66a | primary hover |
| `--accent-deep` | #b06a08 | #f8b84e | focus ring, field focus, outlines around marigold marks |
| `--accent-ink` | #95550a | #f8c06a | links and text in the accent |
| `--on-accent` | #2a1c06 | #2a1c06 | text on the accent (dark, never white) |
| `--wash` | #fdefd2 | #3a2c14 | next step, "where I left off", selected rows, focus halo |
| `--good` | #2a7653 | #72cfa0 | done, passed, sourced, kept margin |
| `--good-wash` | #e1f1e7 | #1c3328 | background of a good pill |
| `--error` | #b53d2c | #ff9482 | risk: failed, below the gate, danger |
| `--risk-wash` | #fbe7e1 | #3d211c | background of a risk note |

One accent only. Marigold is too light to carry white text or to stand alone as a thin line on paper, so text on it is always `--on-accent`, and anything that must be seen as a shape (focus rings, the outline of a marigold dot) uses `--accent-deep`. Good, risk and neutral are the only other meanings, and each also carries a word or a shape, never colour alone.

Contrast (WCAG AA): ink 13.6:1 and muted 5.9:1 on the page; accent text 5.4:1; good 5.1:1; risk 5.3:1; text on the accent 8.6:1; focus ring 3.9:1; field borders 3.1:1 or more. Dark: ink 14.5:1, muted 7.9:1, accent text 10.5:1, good 9.2:1, risk 8.1:1, field borders 3.9:1 or more.

Entry types (light / dark), used as 8px dots only (list rows, nav), never as text colour:

| Type | Light | Dark |
| --- | --- | --- |
| inbox | ink | ink |
| idea (honey) | #e39a17 | #f3b94d |
| problem (rose) | #d5667a | #f08a9b |
| experiment (fern) | #3f9a76 | #72cfa0 |
| competitor (cornflower) | #5b7fc4 | #8fa9e6 |
| note (stone) | #948b7e | #a8a193 |
| technology (olive) | #7c9833 | #b7cf6a |

No violet. No gradients. No glass blur.

Simulated material (anything a model wrote on its own): a dashed neutral outline, labelled "Simulated" with a hollow dot (`.by-simulation`, colour `--sim`, which is the muted text colour). It is used on To review rows, the editor mark, card titles and the brief's "Guesses to test". It never appears on owner-written entries. In the test drawer, stage rows carry a bar: `--good` done, `--accent` running or waiting, `--error` stopped or failed.

## Type

Self-hosted under `dist/assets/fonts` (latin subset, SIL OFL), because the server CSP only allows same-origin styles and fonts. Two files, about 54 KB together.

- Everything: Nunito (variable, 200 to 1000), one file. Body 16px / 1.6 at weight 450; page titles and card headings 800; buttons, entry titles and names 700; labels 600. The rounded terminals are the friendly voice, so there is no separate display face and no italics.
- Code only: DM Mono 400 (`--font-code`: `pre`, `kbd`). `--font-mono` now points at the body face, so older rules that asked for mono get Nunito.
- Scale: 12.5 / 14 / 16 / 20 / 26 / 36 px (`--fs-xs` to `--fs-2xl`). Card headings and section headings are 19px.
- Labels (field names, stat names, table heads, pills) are 12.5px semibold, sentence case, no letter-spacing, no capitals. Numbers in tables, KPI tiles and dates use tabular figures.

## Spacing, radius, motion

- Space: 4 / 8 / 12 / 16 / 24 / 32 / 48 (`--s1` to `--s7`).
- Radius: 8 (small) / 12 (fields, nav items, rows) / 14 to 18 (inset panels, menus, empty states, competitor tiles) / 22 (cards, dialogs); buttons, pills and the search field are fully round.
- Depth: cards sit on a soft warm shadow with a 1px hairline (`--shadow-card`); hovered buttons lift onto `--shadow-lift`; menus and dialogs use `--shadow-pop`. Nothing else has a shadow.
- Pills are one family: round, 12.5px semibold, `--sunken` fill for neutral facts (stage, kind), `--wash` with accent text for the assistant and direct competitors, `--good-wash` for sourced, and a dashed outline for anything simulated or unconfirmed.
- Easing: `cubic-bezier(0.23, 1, 0.32, 1)` ease-out everywhere. Durations 120 / 180 / 240 ms. Only transform, opacity, colour and shadow are animated.
- Hover, focus, press: buttons lift 1px with a soft shadow and press to scale 0.97; list rows tint and their type dot grows; nav items press to 0.98; map dots grow to 1.18; fields and the search pill get an `--accent-deep` border and a 4px `--wash` halo; everything else gets a 2px `--accent-deep` focus outline. On brand hover the flame of the mark stretches and the chip flicks. Hover effects are gated by `(hover: hover)`.
- Cards fade in and rise 8px with a 50ms stagger; the drawer slides in over 260ms; reordered cards glide to their new slot (FLIP, 220ms). `prefers-reduced-motion` collapses all transitions and animations.
- Browser surfaces follow the palette: selection is `--wash`, the caret and checkboxes are `--accent-deep`, scrollbars are `--border-strong`.

## Copy

Short, plain and kind. The home page asks "What's on your mind?". Empty states say what is true and what will fill them ("Your inbox is clear. New captures land here until you sort them."), never a bare "No data". Buttons name their action.

## Rationale

- The first redesign (cream paper, vermilion, a serif display face, six saturated type hues, mono capitals) had identity but read as serious and rough. This one keeps the structure and softens the voice: one rounded family, one warm accent that reads as light rather than alarm, and muted type hues, so nothing competes with the content.
- Marigold is the "spark": a lit match, not a red pen. It is used as a fill with dark text, which keeps it friendly and well above AA.
- Type colour lives in one 8px dot, so a list of mixed entries is scannable at a glance without turning the page into a rainbow.
- The active nav item is a raised paper chip (`--surface`, soft shadow, weight 800) on the sunken sidebar.
- Phone: sidebar becomes wrapping pills, fixed bottom action bar kept as is; verified no horizontal overflow at 390px.

## Logo

Mark: a lit match leaning on a ruled line, with one spark chip flicked off the rule. One colour, hand-written paths on a 24px grid (rule, thin stick, oval head, asymmetric flame with a cut-out inner core, chip), no strokes, no gradients. It reads as "spark" (match, flame, chip) and "notebook" (the ruled line). The flame leans and flicks its tip, and its core is negative space, so it cannot read as a droplet.

Explorations are in `docs/logo/explorations/`; `comparison.png` shows each at 16, 32 and 192 px:

- a, b, c (first round): a symmetric-flame match, a flame between rule stubs and a margin slash. Dropped: the flame read as a droplet or campfire, the slash as a generic icon.
- d, flame match at 45 degrees on a full rule with a chip.
- e, the same on a short underline with no chip. Dropped: weaker footing, loses the notebook rule.
- f, steeper (about 62 degrees) match on a full rule with a chip (chosen): the most confident angle, the longest stick, and the clearest stick-to-head-to-flame progression at 32 px and up.

Files: `dist/assets/spark-mark.svg` (currentColor), `dist/assets/favicon.svg` (cocoa mark on a marigold rounded tile), `spark-180/192/512.png` (full-bleed marigold, cocoa mark) and `spark-512-maskable.png` (mark scaled to fit the 80% safe zone), `docs/logo/spark-logo.svg` (mark plus the earlier wordmark, outlined to paths, follows the colour scheme). In the app and on icons the mark is dark cocoa (#2a1c06) on a marigold (#f6ad37) tile: a 12px-radius tile in the sidebar, a rounded tile for the favicon, full bleed for the PNG icons. Manifest `theme_color` and `background_color` are oat (#faf5ee). `docs/logo/` still holds the earlier vermilion explorations.

## Hooks added outside CSS

- `dist/assets/app.js` `entryRow()`: `data-type="${r.type}"` on `.entry-row` (drives type colour).
- `dist/index.html`: inline SVG logo mark (see Logo) replaces the PNG in the brand link, preload links for two fonts, light/dark `theme-color`.
- `server.cjs`: `.woff2` MIME type added.

## Font licenses

Both families are SIL Open Font License 1.1, self-hosted in `dist/assets/fonts/`, with their license texts in `licenses/`:

- Nunito: `licenses/OFL-Nunito.txt` (Copyright 2014 The Nunito Project Authors)
- DM Mono: `licenses/OFL-DM-Mono.txt` (Copyright 2020 The DM Mono Project Authors)

## Feature views

- Business math (`#math-panel`): a tinted ledger with a honey top rule and dotted leaders between label and value.
- Find related research (`#papers-panel`): paper results reuse `.research-comparison` with a neutral left bar; linked competitors use a green bar.
- Where I left off (`section.notice`): marigold-washed card with plain sentence-case labels.
- Founder review button: outlined in the accent.
- Brief (`#brief/<id>`): one-pager with section labels in a left column and a double rule under the title. Print forces the light palette regardless of colour scheme, hides all chrome, and avoids splitting sections across pages.

## Home hierarchy

Order is fixed: a "What's on your mind?" heading, then capture (a soft 18px-radius field with a card shadow, 20px type, the one big primary button), then "needs you" (count chips `.need-chip` that scroll to the grill questions and To review; To review is a short summary card: the total as "133 drafts from 17 runs", the three most recent runs as single rows with Accept all and Review, and a "See all" link). The full list lives on its own page, `#review` (`#review/<run>` opens one run): every run is a collapsed `<details>` with Accept all in its summary, and each draft row carries two quiet text buttons, Accept and Discard, then the assistant run (steps collapse into a "N steps" summary once the run finishes), then "Where I left off" and the four work lists.

## Entry editor

A document, not a form. Header row: mode label, three pills (`.pill`: type with a type-colour square, stage, a "+ category" text pill), a save status (`.save-status`: Saved / Saving / Unsaved changes / error), a ⋯ menu (`details.menu`: Open brief, Founder review, Move to trash) and close. Title is a 36px Nunito 800 textarea with no box; notes are a borderless, auto-growing writing area. Existing entries autosave (900 ms debounce, plus on close and before any navigation); new ones use Save entry. Links are removable chips with a "+ link" popover (search, first match on Enter). Type-specific fields sit in a collapsible Details section (opens by itself when the notes are empty). Voice and attachments are one "Audio & files" list: one `.file-row` per file (inline player and duration for audio, row menu for Transcribe, Download, Trash), Record / Add file below, and the transcript review box only while a transcript is pending. Ideas get tabs (Overview, Research, Numbers, Test) with an accent dot on Test when Spark is waiting for you. Sheet is 820px wide; under 560px it is full screen.

## Motion additions

All use `--ease`, 120-240 ms, transform and opacity only, and collapse under `prefers-reduced-motion`.

- Capture: the button shows "Adding…" in ink while the request runs, and the new inbox row drops in with a wash flash (`.entry-row.fresh`).
- Assistant steps: each new step slides up 6px and its square ticks (scale 2.2 to 1, accent to ink); only steps added since the last paint animate.
- To review: Accept slides the row right and turns its dot green; Discard slides it left and turns the dot red; the request runs in parallel and a failure restores the row.
- Test progress: `.vt-bar`, one segment per stage (green done, accent pulsing for the running or waiting stage, red for stopped or failed), and a check before "Done".
- Editor: tab underline scales in from the centre, panes fade up 4px, menus and popovers pop from 0.96 scale at their trigger corner.

## Marks

`.by-assistant` (solid dot, wash) and `.by-simulation` (hollow dot, dashed neutral outline) share one size, font and padding so they read as a pair.

## Entry dashboard

An idea opens as a grid of cards, not a column. Other entry types use the same grid with two cards (details, links and files).

- Grid: 3 equal columns at 1200px and up, 2 columns to 700px, 1 column below. `grid-auto-flow: row dense` with 6px implicit rows; each card measures itself (ResizeObserver) and sets `grid-row-end: span N`, so cards pack without holes. Gap is 20px.
- Cards (ids): `kpis` (4 key tiles), `hero` (the AI summary: verdict, strongest signal, biggest risk, collapsed numbers and competitors, one next step), `charts` (buy rate by segment with click or hover detail, and the price range), `numbers` (your price against the test price, where each sale goes, customers needed against capacity), `details`, `timeline` (stages), `research`, `links`, `comp` (competitors grouped direct, indirect, substitutes, numbered, with a labelled positioning map). Default widths: kpis, hero, charts, numbers 2; comp 3; the rest 1.
- Each card has a grip at its top right. Drag it to reorder (pointer events; the other cards move live). Its menu has Move up or left, Move down or right, Wider, Narrower, Compact height or Full height, and Reset layout, so everything works from the keyboard. Layouts are saved per entry type in `ui-layout.json` in the data directory (`/api/ui-layout`) and applied to every entry of that type. Below 700px there is no drag and no width control; the grip menu keeps the move actions and the grip is a 44px target.
- Compact height caps a card at 300px and scrolls inside it. Detail that needs room opens in the right-hand drawer (test run, research and papers, numbers, competitor search) so the page never turns into one long scroll.
- Positioning map: each numbered dot carries its company name beside it. Labels are placed by a small collision pass (`compMap` in `app.js`): beside the dot, flipped to the other side near an edge, above or below, then nudged vertically with a thin leader line until nothing overlaps. Long names wrap onto more lines and are never cut; an aside in brackets is left out of the label and stays in the tooltip, the list and the line under the map, which shows the full name of the dot you point at or tab to. The map is drawn at the card's real width (redrawn when the card is resized), so type stays 12.5px on a phone. Axes show a short name with a short label at each end; the full axis sentence sits under "What the axes mean". Direct competitors are marigold, indirect are ink, substitutes are hollow, and a legend says so.
- KPI tiles colour only the figure (`--good` or `--error`); there is no coloured rule on top.
- Competitors are soft tiles on `--bg` instead of ruled rows.
- Simulated material gets one small dashed "Simulated" pill per card. Links inside cards are ink, not accent; the accent is used for the primary button, the hero card's top rule, the next-step box and direct competitors.
