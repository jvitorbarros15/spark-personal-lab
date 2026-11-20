# Family access

Give family members their own private Spark, reachable from their phones and computers, while everything runs on your PC and uses your local models. Hosting is free: each person gets a Cloudflare quick tunnel (`https://<random-words>.trycloudflare.com`).

How it works:

- One Spark process per person, each with its own data folder (`<data folder>\people\<name>`) and its own port. Notebooks are separated by process, not by code.
- Every instance listens on `127.0.0.1` only. `cloudflared` is the only thing that reaches it from outside.
- Anyone arriving through the tunnel must be paired first. Your own Spark on port 4173 is unchanged and needs no login.

## 1. Install cloudflared

Once, in a terminal:

```
winget install --id Cloudflare.cloudflared
```

Close and reopen the terminal, then check `cloudflared --version`. Spark never downloads it for you. Without it, Start Family still runs, but only on your computer (no tunnels).

## 2. Add people

In your Spark open **Settings, Family** and choose **Add a person**, or edit `family.json` in your data folder (`%LOCALAPPDATA%\Spark` by default):

```json
[
  { "name": "Ana", "port": 4201, "language": "pt-BR", "budgetUsd": 1, "localOnly": false },
  { "name": "Bia", "port": 4202, "language": "pt-BR", "budgetUsd": 1, "localOnly": true }
]
```

- `name`: shown in the app. The data folder is the name in lowercase letters, digits and dashes.
- `port`: unique, 1024 to 65535, not 4173.
- `language`: stored for the upcoming Portuguese interface. Today it only sets the language of the pairing page.
- `budgetUsd`: monthly cap for cloud models for this person (default 1). Over the cap, Spark uses the local model instead.
- `localOnly`: `true` turns cloud models off for this person.

## 3. Start Family

Double-click `Start Family.cmd` (or run `node family.cjs`). Keep the window open while family members use Spark. It starts each person's Spark and tunnel, restarts anything that crashes (waiting 1 s, 2 s, 4 s, up to 30 s), writes the current addresses to `family-status.json` and prints each address with a pairing link.

Quick tunnel addresses change every time a tunnel restarts, so after a restart (or after rebooting) the old addresses and pairing links stop working. The launcher prints fresh links each time, and **Settings, Family** shows them too.

## 4. Send pairing links

In **Settings, Family**, press **New pairing link** (or **Copy link**) next to a person and send it to them, for example on WhatsApp. The link works once and expires after 24 hours. When they open it they press the button on the pairing page, and their device is paired for 30 days. If a link is used by someone else first, create a new one and use **Revoke devices** to sign everyone out.

After a tunnel address change each person needs a new link, because their old login belongs to the old address.

## What each person gets

- A separate notebook, models and settings. They cannot see yours or each other's.
- The text "this computer" in the app reads "Stored on <your name>'s computer", because that is where their notes live. You, the owner, can read them.
- Their own monthly budget for cloud models, and an optional local-only mode.
- Voice transcription always uses your local Whisper, never a cloud service.

## Sharing the GPU

All instances share your Ollama and Whisper. Spark lets one model call run at a time across all family instances (a small first-come, first-served queue kept in `gpu-queue` in your data folder). Someone who asks while another call is running sees "Busy, your request is queued" until it is their turn. A call from your own Spark on 4173 is not in the queue unless you start it with the same `SPARK_GPU_QUEUE` folder.

## Settings reference

For running one instance by hand, `server.cjs` reads these environment variables. Without them it behaves exactly as before.

| Variable | Meaning |
| --- | --- |
| `SPARK_PORT` | Port to listen on (default 4173). Also `--port`. |
| `SPARK_PUBLIC_HOST` | The tunnel hostname. Added to the Host and Origin allow-list. Requests on this host need a pairing login. |
| `SPARK_FAMILY_NAME`, `SPARK_OWNER_NAME`, `SPARK_LANGUAGE`, `SPARK_BUDGET_USD`, `SPARK_LOCAL_ONLY`, `SPARK_GPU_QUEUE` | Turn the instance into a family instance. |

## Troubleshooting

- **"cloudflared is not installed"**: run `winget install --id Cloudflare.cloudflared`, then Start Family again.
- **No address, or "stopped" in Settings, Family**: Start Family is not running, or the last status is older than 45 seconds. Keep its window open.
- **Pairing link says invalid or expired**: it was used, is older than 24 hours, or the address changed. Make a new one.
- **"Too many attempts"**: five wrong codes in ten minutes lock pairing for that person for a while. Wait and use a fresh link.
- **Port in use**: pick another port for that person, or close the other program using it.
- **Quick tunnel will not start**: Cloudflare may be limiting quick tunnels or your network blocks it. Wait a minute; the launcher keeps retrying.
- **Asked to pair again**: the address changed since last time, or you revoked the device.
- **Your computer is off or Start Family is closed**: family members see a Cloudflare error page until you start it again.
