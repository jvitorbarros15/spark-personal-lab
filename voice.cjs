"use strict";
const fs = require("node:fs"), path = require("node:path");
const { fail } = require("./store.cjs");
const { readJson, writeJson } = require("./json-file.cjs");
const audioTypes = { ".webm": "audio/webm", ".mp3": "audio/mpeg", ".mp4": "audio/mp4", ".m4a": "audio/mp4", ".mpeg": "audio/mpeg", ".mpga": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac" };
function endpoint(base) {
  let u;
  try { u = new URL(base); } catch { fail("Enter a valid loopback transcription URL."); }
  if (!["http:", "https:"].includes(u.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) || u.username || u.password || u.search || u.hash)
    fail("Local transcription URL must use localhost, 127.0.0.1, or ::1 without credentials, query, or fragment.");
  return u.href.replace(/\/$/, "") + "/audio/transcriptions";
}
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions", OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULTS = { target: "local", localBase: "http://127.0.0.1:8000/v1", localModel: "deepdml/faster-whisper-large-v3-turbo-ct2", groqModel: "whisper-large-v3-turbo", openaiModel: "whisper-1", groqConsent: false, openaiConsent: false, fallback: false, fallbackTarget: "groq" };
const PREVIEW_LIMIT = 5 * 1024 * 1024;
const text = (v, max, label) => { if (typeof v !== "string" || !v.trim() || v.trim().length > max) fail(`Enter a ${label}.`); return v.trim(); };
function createVoice({ directory, store, providers, isPrivate = () => false, fetchImpl = fetch }) {
  const file = path.join(directory, "voice-settings.json");
  let saved = readJson(file, "Cannot read voice-settings.json. Fix the JSON before starting Spark.");
  const settings = () => ({ ...DEFAULTS, ...saved });
  function status() {
    const groq = providers.groq();
    return { ...settings(), groqKeyConfigured: !!groq.key, groqKeySource: groq.source, openaiKeyConfigured: !!providers.config("openai").key };
  }
  function update(data) {
    if (!data || typeof data !== "object") fail("Invalid transcription settings.");
    const next = settings();
    if (data.target !== undefined) { if (!["local", "groq", "openai"].includes(data.target)) fail("Choose a transcription target."); next.target = data.target; }
    if (data.localBase !== undefined) { next.localBase = text(data.localBase, 300, "local transcription URL"); endpoint(next.localBase); }
    for (const k of ["localModel", "groqModel", "openaiModel"]) if (data[k] !== undefined) next[k] = text(data[k], 200, "transcription model");
    for (const k of ["groqConsent", "openaiConsent", "fallback"]) if (data[k] !== undefined) { if (typeof data[k] !== "boolean") fail("Invalid transcription settings."); next[k] = data[k]; }
    if (data.fallbackTarget !== undefined) { if (!["groq", "openai"].includes(data.fallbackTarget)) fail("Choose a cloud fallback."); next.fallbackTarget = data.fallbackTarget; }
    if (data.groqKey !== undefined) providers.setGroqKey(data.groqKey);
    if (next.fallback) { try { route(next.fallbackTarget, next); } catch { fail("Cloud fallback needs consent and an API key for the chosen service."); } }
    writeJson(file, next);
    saved = next;
    return status();
  }
  function route(target, s) {
    if (target === "local") {
      const url = endpoint(s.localBase), local = providers.config("local");
      return { url, model: s.localModel, key: local.base && url === local.base.replace(/\/$/, "") + "/audio/transcriptions" ? local.key : "" };
    }
    if (target === "groq") {
      if (!s.groqConsent) fail("Allow sending audio to Groq in Settings first.");
      const key = providers.groq().key;
      if (!key) fail("Add a Groq API key in Settings first.");
      return { url: GROQ_URL, model: s.groqModel, key };
    }
    if (!s.openaiConsent) fail("Allow sending audio to OpenAI in Settings first.");
    const key = providers.config("openai").key;
    if (!key) fail("Configure an OpenAI API key in Settings first.");
    return { url: OPENAI_URL, model: s.openaiModel, key };
  }
  async function send({ url, model, key }, bytes, type, name, timeout = 120000) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);
    form.append("model", model);
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    let response;
    try { response = await fetchImpl(url, { method: "POST", headers, body: form, redirect: "error", signal: AbortSignal.timeout(timeout) }); }
    catch { fail("Transcription service could not be reached. Your audio remains saved.", 502); }
    if (!response.ok) fail(`Transcription service returned HTTP ${response.status}. Your audio remains saved.`, 502);
    let result;
    try { result = await response.json(); } catch { fail("Transcription service returned invalid JSON.", 502); }
    if (typeof result.text !== "string" || result.text.length > 100000) fail("Transcription service returned an invalid transcript.", 502);
    return { text: result.text };
  }
  async function transcribe(data) {
    if (!data || typeof data.attachmentId !== "string" || typeof data.recordId !== "string") fail("Choose a saved audio attachment.");
    const row = store.db.prepare("SELECT json FROM attachments WHERE id=?").get(data.attachmentId);
    const item = row && JSON.parse(row.json), record = store.get("records", data.recordId);
    if (!item || item.deleted || item.recordId !== data.recordId || !record || record.deleted) fail("Audio attachment not found.", 404);
    const type = audioTypes[path.extname(item.name).toLowerCase()];
    if (!type || !/^[a-f0-9]{64}$/.test(item.hash)) fail("Unsupported audio file type.");
    const s = settings(), priv = isPrivate(record), primary = route(priv ? "local" : s.target, s);
    const bytes = fs.readFileSync(path.join(directory, "attachments", item.hash));
    try { return await send(primary, bytes, type, item.name); }
    catch (e) {
      if (priv) fail("This entry is private, so its audio is only transcribed on this computer, and local transcription is not available right now. Start the local server and try again.", 409);
      if (s.target !== "local" || !s.fallback) throw e;
      let cloud;
      try { cloud = route(s.fallbackTarget, s); } catch { throw e; }
      return send(cloud, bytes, type, item.name);
    }
  }
  async function preview(data) {
    if (!data || typeof data.contentBase64 !== "string" || typeof data.mimeType !== "string") fail("Send audio and its type.");
    if (settings().target !== "local") fail("Live preview needs local transcription.", 409);
    const type = data.mimeType.split(";")[0].trim().toLowerCase(), ext = Object.keys(audioTypes).find((k) => audioTypes[k] === type);
    if (!ext) fail("Unsupported audio file type.");
    if (data.contentBase64.length > PREVIEW_LIMIT * 4 / 3 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.contentBase64)) fail("Preview audio is too large or invalid.", 413);
    const bytes = Buffer.from(data.contentBase64, "base64");
    if (!bytes.length || bytes.length > PREVIEW_LIMIT) fail("Preview audio is too large or invalid.", 413);
    return send(route("local", settings()), bytes, type, "preview" + ext, 20000);
  }
  return { transcribe, preview, settings: status, update };
}
module.exports = { createVoice, endpoint };
