# Spark product roadmap

Spark is a personal research notebook. The main workflow is to notice a problem, investigate alternatives, sketch an idea, and run a small test. A phone is the capture device and a computer is the main editing and model-serving device.

## Handoff for the next implementer

Start from commit `66b9ed2` or a later checkout of `main`. Run `npm test` for the baseline and `npm start` to use the app. The static files in `dist/` are editable source. The README describes current behavior, credentials, phone setup and storage limits. Keep personal workspace data on the user's computer and source code in the private GitHub repo.

| Area | Already in Spark | Remaining work |
| --- | --- | --- |
| Personal dashboard | Inbox, ideas, problems, technology, notes, experiments, links, search, trash, backup and restore. The home screen uses saved entries. | Keep the quiet workbench design and one-handed navigation as tools are added. Support both a quick thought and a detailed investigation of a pain, business opportunity or emerging technology. Use real data and useful empty states throughout. |
| Model team | OpenAI, Claude, Gemini and a local compatible endpoint. Pick one model, run independent replies in parallel or have a team critique earlier rounds. Role and model are independently configurable. | Preserve participant-specific context inspection, cancellation and retry. Add selected project materials, blind ratings and reviewed drafts with source references. |
| Competition | Editable external search query, linked competitor records, pricing and source fields, side-by-side comparison. | Add dated evidence and optional assisted discovery as described below. |
| Phone and voice | HTTPS gateway, one-use pairing, revocation, Spark mark and home-screen icons. Record, pause, import, replay, retry and append a corrected transcript to searchable notes. | Verify the physical phone milestone. Add persistent timestamped transcript segments, language selection and queued transcription. A local speech service must be separately configured today. |
| Drawing, project pages, idea development and offline capture | Existing records, attachments and discussions supply the building blocks. | Implement the workflows below. Current chat accepts text context. Current capture requires a connection to the desktop. |

**Build order.** First exercise phone capture through the real gateway. Then build the sketch editor, connect materials to project discussions, and add offline capture. Develop the eight idea workflows against those foundations. Research history can ship independently. Record test results and outstanding device or provider checks with each commit.

**First acceptance run.** On a phone with a trusted HTTPS connection, open Spark from its icon, record a minute, replay it, transcribe it, correct a name and save. Search for the corrected name on desktop. Repeat after a failed transcription and confirm the recording survives. Try the same workspace URL from an unpaired browser and again after revocation. Check the keyboard, dialogs and navigation in portrait and landscape. Automated tests at the baseline use controlled provider responses. A live transcriber and physical phone still need verification.

## 1. Competition research

Start research from a saved idea. Edit a search phrase before opening a search engine. Look for direct competitors, adjacent products and the current workaround, including spreadsheets and manual services. Record who each serves, what it offers, its price with units, the source URL and the date checked. Keep personal interpretations and unanswered questions separate from observed facts. Compare the alternatives side by side. Save useful findings as context for a model discussion.

Acceptance: reopen an idea after restarting Spark and compare two linked alternatives, trace a pricing observation to its source and identify a gap to test. Unknown prices stay blank. Search and recordkeeping require no model subscription.

Follow-up: dated snapshots and changes, multiple citations per claim, and optional assisted discovery. Any future automated search must return retrievable citations. Show proposed queries, providers and limits before starting paid research. Reuse prior results before spending again.

## 2. Phone access and identity

Keep the desktop database authoritative. Add authenticated HTTPS access over a private connection, pairing and revocation, a dedicated Spark logo, favicon, home-screen icons and install manifest. Optimize capture, search, inbox and chat for one-handed use.

Acceptance: a paired phone can create an entry that appears on desktop; an unpaired or revoked device cannot read entries or invoke providers. Verify on physical iOS and Android browsers, including keyboard and rotated layouts.

## 3. Voice capture and transcription

Record, pause, replay or import audio. Save the original before attempting transcription. Queue a local transcriber on the computer by default; offer explicit opt-in cloud transcription. Keep editable transcripts, timestamps, language selection, progress, retry and links back to audio. Offer optional draft titles and actions after transcription.

Acceptance: interrupt transcription, restart, retry without re-recording and search the corrected text. Tapping a timestamp seeks to the matching audio.

## 4. Sketches, architecture and walkthroughs

Add a touch canvas with pen, eraser, shapes, connectors, labels, zoom and undo. Import a notebook photo for annotation. Save the editable document with PNG/SVG export. Pin spoken or typed comments to objects so the walkthrough stays attached when an object moves.

Acceptance: sketch a flow on a phone, revise a connected component on desktop, replay a pinned comment and export a legible diagram.

## 5. Raw material into a project

