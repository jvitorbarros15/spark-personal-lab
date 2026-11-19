"use strict";
const fs = require("node:fs"), path = require("node:path");
const { fail } = require("./store.cjs");
const audioTypes = { ".webm": "audio/webm", ".mp3": "audio/mpeg", ".mp4": "audio/mp4", ".m4a": "audio/mp4", ".mpeg": "audio/mpeg", ".mpga": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac" };
function endpoint(base) {
  let u;
  try { u = new URL(base); } catch { fail("Enter a valid loopback transcription URL."); }
  if (!["http:", "https:"].includes(u.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) || u.username || u.password || u.search || u.hash)
    fail("Local transcription URL must use localhost, 127.0.0.1, or ::1 without credentials, query, or fragment.");
  return u.href.replace(/\/$/, "") + "/audio/transcriptions";
}
function createVoice({ directory, store, providers, fetchImpl = fetch }) {
  async function transcribe(data) {
    if (!data || typeof data.attachmentId !== "string" || typeof data.recordId !== "string") fail("Choose a saved audio attachment.");
    const row = store.db.prepare("SELECT json FROM attachments WHERE id=?").get(data.attachmentId);
    const item = row && JSON.parse(row.json), record = store.get("records", data.recordId);
    if (!item || item.deleted || item.recordId !== data.recordId || !record || record.deleted) fail("Audio attachment not found.", 404);
    const type = audioTypes[path.extname(item.name).toLowerCase()];
    if (!type || !/^[a-f0-9]{64}$/.test(item.hash)) fail("Unsupported audio file type.");
    const model = typeof data.model === "string" ? data.model.trim() : "";
    if (!model || model.length > 200) fail("Enter a transcription model.");
    let url, key;
    if (data.target === "local") {
      url = endpoint(data.base);
      const local = providers.config("local");
      if (local.base && url === local.base.replace(/\/$/, "") + "/audio/transcriptions") key = local.key;
    }
    else if (data.target === "openai" && data.cloudConsent === true) { url = "https://api.openai.com/v1/audio/transcriptions"; key = providers.config("openai").key; if (!key) fail("Configure an OpenAI API key in Settings first."); }
    else fail("Choose a local endpoint or explicitly opt in to OpenAI cloud transcription.");
    const bytes = fs.readFileSync(path.join(directory, "attachments", item.hash));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), item.name);
    form.append("model", model);
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    let response;
    try { response = await fetchImpl(url, { method: "POST", headers, body: form, redirect: "error", signal: AbortSignal.timeout(120000) }); }
    catch { fail("Transcription service could not be reached. Your audio remains saved.", 502); }
    if (!response.ok) fail(`Transcription service returned HTTP ${response.status}. Your audio remains saved.`, 502);
    let result;
    try { result = await response.json(); } catch { fail("Transcription service returned invalid JSON.", 502); }
    if (typeof result.text !== "string" || result.text.length > 100000) fail("Transcription service returned an invalid transcript.", 502);
    return { text: result.text };
  }
  return { transcribe };
}
module.exports = { createVoice, endpoint };
