# Spark

A local personal workbench for capturing thoughts, exploring problems, developing ideas, and testing assumptions. It starts empty. No sample projects, fake research, generated metrics, or simulated AI replies.

To research an idea, save it and reopen its editor. Edit the research query, open the external search, then use **Add competitor** to record what you found. Include the source link, pricing units and date checked. Reopen the idea to compare linked competitors. This workflow works without a provider key; search results are reviewed and entered by you.

## Run

Requires **Node.js 22.13 or newer** (Node 24+ recommended). There are no npm dependencies or build step.

```powershell
git clone https://github.com/jvitorbarros15/spark-personal-lab.git
cd spark-personal-lab
npm start
```

On Windows, double-click **Start Spark.cmd**. It starts the server and opens your default browser at **http://127.0.0.1:4173**. Keep its terminal open; Ctrl+C stops it. `node server.cjs` starts without opening the browser. Some Node versions print an experimental warning for built-in SQLite.

The desktop server binds to loopback. For paired phones use the optional HTTPS gateway below. Keep port 4173 on loopback.

## Pair a phone

Run Spark on the computer. The phone needs a route to its private LAN or VPN address, a hostname resolving to that address, and a valid TLS certificate for that hostname which the phone trusts. Supply the certificate chain and matching PEM private key yourself. Keep the key outside the repository. The following PowerShell values illustrate the setup; replace them with your own.

```powershell
$env:SPARK_PHONE_BIND = '192.168.1.40'
$env:SPARK_PHONE_ORIGIN = 'https://spark.example.internal:4443'
$env:SPARK_PHONE_CERT = 'C:\certs\spark-chain.pem'
$env:SPARK_PHONE_KEY = 'C:\certs\spark-private.pem'
node phone.cjs serve
```

In another terminal in this project run `node phone.cjs pair`. Open the configured HTTPS origin on the phone, enter the one-use code within ten minutes, then use the browser’s **Add to Home Screen** action. Pairing grants workspace access for 30 days. Use `node phone.cjs devices` and `node phone.cjs revoke DEVICE_ID` on the computer to revoke future requests. Keep the computer awake and both processes running. The gateway does not configure DNS, install certificates, or open firewall ports.

## Capture a voice note

Choose **Capture → Save entry and record** and allow microphone access. Spark supplies a dated title if you leave it blank. **Stop and save** keeps the original on your computer. You can also import audio into a saved entry. Files share the workspace attachment limits of 5 MB per file and 20 MB in total.

For local transcription, run an OpenAI-compatible speech-to-text server on your computer. Under **Transcription settings**, enter its loopback base URL and the model name it serves. Spark sends the file to the base URL followed by `/audio/transcriptions`. Alternatively, select OpenAI, configure its API key in Settings, and confirm sending the audio. Choose **Transcribe saved audio**, correct the text, add it to notes, and save the entry. Search then includes the corrected text. Reopen the entry to replay the audio or retry transcription.

## Workspace

- **Inbox:** capture a thought immediately, then turn it into an idea, problem, note, technology, or experiment.
- **Problems:** people, context, a concrete example, workarounds, evidence, and unknowns.
- **Ideas:** solution, audience, payment hypotheses, alternatives, next action, and links to other entries.
- **Experiments:** hypothesis, test plan, success criteria, target date, results, and a continue/change/stop decision.
- **Home:** real inbox entries, active work, next actions, and recently edited entries.
- **Search:** titles, notes, structured fields, and saved discussions.
- **Trash:** recover entries and discussions. Trashing an entry does not erase its attachments.
- **Attachments:** save an entry first, reopen it, and attach files. Trashed attachments can be restored inside the entry editor.

Changing an entry's type preserves its previous structured details in its notes. An AI response can become a **reviewable draft**; it is not saved as an entry until you give it a title and save it.

## Real multi-model discussions

1. Open **Settings**, configure a provider, save, and use **Check connection / models**.
2. Open **Discussions → New discussion → Participants & context**.
3. Give each participant a role, provider, and exact model ID. Model discovery supplies IDs from the provider; you can also type one. Provider lists can include models that do not support the text endpoint, so choose a compatible text model.
4. Uncheck **Local endpoint only** if you want cloud providers. Select exactly which entries to include. You can preview those entries before sending.
5. Choose a mode and send a message. Configuration changes save before sending.

### Modes

- **Solo:** the first participant replies. Change its provider/model to switch models while retaining saved conversation history.
- **Roundtable:** participants respond concurrently to the same initial conversation and selected context. First-round replies cannot see their sibling replies.
- **Team:** 1–3 rounds. Later rounds receive the previous completed round for critique. A maximum of 6 participants is supported.
- **Send to:** direct a message to one participant without changing the saved team.
- **Summarize discussion:** manually select a participant to act as moderator. Its synthesis is a model suggestion, not a verified consensus.

Roles are independent of models: Explorer, Problem investigator, Skeptic, Builder, Business analyst, and Moderator. Each supports custom instructions. **Reuse team** copies the setup into a new discussion without copying messages.

