# Spark product roadmap

Spark is a personal research notebook. The main workflow is to notice a problem, investigate alternatives, sketch an idea, and run a small test. A phone is the capture device and a computer is the main editing and model-serving device.

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

## 5. Develop and revisit ideas

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

## 6. Offline capture and retrieval

Persist drafts, audio and drawings on the phone while disconnected. Show local, syncing, synced and conflict states. Use stable IDs and idempotent writes. Add share-to-inbox, opt-in photo text recognition and timestamp search after sync is reliable.

Acceptance: capture in airplane mode, close and reopen, reconnect twice and see exactly one intact copy on each device. Resolve simultaneous edits without losing either version.

## Cost and release checks

Use ordinary code for search links, storage, filtering, comparison and calculations. Use local inference when available for transcription and optional suggestions. For cloud models expose the selected model, selected material, call count and token cap before sending. Record real usage and display unknown cost when rates are unavailable. Ship each phase with persistence checks and a normal user-path test; mobile features also need real-device verification.
