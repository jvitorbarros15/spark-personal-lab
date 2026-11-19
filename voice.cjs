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
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions", OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULTS = { target: "local", localBase: "http://127.0.0.1:8000/v1", localModel: "deepdml/faster-whisper-large-v3-turbo-ct2", groqModel: "whisper-large-v3-turbo", openaiModel: "whisper-1", groqConsent: false, openaiConsent: false, fallback: false, fallbackTarget: "groq" };
const text = (v, max, label) => { if (typeof v !== "string" || !v.trim() || v.trim().length > max) fail(`Enter a ${label}.`); return v.trim(); };
function createVoice({ directory, store, providers, fetchImpl = fetch }) {
  const file = path.join(directory, "voice-settings.json");
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { if (e.code !== "ENOENT") throw Error("Cannot read data/voice-settings.json. Fix the JSON before starting Spark."); }
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
    const temporary = file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2));
    fs.renameSync(temporary, file);
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
  async function send({ url, model, key }, bytes, type, name) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);
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
  async function transcribe(data) {
    if (!data || typeof data.attachmentId !== "string" || typeof data.recordId !== "string") fail("Choose a saved audio attachment.");
    const row = store.db.prepare("SELECT json FROM attachments WHERE id=?").get(data.attachmentId);
    const item = row && JSON.parse(row.json), record = store.get("records", data.recordId);
    if (!item || item.deleted || item.recordId !== data.recordId || !record || record.deleted) fail("Audio attachment not found.", 404);
    const type = audioTypes[path.extname(item.name).toLowerCase()];
    if (!type || !/^[a-f0-9]{64}$/.test(item.hash)) fail("Unsupported audio file type.");
    const s = settings(), primary = route(s.target, s);
    const bytes = fs.readFileSync(path.join(directory, "attachments", item.hash));
    try { return await send(primary, bytes, type, item.name); }
    catch (e) {
      if (s.target !== "local" || !s.fallback) throw e;
      let cloud;
      try { cloud = route(s.fallbackTarget, s); } catch { throw e; }
      return send(cloud, bytes, type, item.name);
    }
  }
  return { transcribe, settings: status, update };
}
module.exports = { createVoice, endpoint };