Responses stream with provider/model/role attribution. **Stop** cancels the run and preserves partial replies. Failed or cancelled responses can be retried individually using their saved original input. **Inspect sent context** shows the exact text messages sent for that response. Successful replies are not repeated when retrying a failure.

Each request has a 4,096-output-token allowance and each run a five-minute timeout. Actual usage is displayed when the provider supplies it. Cost is shown as unavailable: **there is no monetary spending cap**, and cancelling cannot undo charges for tokens already generated. No automatic retries are performed.

## Providers and credentials

| Provider           | Adapter                                  | Credential                                             |
| ------------------ | ---------------------------------------- | ------------------------------------------------------ |
| OpenAI             | Responses API, streaming, `store: false` | `OPENAI_API_KEY` or Settings                           |
| Anthropic / Claude | Messages API, streaming                  | `ANTHROPIC_API_KEY` or Settings                        |
| Google / Gemini    | `streamGenerateContent`, SSE             | `GEMINI_API_KEY` or Settings                           |
| Local              | OpenAI-compatible chat completions       | Optional `LOCAL_API_KEY`; `LOCAL_BASE_URL` or Settings |

Ollama's typical local base URL is `http://127.0.0.1:11434/v1`. LM Studio commonly uses `http://127.0.0.1:1234/v1`; start its local server and use the URL it displays. Spark does not install models or start these applications for you.

API subscriptions and keys must be configured separately; Spark cannot reuse this Codex conversation's model access. **Never commit or paste keys into source code.** Settings writes them as plain text to ignored `data/secrets.json`. Environment variables take precedence. Keys are never returned by settings endpoints or included in workspace backups. `.env` files are ignored but not automatically loaded.

The local adapter permits only loopback URLs and refuses redirects. Local-only mode prevents Spark from selecting cloud providers, but an upstream local server can itself route to a cloud model. Use a genuinely local model and that server's offline configuration if you need offline inference. Cloud providers receive selected context and conversation text under their own data policies; `store: false` is not a promise of zero provider retention.

## Context and limitations

Chat is text-only. It has no web browsing, shell execution, or external action tools, and it cannot verify market claims on its own.

- The latest 24 complete discussion messages are included. Older history remains saved and searchable but is not sent. Oversized context is rejected with a useful error rather than silently truncated further.
- Selected workspace entries include readable `.txt`, `.md`, `.csv`, `.json`, and `.log` attachments. Up to 20,000 characters per file / 60,000 attachment characters per request are included; truncation is marked in the inspected context.
- Images, PDFs, and other binary attachments are stored/downloadable but their contents are **not sent to models**. Non-UTF-8 files are also excluded with an explicit marker.
- Attachment limit: 5 MiB per file and 20 MiB total including trashed files. JSON imports are limited to 34 MB in the UI.
- Provider capability differences, model access, context limits, and rate limits can cause errors. The error is attributed to that participant and partial output is preserved.
- Responses render as safe text, so model HTML cannot execute. Some Markdown syntax may appear literally.

## Data and recovery

Everything is stored under the ignored `data/` folder:

```text
data/spark.sqlite       Entries, sessions, messages, attachment metadata
data/attachments/      Content-addressed file bytes
data/backups/          Latest 20 atomic JSON recovery snapshots
data/secrets.json      Optional provider credentials (never backed up)
```

Clearing browser data no longer deletes the workspace. Backups are created after saved changes and before/after imports. They contain records, conversations, and attachment bytes. Use **Settings → Export workspace** to copy a backup elsewhere; automatic backups on the same disk do not protect against losing the computer.

Imports validate before changing data. **Merge** overwrites matching IDs. **Replace** moves old records and discussions to trash before applying the snapshot; a pre-import recovery snapshot is created, and older unmatched conversations remain recoverable. API keys are never imported. On restart, interrupted running messages become cancelled and retain their partial output.

### Migrate from the browser-only prototype

Open Spark in the same browser and at the same origin used previously. Home/Settings offers to import your personal entries and edited examples; untouched demo entries are excluded. Migration is opt-in and leaves the old localStorage copy intact. IDs are stable so repeating migration does not create duplicates, but it can overwrite the migrated copies. A workspace previously used on the hosted URL has separate browser storage: export it there first. Prototype version-1 JSON exports can be imported via Settings.

## Development and verification

```powershell
npm test
```

Tests cover real local HTTP endpoints, SQLite restart durability, validation, soft deletion, attachment backups and privacy, origin/host checks, streaming provider protocols, parallel isolation, team rounds, targeted replies, synthesis, retry, cancellation, and safe view rendering. All provider tests use explicit local mock servers; they do not spend credits or claim live model verification. Browser visual verification still needs a manual pass on your device.

Source: `server.cjs`, `store.cjs`, `providers.cjs`, `attachments.cjs`, and `dist/` (the static frontend is source, not generated build output).

Protocol references: [OpenAI streaming](https://developers.openai.com/api/docs/guides/migrate-to-responses#7-update-streaming-consumers), [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [Gemini content generation](https://ai.google.dev/api/generate-content), [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).