Give each idea a project page that gathers linked notes, recordings, sketches, evidence, decisions and experiments. Select individual materials for discussion. Preserve the original file and recording timestamp or sketch object behind each citation. Let the team propose requirements or a test; open suggestions as editable drafts before saving them.

Acceptance: send one selected voice note and one selected sketch to a builder and a skeptic, review their different answers, then save an experiment with links back to both originals. Show which media each selected model can actually consume.

## 6. Develop and revisit ideas

| Feature | Working behavior |
| --- | --- |
| Catch a workaround | Capture a specific incident, person or audience, current tools, cost and evidence; link to a problem. |
| Where I left off | Show the last decision, outstanding question and next action with links to original notes. |
| Find collisions | Suggest related entries with an inspectable reason. Save a link only when accepted. |
| Fork an idea | Keep a parent reference and copy selected material into independently editable branches. |
| Business math | Edit price, costs, hours per sale and available time; calculate margin, break-even and capacity with visible assumptions. |
| Blind roundtable | Hide participant names while rating replies, then reveal attribution and preserve the original discussion. |
| Idea brief | Select evidence, sketch, decision and experiment; export a one-page brief with attribution. |
| Choose by time available | Filter next actions by estimated duration, device and context. |

Acceptance: carry one observation through competitor comparison, two alternative designs, a team critique and a measurable experiment. Every decision can be traced to the supporting material.

## 7. Offline capture and retrieval

Persist drafts, audio and drawings on the phone while disconnected. Show local, syncing, synced and conflict states. Use stable IDs and idempotent writes. Add share-to-inbox, opt-in photo text recognition and timestamp search after sync is reliable.

Acceptance: capture in airplane mode, close and reopen, reconnect twice and see exactly one intact copy on each device. Resolve simultaneous edits without losing either version.

## Cost and release checks

Use ordinary code for search links, storage, filtering, comparison and calculations. Use local inference when available for transcription and optional suggestions. For cloud models expose the selected model, selected material, call count and token cap before sending. Record real usage and display unknown cost when rates are unavailable. Ship each phase with persistence checks and a normal user-path test; mobile features also need real-device verification.

## Implementation notes and checks

| Work item | Suggested implementation and completion check |
| --- | --- |
| Editable drawings | Store versioned geometry with stable object IDs. Arrows reference endpoints by ID. Support move and reconnect, pen, eraser, undo, box, arrow and text with touch and mouse. Reference notebook photos and recorded walkthrough clips by attachment ID. Reload after restart, drag a box, reconnect its arrow, replay its pinned clip and check the export against the edited drawing. |
| Project material and team drafts | Build the idea page from record links and attachment metadata. Let the user select an excerpt, timestamp, sketch or research observation before choosing model participants. Preview the actual representation sent to each model. For text-only models offer a reviewed caption or transcript. Preserve selected source references in the resulting experiment even after the chat closes. |
| Offline capture | Cache the capture interface. Store drafts and attachment blobs in IndexedDB with stable client IDs. Keep a local copy until the desktop acknowledges the entire capture. Enforce pairing on sync, make retries idempotent, and preserve both versions on conflicting edits. Test interrupted uploads, expiry of pairing, repeat sync and reopening while offline. |
| Revisit, workarounds and forks | Store decisions, open questions and next actions as dated project material. Capture an observed workaround with its evidence. Fork a branch with its own next action and parent link. Reopen an old idea, trace its last decision and edit a branch without changing its parent. |
| Connections and action filters | Start with shared terms, people or linked problems. Show why an older entry appeared and let the user accept or dismiss it. Store estimated minutes and device on actions. A ten-minute phone filter should return only eligible actions. |
| Business math | Record currency, price, variable cost, fixed costs per period, time per customer and available hours for the same period. Show contribution per customer, break-even count and capacity. Test zero time, missing inputs and non-positive contribution without displaying misleading results. |
| Blind roundtable and brief | Keep reply attribution internally, hide identifying UI labels while rating, and persist ratings before reveal. For the one-page brief, let the user select the sketch, evidence, decision and proposed test. Check the exported page for legibility and trace each claim to its source. |
| Search, sharing and research history | Index reviewed transcript segments and photo OCR with links back to their source. Receive shared URLs as inbox drafts on supporting phones. Append dated competitor observations so earlier prices and citations remain retrievable. Verify offline shared capture, a timestamp seek and a comparison across two observation dates. |

Extend the existing server routes in `server.cjs`, SQLite validation and backup/import in `store.cjs`, attachment handling in `attachments.cjs`, and the browser editor in `dist/assets/`. Reuse the adapters in `providers.cjs`, the private gateway in `phone.cjs` and speech integration in `voice.cjs`. For each new persisted format, open an older workspace, save, restart, export and restore into a temporary workspace. Keep the original records and media usable through that round trip.
