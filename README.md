<p align="center"><img src="docs/logo/spark-logo.svg" alt="Spark" width="240"></p>

# Spark

A local workbench for capturing thoughts, shaping ideas, and testing assumptions. It runs on your computer and starts empty. Anything a model writes is marked, kept apart from your evidence, and waits for your review.

![Spark home in dark mode](docs/screenshots/home-dark.png)

![Spark home in light mode](docs/screenshots/home-light.png)

Screenshots use sample data. The color scheme follows your operating system.

## Features

- **Workspace.** Capture a thought to the inbox, then turn it into an idea, problem, note, technology, competitor, or experiment. Each type has structured fields: an experiment records a hypothesis, test plan, success criteria, results, and a continue, change, or stop decision. Entries can link to each other.
- **Home.** A "Where I left off" summary for the most recent idea (next action, last decision, open question), plus the inbox, work in progress, next actions, and recently edited entries.
- **Search** across titles, notes, structured fields, and saved discussions.
- **Trash and backups.** Trashed entries and discussions can be recovered. Trashing an entry keeps its attachments. Spark writes atomic JSON recovery snapshots, and Settings exports and imports full workspace backups.
- **Attachments.** Save an entry first, then attach files. Limits are 5 MB per file and 20 MB in total.
- **Business math.** A panel on each idea computes contribution per sale, margin, break-even units, and profit at capacity from the numbers you enter.
- **Competitor research.** The idea editor opens an external web search for your query. You record what you found: product facts, audience, pricing with the date checked, gaps, and source links. Spark makes no search API calls.
- **Related research.** Search OpenAlex for papers from the idea editor and save a result as a note. Nothing is saved unless you choose to.
- **Literature research.** "Research this idea" runs a staged literature pass: a research frame, search and snowballing, relevance screening that you control, a literature map, a differ table and a draft next study. Papers are verified against Crossref or arXiv, quotes must match a stored abstract, and references export as BibTeX. See [The research pipeline](#the-research-pipeline).
- **Multi-model discussions.** Ask one or more models the same question in solo, roundtable, or team mode. See [Discussions](#discussions).
- **Idea testing.** "Test this idea" in the idea editor runs a sequential pipeline: a grill (rounds of questions with recommended answers, adapted from the grilling skill by Matt Pocock, MIT, see [licenses](licenses/mattpocock-skills-MIT.txt)), a three-lens board and chair, a competitor scout, a seeded buyer panel (20 buyers, or 100 on request), Van Westendorp pricing and business math, a marketing plan and a draft experiment. One job runs at a time, at most 25 model calls per job, cancellable and resumable, with unchanged stages reused on a rerun. See [The idea test pipeline](#the-idea-test-pipeline). Everything a model writes is marked Simulated, waits under To review, and never fills evidence fields. The same idea can be exported to a folder and tested in Claude Code instead; you run those commands yourself and import the results.
- **Founder review.** One button starts a parallel review of an idea by five participants: three board lenses (offers, monopoly, product), a CFO, and a launch lead. The idea and its linked entries are the context. The review uses the provider and model of your most recent discussion. Presets are adapted from [founder-skill](https://github.com/Jakeschincariol/founder-skill) by Jake Schincariol (MIT).
- **Printable brief.** `#brief/<id>` shows a one-page view of an idea. **Print / save PDF** uses the light palette and hides the interface.
- **One-tap dictation.** The home page has a **Record** button beside the capture box. Press it, speak, press it again. The audio is saved, transcribed, and added to the inbox as a new entry whose transcript you can review. Ctrl+K (Cmd+K on macOS) returns to home and focuses the capture box.
- **Phone capture.** Capture from a paired phone. See [Phone](#pair-a-phone).

Model output is a draft until you save it. Replies can become a reviewable draft, and nothing is written to your workspace until you give it a title and save.

![Idea brief](docs/screenshots/brief.png)

## Quick start

You need **Node.js 22.13 or newer** (Node 24 or newer recommended). Spark has no npm dependencies and no build step. Storage uses Node's built-in SQLite, so some Node versions print an experimental warning at startup.

```powershell
git clone https://github.com/jvitorbarros15/spark-personal-lab.git
cd spark-personal-lab
npm start
```

Spark opens at **http://127.0.0.1:4173**. Open the app, then type a thought in the capture box or press **Record** to dictate. Discussions work out of the box with a local [Ollama](https://ollama.com) server at its default URL, with no key. Other options are in [Providers and privacy](#providers-and-privacy).

On Windows you can double-click **Start Spark.cmd** instead. It checks your Node version, starts the `spark-whisper` Docker container if Docker is installed (see [Local transcription](#local-transcription)), and opens the browser. Keep the terminal open; Ctrl+C stops the server. `node server.cjs` starts the server without opening a browser.

The server binds to loopback only.

## How it works

Spark is a small Node server with a SQLite file and a single-page frontend. The interesting part is what happens after you capture a thought. Models do the drafting, but the code decides what a model is allowed to touch, what it costs, and what counts as evidence. Three rules hold everywhere:

- **Generated is not evidence.** Everything a model writes is stored with an origin (`assistant` or `simulation`) and an unreviewed flag. It sits in **To review** until you accept it. While unreviewed, it cannot fill an evidence field (an experiment's results or decision, a problem's evidence, a competitor's pricing or sources, an idea's price and cost inputs), and an idea cannot move to *validating* without an experiment whose results you wrote yourself.
- **Local first.** Small decisions run on a local model. Cloud models are used only for long writing, only when you configured them, only inside a budget, and never for [Private](#private-entries-and-fail-closed-rules) entries.
- **Everything is stoppable.** Each run can be cancelled, undone or resumed, and a restart never loses finished work.

### From capture to assistant

```mermaid
flowchart LR
  A["Type or dictate<br>(Whisper via Speaches)"] --> B[Inbox entry]
  B --> C["Planner<br>fills one JSON form"]
  C --> D{"Decision engine<br>local logprobs"}
  D -- confident --> E["Create entries, attach,<br>search papers"]
  D -- unsure --> F["Save a note<br>and ask you"]
  E --> G["Writer drafts a<br>short reply"]
  G --> H[To review]
  F --> H
  H -- Accept --> I[Your workspace]
  H -- Discard or Undo --> J[Trash]
```

**Capture and voice.** A capture is an inbox entry. Dictation records audio, saves it, sends it to a speech-to-text server on loopback (by default [Speaches](https://github.com/speaches-ai/speaches) running faster-whisper, see [Local transcription](#local-transcription)), and uses the transcript as the entry body. With the assistant on and **run on capture** enabled, each new capture is queued for it. One capture runs at a time, up to 10 wait in the queue, and a run is limited to 3 model calls and 10 minutes.

**Planner.** The planner model returns one small JSON form: an intent, an entry type, a title, a few fields it can copy from the capture, an optional entry to attach to (chosen from an index of your 50 most recently edited reviewed entries, never from ids it invents), and an optional paper query. It is told never to write evidence, results, prices or numbers, and the code drops any field outside a per-type allow list. If the reply is not valid, Spark asks once for a repair. If that fails too, it falls back to a plain idea draft built from your own words and skips the decision engine.

**Decision engine** (`decide.cjs`). The planner's guess at intent is not trusted on its own. A local Ollama model is asked a multiple-choice question ("what kind of capture is this?") and the engine reads the log probabilities of the answer token. That gives a real probability for each option instead of a self-reported confidence.

- The engine talks to Ollama on loopback and refuses cloud model names, so it cannot leak a capture.
- If the top option is below the confidence threshold (0.6 by default), or the probability mass on valid options is under 0.5, Spark does not guess. It saves the capture as a plain note and asks you which of the two leading intents you meant.
- A planner suggestion to attach a capture to an existing entry must also pass a yes/no check from the engine (P(yes) at least 0.5) and an embedding check with `bge-m3` (cosine similarity at least 0.58). Otherwise the attachment is dropped.
- Per-question temperature scaling can be calibrated against labelled examples (`decide-eval.cjs`), and embeddings are cached in SQLite by content hash.
- The same engine screens papers by relevance in the research pipeline.

**Marked entries, Undo and review.** Entries made by a run carry the run id, the stage and the model name, and are marked as drafts. **Undo** on a run moves everything that run created to trash and removes its links. In **To review** you accept or discard drafts one by one or per run. If paper search is on and the entry is not private, the run saves one reading-list note of up to the configured number of papers (5 by default) (OpenAlex first, see [research](#the-research-pipeline)) instead of many separate entries. The reply the assistant writes only reports actions the code actually took, and it may mention only papers from that list.

### The idea test pipeline

"Test this idea" in the idea editor runs seven stages in order. Stages run through three model roles set in Settings: the **planner** (small structured decisions), the **writer** (long prose) and the **simulation** model (played board members and buyers). Writer defaults to planner, and simulation defaults to writer, so one local model is enough to start.

```mermaid
flowchart LR
  G[grill] --> B[board] --> C[competitors] --> P[panel] --> R[pricing] --> M[marketing] --> X[experiment]
  G -. "dealbreaker: park or continue" .-> G
  B -. "all three vote PASS" .-> S((stop))
  P -. "target buy rate under 20%" .-> S
  R -. "numbers do not work" .-> S
```

| Stage | Role | What it does | What it writes | Gate |
| --- | --- | --- | --- | --- |
| **grill** | writer | Up to 3 rounds. Each round asks at most 5 questions that follow a design tree of decisions, each with a recommended answer. The job waits for your answers. | A discussion thread, no entries | A model can flag a dealbreaker. You can **park** the idea (its stage becomes *parked*) or answer anyway. Resuming past a parked idea needs an explicit override, which restores the previous stage. |
| **board** | simulation | Three lenses (offers, monopoly, product) each score the idea out of 10 and vote, then a chair summarises agreement, disagreement and the one thing to test. | One note, "Board memo (simulated)" | Stops if all three vote PASS. |
| **competitors** | writer | A scout lists up to 8 direct, indirect and substitute competitors and the visible gap, as structured JSON. | One competitor entry per name, titled "(unconfirmed)", with no pricing or sources | None. These are guesses from the model's memory. Add a source and a date to confirm one. |
| **panel** | simulation | Drafts a customer profile and waits for you to approve it. Then deals 20 buyers (100 on request) across the profile's income, age, behaviour and objection mix, seeded by the idea id so reruns are stable. Buyers answer in batches (4 per call, 10 for 100) and any missing answers are retried once. | One note with the yes-rate overall and by segment, top reasons to pass, what would flip a no, and each buyer's four price answers | Stops if the buy rate in the largest target segment is under 20%. If fewer than half the buyers answered, the result is marked inconclusive instead of gating. Needs "What it is" and "Who it is for" on the idea. |
| **pricing** | none (arithmetic) | Van Westendorp price range from the panel's four price answers, set against competitor prices you confirmed with a source, then business math at the simulated price and at your own price. | One note, "Pricing (simulated)". Your price fields are never changed. | Stops if contribution per sale is zero or negative, or break-even exceeds capacity. |
| **marketing** | writer | Three positioning options, two or three channels, ten hooks that each answer one panel objection, a budget split and the cheapest real test with its success line written first. | One note, "Marketing plan (simulated)" | None |
| **experiment** | planner | Turns that cheapest real test into a draft experiment: hypothesis, plan, success criteria. | One experiment entry. Results and decision stay empty for you to fill. | None |

The panel is deliberately labelled as a limit, not a result. Every buyer is the same model, so they share its biases. The note says the yes-rate is an upper bound and not evidence of demand.

**Gates and overrides.** A gate stops the job and shows its reason. To continue you override that gate explicitly, or change the idea and start again. An override is remembered for that exact stage input.

**Call cap.** A test job is limited to 25 model calls. At the cap the job stops with a note, and **Resume** grants another 25.

**Stage cache.** Each stage's input is hashed from the stage name, the model, your idea's title, notes and fields, the outputs of every earlier stage, and stage-specific inputs (panel size, confirmed competitor prices, the approved profile). If a later job on the same idea has a finished stage with the same hash and the entries it wrote still exist, the stage is reused for zero calls. Change a field and that stage and everything after it rerun.

**waiting_user, cancel, resume and restart.** The job parks in `waiting_user` when it needs you: grill answers, profile approval, or missing idea fields. **Cancel** aborts the current call. If Spark stops mid-run, finished stages are kept. On the next start, interrupted jobs are marked *stopped*, and a stage that was running goes back to pending, so **Resume** continues from the first unfinished stage. One job runs at a time, and an idea can have only one active test. A test can be scheduled for off-peak hours (see below).

### The research pipeline

Research is a separate job for an idea, for literature work. It is built around the idea that a paper you cite must actually exist.

| Stage | Role | What it does | Gate |
| --- | --- | --- | --- |
| **frame** | writer | Drafts a research question, contribution, method and population from the idea. You edit them and may list papers you already know. One optional follow-up round asks up to 3 questions if the frame is too vague to search. | Waits for you. Writes a "Research frame" note. |
| **search** | writer | Proposes 3 to 5 queries from broad to narrow, and you edit and approve them. Each query runs against paper sources. Then one snowball step follows references and citations (depth 1) from up to 5 seed papers: DOIs from your frame first, then the most corroborated hits. | Waits for query approval. Stops adding at 60 candidates from queries and 80 in total, and says so. |
| **screen** | local decision engine | Scores each candidate 0 to 3 for relevance from title and abstract, using the same logprob method, and records an embedding similarity alongside. Without the engine, the simulation model rates batches of 10. | These are suggestions only. You mark each paper include, exclude or maybe and press Done. |
| **map** | writer | Themes, a timeline from metadata and model-suggested gaps, using the 30 best included papers. | Needs at least one included paper. |
| **differ** | writer | Compares your frame with up to 5 papers on question, method, population, data, evaluation and limitations. Each row states its evidence level: metadata, abstract or full text. It then runs up to 3 follow-up queries to test each claimed difference and flags hits that may undercut your novelty. | Needs at least one included paper. |
| **next** | writer | Drafts one next study (replicate, extend or competing explanation) as an experiment entry with empty results. | None |

**Verified papers.** A paper becomes a candidate only if it is verified.

- Search asks OpenAlex first, and adds Crossref and arXiv when OpenAlex is down or returns fewer results than asked for.
- Results are merged by DOI, arXiv id and normalised title.
- A paper with a DOI is kept if Crossref returned it, or if Crossref's record for that DOI has a matching title. A paper without a verifiable DOI is kept only if arXiv returned it. Everything else is dropped and counted as "unverified dropped".
- Titles, authors and years come from the source record, never from a model.

**Quote validator.** Models cannot put words in a paper's mouth. Any quoted sentence in a map or differ note must appear verbatim in the paper's stored abstract, or it is replaced with `[quote removed: not found in a stored abstract]`. The cite check, which sorts included papers into *supports* and *challenges* for a claim you type, shows a quote only if it is an exact abstract match, and otherwise says "No verifiable quote; read the abstract."

**BibTeX and the search log.** `references.bib` is generated from the verified, included papers only, with escaped fields and unique keys. Every query, snowball step and follow-up is written to a search log with the sources tried, hits, verified and dropped counts, and a timestamp. Every output ends with a reminder that a limited search shows what it found, not that nothing else exists. A research job starts with a cap of up to 30 model calls (you can lower it), and Resume adds 30 more.

### Model routing and cost

```text
role (planner / writer / simulation)
  -> private entry?          -> run on the local model
  -> needs structured JSON?  -> run on the local model
  -> cloud model, no price?  -> run on the local model
  -> would pass the budget?  -> run on the local model
  -> otherwise               -> the chosen model, cost recorded
```

Every call goes through `cost.cjs` before it reaches a provider (`providers.cjs`).

- **Local by default.** The planner, the decision engine and anything needing structured output run on your own Ollama. Models whose names end in `:cloud` or `-cloud`, or any non-local provider, count as cloud.
- **Cloud only for heavy writing.** A cloud model is used for prose when it has a price, the budget allows it, and the entry is not private. Structured-JSON calls always stay local. The default price table covers Ollama Cloud models (DeepSeek V4.1 Flash and V4 Pro, Kimi K3, GLM 5.3, gpt-oss 120b) in dollars per million tokens, and you can edit it. A cloud model with no entry in the table runs locally instead, so an unpriced model can never spend money.
- **Ledger.** Each call writes a usage row (model, tokens, cost, off-peak flag, whether the token counts were estimated). **Settings** shows the month's spend by model, by feature and by run, and each Test and Research button shows an estimate based on your past runs.
- **Budget cap.** The monthly budget defaults to $5. Before each cloud call Spark adds the call's estimate to month-to-date spend, including calls in flight. If that would pass the cap, the call runs locally instead and the run records why.
- **Off-peak.** Cloud prices for some models are halved off-peak. Spark treats weekends and 18:00 to 12:00 UTC on weekdays as off-peak. A test or research run can be scheduled to wait for the next off-peak window, and a scheduled job survives a restart.

Measured on real runs with DeepSeek V4.1 Flash as the writer at off-peak prices:

| Job | Cost |
| --- | --- |
| One capture | about $0.00025 |
| One idea test, up to the panel gate | about $0.003 |
| One research run | about $0.00006 |
| A heavy month | about $0.35 |

Peak prices are twice those. In the same measurement, the local `gemma4:e4b` model handled 95 of 137 calls, which is why the totals stay small. Your numbers will vary with models and prices. The budget cap and the ledger exist so they cannot surprise you.

#### Private entries and fail-closed rules

Mark an entry **Private** and nothing about it leaves the computer. A job also counts as private if the idea is linked to a private entry.

- All model calls for it run on a local model, even if a cloud model is chosen.
- Paper search is skipped for a private capture, and a private idea's research job refuses outbound requests (paper search, snowball, DOI lookups and full-text fetches).
- A non-private capture's workspace index never includes private entries, and discussions that include one are marked local-only.

Where a check cannot be answered safely, Spark stops or falls back to local instead of guessing: no price means local, an exhausted budget means local, and if no truly local model exists the job fails with an error instead of using the cloud. A local endpoint that is not Ollama at `127.0.0.1:11434` is treated as a cloud route unless you mark it local and private in Settings, because a gateway can forward to the cloud. The decision engine refuses non-loopback addresses and cloud model names.

### The founder bridge

Idea testing can also run in Claude Code. **Export** writes the idea and the approved customer profile to a folder under your data directory (`founder/<idea-slug>/`) and shows the exact commands to run: `/founder-board`, `/founder-competitors`, `/founder-consumer --quick`, `/founder-pricing` and `/founder-marketing`. Spark never starts Claude Code. You run the skills yourself in a terminal, and when they finish, **Import** reads the files they wrote (up to 30 Markdown files of at most 500 KB each, plus the panel results file) and adds each as a simulated, unreviewed note, skipping files it has already imported. The same review and evidence rules apply.

## Phone and voice

### Pair a phone

Phones need an HTTPS gateway with a certificate you supply. The phone must reach the gateway address on your private LAN or VPN, and it must trust the certificate. Keep the private key outside the repository.

```powershell
$env:SPARK_PHONE_BIND = '192.168.1.40'
$env:SPARK_PHONE_ORIGIN = 'https://spark.example.internal:4443'
$env:SPARK_PHONE_CERT = 'C:\certs\spark-chain.pem'
$env:SPARK_PHONE_KEY = 'C:\certs\spark-private.pem'
node phone.cjs serve
```

In a second terminal, run `node phone.cjs pair`. Open the HTTPS origin on the phone and enter the one-use code within ten minutes. A paired device has access for 30 days. Use `node phone.cjs devices` to list paired devices and `node phone.cjs revoke DEVICE_ID` to revoke one. Keep both processes running. Spark does not configure DNS, install certificates, or open firewall ports.

### Dictation and voice notes

Press **Record** on the home page and allow microphone access. Each recording is limited to about 5 MB and stops automatically at that size. The audio is saved to your computer first, then transcribed. The transcript becomes the body of a new inbox entry, and its first eight words become the title. For longer work, **Capture → Save entry and record** records into an entry you are editing, and you can import an audio file there. Recordings can be replayed or transcribed again from the entry.

Transcription settings are global and live in **Settings → Voice transcription**:

- **Local (default):** an OpenAI-compatible speech-to-text server on loopback. The default base URL is `http://127.0.0.1:8000/v1` with model `deepdml/faster-whisper-large-v3-turbo-ct2`.
- **Groq:** Groq's speech-to-text API, which has a free tier. Requires a Groq API key (`GROQ_API_KEY` or Settings) and your consent before audio is sent.
- **OpenAI:** requires an OpenAI API key and your consent before audio is sent.
- **Cloud fallback (optional):** if local transcription fails, Spark can retry with Groq or OpenAI. It only does so when fallback is on and that service has consent and a key.

Audio is sent to a cloud service only for the target you chose and only after you confirm. Review the transcript before relying on it.

### Local transcription

The default local target is [Speaches](https://github.com/speaches-ai/speaches), an OpenAI-compatible server built on faster-whisper. This is the setup used for the default settings above, with an NVIDIA GPU:

```sh
docker run -d --name spark-whisper --restart unless-stopped --gpus all -p 127.0.0.1:8000:8000 -v spark-whisper-cache:/home/ubuntu/.cache/huggingface ghcr.io/speaches-ai/speaches:latest-cuda
curl -X POST http://127.0.0.1:8000/v1/models/deepdml/faster-whisper-large-v3-turbo-ct2
```

The `curl` call downloads the model into the container's cache. Run it once. Later, `Start Spark.cmd` starts the existing `spark-whisper` container when Docker is available.

Without an NVIDIA GPU, use the CPU image and remove `--gpus all`: `ghcr.io/speaches-ai/speaches:latest-cpu`. Transcription is slower on CPU. If you have no suitable hardware, choose **Groq** in Voice transcription settings instead.

## Providers and privacy

| Provider           | Adapter                                  | Credential                                             |
| ------------------ | ---------------------------------------- | ------------------------------------------------------ |
| OpenAI             | Responses API, streaming, `store: false` | `OPENAI_API_KEY` or Settings                           |
| Anthropic / Claude | Messages API, streaming                  | `ANTHROPIC_API_KEY` or Settings                        |
| Google / Gemini    | `streamGenerateContent`, SSE             | `GEMINI_API_KEY` or Settings                           |
| Local              | OpenAI-compatible chat completions       | Optional `LOCAL_API_KEY`; `LOCAL_BASE_URL` or Settings |

Ollama's usual base URL is `http://127.0.0.1:11434/v1`, and Spark uses it by default. LM Studio usually serves `http://127.0.0.1:1234/v1`. OmniRoute and other OpenAI-compatible routers on this machine work by setting the base URL, for example `http://127.0.0.1:20128/v1`. Start the local server first. Spark does not install models or start these applications.

Paper search uses [OpenAlex](https://openalex.org) without a key, and falls back to Crossref and arXiv, which also need none. An optional OpenAlex API key can be set as `OPENALEX_API_KEY` or in Settings. Cloud pricing, the monthly budget and Private entries are covered in [Model routing and cost](#model-routing-and-cost).

After saving a provider in Settings, select **Check connection / models**. Model lists can include models that do not support text chat, so choose a compatible one.

Privacy principles:

- **Keys stay on your machine.** Environment variables take precedence over Settings. Keys entered in Settings are written as plain text to `data/secrets.json`, which is git-ignored. Settings endpoints never return keys, and backups never include them. `.env` files are not loaded automatically.
- **Local-only mode** prevents Spark from selecting cloud providers. The local adapter accepts only loopback URLs and refuses redirects. A local server can still route requests to a cloud model, so use a genuinely local model if you need offline inference.
- **Cloud providers receive the context you select**, under their own data policies. The `store: false` setting for OpenAI does not guarantee zero retention.

## Discussions

1. Configure a provider in Settings and run **Check connection / models**.
2. Open **Discussions → New discussion → Participants & context**.
3. Give each participant a role, a provider, and an exact model ID. Model IDs can come from discovery or be typed in. If a local server is running, new local participants are filled with its first model automatically.
4. Select the entries to include as context and preview them before sending.
5. Choose a mode and send a message. Configuration is saved before each send.

Modes:

- **Solo:** the first participant replies. Change its provider or model to switch models and keep the history.
- **Roundtable:** participants answer the same input at the same time. First-round replies cannot see each other.
- **Team:** one to three rounds. Each later round receives the previous round for critique. Up to six participants.
- **Send to:** address one participant without changing the saved team.
- **Summarize discussion:** a chosen participant writes a synthesis. It is a model suggestion, not a verified consensus.

Roles are independent of models: Explorer, Problem investigator, Skeptic, Builder, Business analyst, and Moderator. Each accepts custom instructions. **Reuse team** copies a setup into a new discussion without its messages.

Responses stream with their provider, model, and role. **Stop** cancels a run and keeps partial replies. A failed or cancelled reply can be retried alone. **Inspect sent context** shows the exact text sent for a reply.

Limits: each request allows 4,096 output tokens and each run times out after five minutes. Retries are never automatic. Usage is shown when the provider reports it. Cloud calls count against the monthly budget in Settings (see [Model routing and cost](#model-routing-and-cost)), and cancelling cannot undo charges for tokens already generated.

## Context and limits

- The latest 24 discussion messages are sent. Older messages stay saved and searchable. Oversized context is rejected with an error rather than truncated silently.
- Text attachments (`.txt`, `.md`, `.csv`, `.json`, `.log`) are included up to 20,000 characters per file and 60,000 characters per request. Truncation is marked in the inspected context.
- Images, PDFs, and other binary files are stored and downloadable but are not sent to models.
- Chat is text-only. Models have no web browsing, shell, or action tools, so they cannot verify market claims.
- Responses render as plain text. Model HTML does not execute, and some Markdown syntax appears literally.

## Data

### Where your data lives

Your workspace lives outside the repository, in `%LOCALAPPDATA%\Spark` on Windows, `~/Library/Application Support/Spark` on macOS, and `~/.local/share/spark` (or `$XDG_DATA_HOME/spark`) elsewhere. This keeps the database and provider keys out of synced folders such as OneDrive. Set `SPARK_DATA_DIR` to use another folder. The startup message shows the active location. If a workspace from an older version is found in `data/` inside the repository, Spark copies it once to the new location and leaves a `MOVED.txt` file in the old folder. Check the copy, then delete the old folder.

The data folder contains:

```text
spark.sqlite             Entries, sessions, messages, attachment metadata
attachments/             Content-addressed file bytes
backups/                 Latest 20 JSON recovery snapshots
voice-settings.json      Transcription target, endpoints, and consent flags
secrets.json             Optional provider keys (never backed up)
assistant-settings.json  Assistant models, decision threshold and calibration
cost-settings.json       Monthly budget and price table
founder/                 Folders exported for Claude Code
```

Backups are created after saved changes and around imports. They contain records, conversations, and attachment bytes. An automatic backup on the same disk does not protect against losing the computer, so use **Settings → Export workspace** to copy one elsewhere.

Imports are validated before any data changes. **Merge** overwrites records with matching IDs. **Replace** moves existing records to trash, creates a recovery snapshot first, and applies the backup. Interrupted replies are marked cancelled on restart, with their partial output kept.

## Project layout

- `server.cjs`: HTTP server, API routes, static files, origin and host checks.
- `store.cjs`: SQLite storage, validation, soft delete, backups, import and export.
- `providers.cjs`: provider adapters, streaming, and role prompts.
- `attachments.cjs`: attachment storage and size limits.
- `voice.cjs`: transcription requests to local or OpenAI endpoints.
- `papers.cjs`: paper search across OpenAlex, Crossref and arXiv, DOI verification and snowballing.
- `assistant.cjs`: the capture assistant: planner, review queue, Undo.
- `decide.cjs`: local decision engine (logprob answers, embeddings, calibration). `decide-eval.cjs` measures it.
- `pipeline.cjs`: the idea test job runner: stages, gates, cache, resume. `panel.cjs` deals the simulated buyers and computes Van Westendorp ranges.
- `research.cjs`: the research pipeline, quote validator and BibTeX.
- `cost.cjs`: price table, usage ledger, budget cap and off-peak scheduling.
- `founder.cjs`: export to and import from Claude Code.
- `data-dir.cjs`: where the workspace lives.
- `phone.cjs`: HTTPS gateway for paired phones and the device CLI.
- `dist/index.html`: the single-page app shell.
- `dist/assets/app.js`: main interface: views, editors, discussions, brief.
- `dist/assets/business-math.js`: business math calculations.
- `dist/assets/voice.js`: recording, import, and transcription UI.
- `dist/assets/phone-nav.js`: search shortcut for phone layouts.
- `dist/assets/style.css`: styles, using the tokens in DESIGN.md.
- `dist/assets/fonts/`: self-hosted fonts. Their OFL licenses are in `licenses/`.
- `*-test.cjs`: tests, run by `npm test`.
- `Start Spark.cmd`: Windows launcher.
- `DESIGN.md`: design direction, palette, type, and motion.

## Tests

```powershell
npm test
```

The suite checks the JavaScript syntax of the server, store, and frontend, then runs tests against real local HTTP endpoints, SQLite restart durability, validation, soft deletion, attachment backups, origin and host checks, streaming provider protocols, parallel isolation, team rounds, retries, cancellation, and safe rendering. Provider tests use local mock servers, so they spend no credits and do not verify live models. Visual checks in a browser are still manual.

## Design

See [DESIGN.md](DESIGN.md) for the palette, type scale, spacing, motion rules, and the reasons behind them.

## Contributing

Issues and pull requests are welcome. Run `npm test` before opening a pull request, and keep changes small and focused. The project has no runtime dependencies, so please avoid adding one unless it earns its place.

## Credits

- Founder review presets are adapted from [founder-skill](https://github.com/Jakeschincariol/founder-skill) by Jake Schincariol, MIT licensed.
- Typefaces are Nunito and DM Mono, self-hosted under the SIL Open Font License 1.1. License texts are in `licenses/`.
- Paper search uses the [OpenAlex](https://openalex.org), [Crossref](https://www.crossref.org) and [arXiv](https://arxiv.org) APIs.
- Protocol references: [OpenAI streaming](https://developers.openai.com/api/docs/guides/migrate-to-responses#7-update-streaming-consumers), [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [Gemini content generation](https://ai.google.dev/api/generate-content), [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).

## License

MIT — see [LICENSE](LICENSE). Founder review presets are adapted from founder-skill by Jake Schincariol (MIT).
