"use strict";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const labels = {
  home: "Home",
  inbox: "Inbox",
  idea: "Ideas",
  problem: "Problems",
  experiment: "Experiments",
  note: "Notes",
  technology: "Technology",
  competitor: "Competitors",
  chat: "Discussions",
  trash: "Trash",
  settings: "Settings",
};
const types = {
  inbox: "Capture",
  idea: "Idea",
  problem: "Problem",
  experiment: "Experiment",
  note: "Note",
  technology: "Technology",
  competitor: "Competitor",
};
const stages = [
  "inbox",
  "draft",
  "exploring",
  "validating",
  "building",
  "done",
  "parked",
];
const fieldLabels = {
  inbox: {},
  note: {},
  technology: {
    useCase: "What could it make possible?",
    maturity: "Maturity / what you have verified",
    risks: "Limitations and risks",
    source: "Source links",
  },
  problem: {
    people: "Who experiences this?",
    context: "When and where does it happen?",
    example: "A specific example",
    workaround: "Current workaround",
    evidence: "Evidence and source links",
    unknowns: "What do you still need to learn?",
  },
  idea: {
    solution: "What would you create?",
    audience: "Who would use it?",
    payment: "Who might pay, and why?",
    alternatives: "Alternatives and assumptions",
    nextStep: "Next action",
    researchQueries: "Research query (edit before searching)",
    currency: "Currency",
    price: "Price per sale",
    variableCost: "Variable cost per sale",
    fixedCosts: "Fixed costs per period",
    hoursPerCustomer: "Hours per customer",
    availableHours: "Available hours per period",
  },
  competitor: {
    website: "Website",
    facts: "Product and sourced facts",
    pricing: "Pricing",
    audience: "Target audience",
    sources: "Source links (include links for claims and pricing)",
    researchedOn: "Date researched",
    gaps: "Gaps and opportunities",
  },
  experiment: {
    hypothesis: "Hypothesis",
    plan: "Test plan",
    success: "Success criteria",
    deadline: "Target date",
    results: "Results / what happened",
    decision: "Decision",
  },
};
const roles = {
  explorer: "Explorer",
  investigator: "Problem investigator",
  skeptic: "Skeptic",
  builder: "Builder",
  business: "Business analyst",
  moderator: "Moderator",
  boardOffer: "Board · Offer lens",
  boardMonopoly: "Board · Monopoly lens",
  boardProduct: "Board · Product lens",
  competitorScout: "Competitor scout",
  cfo: "CFO",
  launchLead: "Launch lead",
};
const providers = {
  openai: "OpenAI",
  anthropic: "Anthropic / Claude",
  gemini: "Google / Gemini",
  local: "Local endpoint",
};
let state = {
    records: [],
    sessions: [],
    messages: [],
    providers: [],
    voice: {},
    openAlex: { configured: false, source: "none" },
    assistant: {},
    assistantRuns: [],
    jobs: [],
    activeRuns: [],
  },
  query = "",
  stageFilter = "",
  activeRun = null,
  assistantLive = null,
  quickAssist = null,
  quickBypass = false,
  streamingSession = null,
  recordDraft = null,
  fieldDraft = {},
  editorSnapshot = "",
  toastTimer;
let quickRec = null,
  quickBusy = false,
  quickStarting = false,
  quickPreview = null;
const PREVIEW_EVERY = 2500,
  PREVIEW_MAX_MS = 90000,
  reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const QUICK_LIMIT = 5 * 1024 * 1024 - 256 * 1024;
const modelLists = {},
  promptDrafts = new Map();
const route = () => {
  const [view = "home", id = ""] = location.hash.slice(1).split("/");
  return { view: labels[view] || view === "brief" ? view : "home", id };
};
const needsReview = (r) => ["assistant", "simulation"].includes(r.origin?.by) && !r.reviewed;
const entries = () => state.records.filter((r) => !r.deleted && !needsReview(r));
const toReview = () => state.records.filter((r) => !r.deleted && needsReview(r));
const originMark = (r) =>
  r.origin?.by === "simulation"
    ? '<span class="by-simulation">Simulated</span>'
    : r.origin?.by === "assistant"
      ? '<span class="by-assistant">by assistant</span>'
      : "";
const date = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const option = (value, label, selected) =>
  `<option value="${esc(value)}"${selected === value ? " selected" : ""}>${esc(label)}</option>`;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 6000);
}
async function api(url, { method = "GET", data } = {}) {
  const res = await fetch(url, {
    method,
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) throw Error(result.error || `Request failed (${res.status}).`);
  return result;
}
async function refresh(renderNow = true) {
  state = await api("/api/state");
  $("#roadmap-link").hidden = !state.roadmap;
  if (renderNow) render();
}
function empty(title, description, action = "") {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
}
function entryRow(r) {
  return `<button class="entry-row" data-type="${esc(r.type)}" data-edit="${esc(r.id)}"><span class="entry-type">${types[r.type]}</span><span class="entry-title">${esc(r.title)}${originMark(r)}${r.fields?.nextStep ? `<small>${esc(r.fields.nextStep)}</small>` : ""}</span><span class="stage">${esc(r.stage)}</span><time>${date(r.updated)}</time></button>`;
}
function recordList(records, message = "Nothing here yet.") {
  return records.length
    ? `<div class="entry-list">${records.map(entryRow).join("")}</div>`
    : empty(message, "Capture something when you are ready.");
}
function legacyEntries() {
  try {
    const old = JSON.parse(localStorage.getItem("spark.personal-lab.v1"));
    return old?.version === 1 && Array.isArray(old.records)
      ? old.records.filter(
          (r) =>
            r.demo !== true && typeof r.title === "string" && r.title.trim(),
        )
      : [];
  } catch {
    return [];
  }
}
function micMarkup() {
  if (quickStarting) return '<span class="mic-dot"></span> Starting…';
  if (quickBusy) return '<span class="mic-dot"></span> Saving…';
  if (!quickRec) return '<span class="mic-dot idle"></span> Record';
  return `<span class="mic-meter${reducedMotion() ? " still" : ""}" aria-hidden="true"><i id="quick-level"></i></span> Stop <span id="quick-timer">${esc(quickClock())}</span>`;
}
function quickClock() {
  const s = Math.floor((Date.now() - quickRec.started) / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
function syncMic() {
  const b = $("#quick-mic");
  if (!b) return;
  b.innerHTML = micMarkup();
  b.disabled = quickBusy;
  b.classList.toggle("recording", !!quickRec);
}
function previewMarkup() {
  if (!quickPreview) return "";
  const { text, note } = quickPreview;
  return `<span class="preview-tag">Live preview</span> ${text ? `<span class="preview-text">${esc(text)}</span>` : ""}${note ? `<span class="preview-note">${esc(note)}</span>` : ""}`;
}
function syncPreview() {
  const p = $("#quick-preview");
  if (!p) return;
  p.hidden = !quickPreview;
  p.innerHTML = previewMarkup();
}
function startMeter(stream, rec) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    rec.ctx = new Ctx();
    const analyser = rec.ctx.createAnalyser(), data = new Uint8Array(1024);
    analyser.fftSize = 1024;
    rec.ctx.createMediaStreamSource(stream).connect(analyser);
    if (reducedMotion()) return;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      const bar = $("#quick-level");
      if (bar) bar.style.transform = `scaleX(${Math.min(1, peak / 64)})`;
      rec.raf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    rec.ctx = null;
  }
}
function stopMeter(rec) {
  cancelAnimationFrame(rec.raf);
  if (rec.ctx) rec.ctx.close().catch(() => {});
  rec.ctx = null;
}
async function requestPreview(rec, mime) {
  if (rec.previewing || rec.previewOff || !rec.chunks.length) return;
  if (Date.now() - rec.started > PREVIEW_MAX_MS) {
    rec.previewOff = rec.paused = true;
    quickPreview = { text: quickPreview?.text || "", note: "Live preview paused — full transcript on Stop" };
    return syncPreview();
  }
  rec.previewing = true;
  try {
    const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || mime || "audio/webm" });
    const res = await fetch("/api/voice/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: blob.type, contentBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) }),
    });
    const result = await res.json();
    if (quickRec !== rec) return;
    if (res.status === 409) {
      rec.previewOff = true;
      quickPreview = { text: "", note: "Live preview needs local transcription" };
    } else if (res.ok) quickPreview = { text: result.text.trim(), note: rec.paused ? quickPreview.note : "" };
    else return;
    syncPreview();
  } catch {
    return;
  } finally {
    rec.previewing = false;
  }
}
function focusCapture() {
  const input = $("#quick-title");
  if (input && !$("dialog[open]")) input.focus();
}
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
async function quickRecord() {
  if (quickRec) return quickRec.recorder.stop();
  if (quickBusy) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    return toast("Recording is unavailable in this browser or insecure context.");
  quickBusy = quickStarting = true;
  syncMic();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    quickBusy = quickStarting = false;
    syncMic();
    return toast("Microphone unavailable: " + e.message);
  }
  const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)),
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream),
    rec = { recorder, chunks: [], size: 0, started: Date.now(), full: false };
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    rec.chunks.push(e.data);
    rec.size += e.data.size;
    if (rec.size >= QUICK_LIMIT && recorder.state === "recording") {
      rec.full = true;
      recorder.stop();
    }
  };
  recorder.onstop = () => {
    clearInterval(rec.timer);
    clearInterval(rec.previewTimer);
    stopMeter(rec);
    quickPreview = null;
    syncPreview();
    stream.getTracks().forEach((t) => t.stop());
    quickRec = null;
    quickBusy = true;
    syncMic();
    saveVoiceNote(new Blob(rec.chunks, { type: recorder.mimeType || mime || "audio/webm" }), rec.full)
      .catch((error) => toast(error.message))
      .finally(() => {
        quickBusy = false;
        syncMic();
      });
  };
  recorder.start(1000);
  quickRec = rec;
  quickPreview = { text: "", note: "Listening…" };
  startMeter(stream, rec);
  rec.previewTimer = setInterval(() => requestPreview(rec, mime), PREVIEW_EVERY);
  quickBusy = quickStarting = false;
  rec.timer = setInterval(() => {
    const t = $("#quick-timer");
    if (t) t.textContent = quickClock();
  }, 500);
  syncMic();
  syncPreview();
}
async function saveVoiceNote(blob, full) {
  if (!blob.size) return toast("No audio was captured.");
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  const record = await api("/api/records", {
    method: "POST",
    data: { type: "inbox", stage: "inbox", title: "Voice note " + new Date().toLocaleString(), body: "", fields: {}, links: [] },
  });
  let attachment;
  try {
    attachment = await api("/api/attachments", {
      method: "POST",
      data: { recordId: record.id, name: `Voice-note-${Date.now()}.${ext}`, contentBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) },
    });
  } catch (e) {
    await refresh();
    return toast("Voice note entry created but the audio could not be saved: " + e.message);
  }
  const note = full ? " Recording stopped at the 5 MB limit." : "";
  try {
    const { text } = await api("/api/voice/transcribe", { method: "POST", data: { recordId: record.id, attachmentId: attachment.id } });
    if (!text.trim()) throw Error("no speech detected");
    const words = text.trim().split(/\s+/);
    await api("/api/records/" + encodeURIComponent(record.id), {
      method: "PATCH",
      data: { title: (words.slice(0, 8).join(" ") + (words.length > 8 ? "…" : "")).slice(0, 300), body: text.trim() },
    });
    await refresh();
    toast("Voice note saved — transcript ready to review." + note);
    if (assistantWanted()) runAssistant(record.id).catch((error) => toast(error.message));
  } catch (e) {
    await api("/api/records/" + encodeURIComponent(record.id), {
      method: "PATCH",
      data: { body: `Transcription failed: ${e.message}. Open the entry to retry.` },
    }).catch(() => {});
    await refresh();
    toast(`Voice note saved, but transcription failed: ${e.message}. Open the entry to retry.` + note);
  }
}
const assistantReady = () => {
  const a = state.assistant || {};
  const usable = (st) => !!st?.model && (st.provider === "local" || state.providers.find((p) => p.provider === st.provider)?.configured);
  return !!(a.enabled && usable(a.planner) && usable(a.writer));
};
function assistantWanted() {
  const box = $("#quick-assist");
  return assistantReady() && (box ? box.checked : !!state.assistant.autoRunOnCapture);
}
function stepLabel(st) {
  const r = st.result || {},
    skip = (what) => `${what} skipped: ${st.error}`;
  if (st.action === "understand")
    return st.error
      ? "The plan was not valid; trying once more"
      : `Understood as ${String(r.intent || "capture").replace(/_/g, " ")}${r.title ? ": " + r.title : ""}` + (r.source === "repaired" ? " (repaired plan)" : r.source === "fallback" ? " (safe default plan)" : "");
  if (st.action === "repair") return "Repair failed; using a safe default plan";
  if (st.action === "create_entry") return st.error ? skip("Create entry") : r.attachedTo ? `Added note “${r.title}” to an existing entry` : `Created ${r.type} “${r.title}”`;
  if (st.action === "search_papers")
    return st.error ? "Paper search failed: " + st.error : r.saved ? `Reading list saved: ${r.saved} of ${r.total} papers found` : `Searched papers: ${r.total} found, none listed`;
  if (st.action === "find_related") return st.error ? skip("Related search") : `Linked ${r.related.length} related ${r.related.length === 1 ? "entry" : "entries"}`;
  if (st.action === "ask") return st.error ? skip("Question") : "Question for you: " + r.question;
  if (st.action === "brainstorm") return st.error ? "Reply failed: " + st.error : "Brainstorm ready";
  if (st.action === "undo") return `Undone: ${r.trashed} ${r.trashed === 1 ? "entry" : "entries"} moved to Trash`;
  return `${st.action || "Action"}: ${st.error || "done"}`;
}
function assistantPanel() {
  const live = assistantLive,
    run = live?.run || state.assistantRuns?.[0];
  if (!run) {
    if (live) return `<div class="section-heading"><h2>Assistant</h2><span>starting</span></div><p class="assistant-phase"><span class="mic-dot"></span>Starting…</p>`;
    return assistantReady() ? "" : `<div class="section-heading"><h2>Assistant</h2><span>off</span></div><p class="hint">Choose a model in <a href="#settings">Settings</a> and the assistant will organise each capture: create an idea, find papers, and brainstorm with you.</p>`;
  }
  const running = ["running", "queued"].includes(run.status),
    message = state.messages.find((m) => m.id === run.messageId),
    reply = live ? live.reply : message?.text || "",
    created = run.createdIds.map((id) => state.records.find((r) => r.id === id)).filter((r) => r && !r.deleted),
    waiting = created.filter(needsReview).length,
    models = run.planner && run.writer ? (run.planner.model === run.writer.model ? run.planner.model : `${run.planner.model} → ${run.writer.model}`) : run.model,
    cloud = [run.planner, run.writer].some((st) => st && st.provider !== "local") || (!run.planner && run.provider !== "local"),
    t = run.timings || {},
    timing = t.planMs || t.writeMs ? ` · plan ${(t.planMs / 1000).toFixed(1)}s, reply ${(t.writeMs / 1000).toFixed(1)}s` : "",
    stopId = live?.runId;
  return `<div class="section-heading"><h2>Assistant</h2><span>${esc(models)} · ${run.usage.calls} model ${run.usage.calls === 1 ? "call" : "calls"}${cloud ? " (cloud)" : ""}${esc(timing)}</span></div><ol class="assistant-steps">${run.steps.map((st) => `<li class="${st.error ? "err" : "ok"}">${esc(stepLabel(st))}</li>`).join("")}${running ? `<li class="pending"><span class="mic-dot"></span>${esc(run.phase || "Working…")}</li>` : ""}</ol>${reply ? `<div class="assistant-reply" aria-label="Assistant reply">${esc(reply)}</div>` : ""}${run.error ? `<p class="error">${esc(run.error)}</p>` : ""}${created.length ? `<div class="assistant-created"><h3>Created by the assistant</h3>${recordList(created)}${waiting ? `<p class="hint">${waiting} waiting for your review. <button type="button" class="text-button" data-scroll-review>Go to To review</button></p>` : ""}</div>` : ""}<div class="assistant-actions">${run.sessionId ? `<a class="button secondary" href="#chat/${esc(run.sessionId)}">Open thread</a>` : ""}${running ? (stopId ? `<button type="button" class="button secondary" data-assistant-stop="${esc(stopId)}">Stop</button>` : "") : created.length ? `<button type="button" class="button secondary" data-assistant-undo="${esc(run.id)}">Undo this run</button>` : ""}${run.status === "undone" ? '<span class="hint">Undone. The entries are in Trash.</span>' : ""}</div>`;
}
function renderAssistant() {
  const el = $("#assistant-panel");
  if (!el) return;
  const html = assistantPanel();
  el.hidden = !html;
  el.innerHTML = html;
}
async function resumeAssistant() {
  const run = state.assistantRuns?.[0];
  if (!run || !["running", "queued"].includes(run.status) || assistantLive) return;
  const live = (assistantLive = { run, runId: run.id, reply: "", seen: run.createdIds.length });
  try {
    while (assistantLive === live) {
      const next = await api("/api/assistant/runs/" + encodeURIComponent(run.id));
      live.run = next;
      live.reply = next.reply || "";
      if (next.createdIds.length !== live.seen) {
        live.seen = next.createdIds.length;
        await refresh(false);
      }
      renderAssistant();
      if (!["running", "queued"].includes(next.status)) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    if (assistantLive === live) assistantLive = null;
    await refresh(!$("dialog[open]"));
  }
}
async function runAssistant(captureId) {
  const response = await fetch("/api/assistant/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ captureId }),
  });
  if (!response.ok) throw Error(((await response.json()).error || "Could not start the assistant.") + " The capture was saved.");
  const live = (assistantLive = { run: null, runId: "", reply: "", seen: 0 });
  renderAssistant();
  try {
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      ended = false;
    const consume = (event) => {
      if (event.event === "start") live.runId = event.runId;
      if (event.event === "run") {
        live.run = event.run;
        if (event.run.createdIds.length !== live.seen) {
          live.seen = event.run.createdIds.length;
          refresh(false).then(renderAssistant).catch(() => {});
        }
      }
      if (event.event === "reply_start") live.reply = "";
      if (event.event === "delta") live.reply += event.text;
      if (event.event === "end") ended = true;
      renderAssistant();
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.trim()) consume(JSON.parse(line));
      }
    }
    if (buffer.trim()) consume(JSON.parse(buffer));
    if (!ended) toast("Connection ended. Open the saved run from Home to see what the assistant finished.");
  } finally {
    const typed = $("#quick-title")?.value;
    if (assistantLive === live) assistantLive = null;
    await refresh(!$("dialog[open]"));
    if (typed && $("#quick-title")) $("#quick-title").value = typed;
  }
}
function assistantStage(name, label, st) {
  const provider = $(`#assistant-${name}-provider`)?.value || st?.provider || "local";
  return `<fieldset class="assistant-stage" data-stage="${name}"><legend>${label}</legend><div class="form-row"><label>Provider<select id="assistant-${name}-provider" name="${name}Provider">${Object.entries(providers).map(([k, v]) => option(k, v, provider)).join("")}</select></label><label>Model ID<input id="assistant-${name}-model" name="${name}Model" value="${esc(st?.model || "")}" maxlength="200" list="models-${esc(provider)}" placeholder="${provider === "local" ? "Loading local models…" : "Enter an exact model ID"}"></label></div><button type="button" class="text-button" data-models="${esc(provider)}">Load available models</button></fieldset>`;
}
function assistantSettings() {
  const a = state.assistant || {},

    unset = !a.planner?.model,
    cloudStage = [a.planner, a.writer].filter((st) => st && st.provider !== "local"),
    missing = cloudStage.filter((st) => !state.providers.find((x) => x.provider === st.provider)?.configured);
  return `<section class="settings-section"><h2>Capture assistant</h2><p class="muted">After you capture a thought, a planner model fills in one small form, the app creates the entry from it, lists verified papers from OpenAlex, Crossref and arXiv in a single reading list note, and a writer model starts a discussion thread. Everything it creates is marked “by assistant”, waits under “To review” on Home, and can be removed with one Undo per run. A run uses at most 3 model calls. It never edits entries it did not create.</p><form id="assistant-settings-form" class="provider-form"><label class="checkbox"><input name="enabled" type="checkbox"${a.enabled || unset ? " checked" : ""}> Turn on the capture assistant</label><label class="checkbox"><input name="autoRunOnCapture" type="checkbox"${a.autoRunOnCapture !== false ? " checked" : ""}> Run on every new capture by default (the toggle on Home still decides per capture)</label>${assistantStage("planner", "Planner model", a.planner)}${assistantStage("writer", "Writer model (brainstorm reply)", a.writer)}<p class="hint">Use one small non-thinking model for both planner and writer (default gemma4:e4b). A single model avoids GPU model swaps on 8 GB cards.</p><div id="model-lists">${modelDataLists()}</div><label>Papers listed per search<input name="maxPapers" type="number" min="1" max="10" step="1" value="${esc(a.maxPapers || 5)}" required></label>${missing.length ? `<p class="hint">No API key yet for ${esc(missing.map((st) => providers[st.provider]).join(", "))}: add one under Model providers.</p>` : ""}<p class="hint">Local models (Ollama) keep everything on this computer. A cloud provider receives, for every capture: the capture text, the titles and types of your 50 most recent reviewed entries, and the titles and abstracts of papers found by search. The home panel shows how many model calls each run used.</p><div class="config-actions"><button class="button secondary">Save</button></div></form></section>`;
}
let assistantModelRequest = false;
// qwen3 stays last: it can leak reasoning into the reply even with think disabled.
const LOCAL_PREFERRED = ["gemma4:e4b", "gemma3:4b", "llama3.2:3b", "qwen3:4b"];
async function prefillAssistantModel() {
  const empty = ["planner", "writer"].filter((n) => $(`#assistant-${n}-model`) && !$(`#assistant-${n}-model`).value && $(`#assistant-${n}-provider`).value === "local");
  if (!empty.length || assistantModelRequest) return;
  assistantModelRequest = true;
  localModelsRequest ??= discoverModels("local", null, true).catch((error) => toast(error.message));
  await localModelsRequest;
  assistantModelRequest = false;
  const ids = (modelLists.local || []).map((m) => m.id);
  for (const n of empty) {
    const input = $(`#assistant-${n}-model`),
      pick = LOCAL_PREFERRED.find((m) => ids.includes(m)) || ids[0];
    if (input && !input.value && pick) input.value = pick;
    else if (input && !pick) input.placeholder = "Enter an exact model ID";
  }
}
function voiceSettings() {
  const v = state.voice,
    usable = { groq: v.groqConsent && v.groqKeyConfigured, openai: v.openaiConsent && v.openaiKeyConfigured },
    sel = (name, value, items) => `<select name="${name}">${items.map(([k, l, d]) => `<option value="${k}"${value === k ? " selected" : ""}${d ? " disabled" : ""}>${esc(l)}</option>`).join("")}</select>`;
  return `<section class="settings-section"><h2>Voice transcription</h2><p class="muted">Used by the home microphone and the entry editor. Audio is always saved locally first. Cloud targets only receive audio after you allow it below.</p><form id="voice-settings-form" class="provider-form"><label>Transcribe with${sel("target", v.target, [["local", "Local server"], ["groq", "Groq (free-tier cloud)"], ["openai", "OpenAI (cloud)"]])}</label><h3>Local</h3><label>OpenAI-compatible base URL<input name="localBase" value="${esc(v.localBase)}" required><small>For example a Speaches server. Localhost only.</small></label><label>Model<input name="localModel" value="${esc(v.localModel)}" required></label><h3>Groq</h3><p class="hint">${v.groqKeyConfigured ? "Key configured (" + esc(v.groqKeySource) + ")" : "No API key configured"}</p><label>API key<input name="groqKey" type="password" autocomplete="new-password" placeholder="Leave blank to keep the current key"></label><label>Model<input name="groqModel" value="${esc(v.groqModel)}" required></label><label class="checkbox"><input name="groqConsent" type="checkbox"${v.groqConsent ? " checked" : ""}> Send audio to Groq for transcription</label><h3>OpenAI</h3><p class="hint">${v.openaiKeyConfigured ? "Uses the OpenAI key from Model providers." : "Add an OpenAI key under Model providers first."}</p><label>Model<input name="openaiModel" value="${esc(v.openaiModel)}" required></label><label class="checkbox"><input name="openaiConsent" type="checkbox"${v.openaiConsent ? " checked" : ""}> Send audio to OpenAI for transcription (charges may apply)</label><h3>Fallback</h3><label class="checkbox"><input name="fallback" type="checkbox"${v.fallback ? " checked" : ""}${usable.groq || usable.openai ? "" : " disabled"}> If the local server fails, retry with cloud</label><label>Cloud fallback${sel("fallbackTarget", v.fallbackTarget, [["groq", "Groq", !usable.groq], ["openai", "OpenAI", !usable.openai]])}</label><p class="hint">Needs consent and an API key for the chosen cloud service.</p><div class="config-actions"><button class="button secondary">Save</button></div></form></section>`;
}
function reviewSection() {
  const waiting = toReview();
  if (!waiting.length) return "";
  const groups = new Map();
  for (const r of waiting) {
    const key = r.origin.runId || r.origin.by;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  return `<section id="to-review" class="to-review"><div class="section-heading"><h2>To review</h2><span>${waiting.length}</span></div><p class="hint">Made by the assistant or a simulation. Not shown in lists, search or model context until you accept them.</p>${[...groups.values()]
    .map(
      (list) =>
        `<div class="review-group"><div class="review-head"><span>${(() => { const job = (state.jobs || []).find((j) => j.id === list[0].origin.runId); return job ? "Idea test · " + esc(job.ideaTitle) : list[0].origin.by === "simulation" ? "Simulation" : "Assistant run"; })()} · ${list.length} ${list.length === 1 ? "entry" : "entries"}</span><span class="review-actions"><button type="button" class="button secondary" data-review-all="accept" data-ids="${esc(list.map((r) => r.id).join(","))}">Accept all from this run</button></span></div>${list
          .map((r) => `<div class="review-row">${entryRow(r)}<span class="review-actions"><button type="button" class="button secondary" data-review="accept" data-id="${esc(r.id)}">Accept</button><button type="button" class="button secondary" data-review="discard" data-id="${esc(r.id)}">Discard</button></span></div>`)
          .join("")}</div>`,
    )
    .join("")}</section>`;
}
function home() {
  const all = entries(),
    inbox = all.filter((r) => r.type === "inbox"),
    progress = all.filter((r) =>
      ["exploring", "validating", "building"].includes(r.stage),
    ),
    actions = all.filter(
      (r) => r.fields?.nextStep && !["done", "parked"].includes(r.stage),
    );
  const byUpdated = (a, b) => b.updated.localeCompare(a.updated),
    linked = (a, b) =>
      (a.links || []).includes(b.id) || (b.links || []).includes(a.id),
    firstLine = (text = "") =>
      text
        .split("\n")
        .map((s) => s.trim())
        .find(Boolean),
    ideas = all.filter((r) => r.type === "idea").sort(byUpdated),
    idea =
      ideas.find((r) => ["exploring", "validating", "building"].includes(r.stage)) ||
      ideas.find((r) => !["done", "parked"].includes(r.stage)),
    experiment =
      idea &&
      all
        .filter((r) => r.type === "experiment" && linked(r, idea))
        .sort(byUpdated)[0],
    problem =
      idea &&
      all
        .filter(
          (r) =>
            r.type === "problem" &&
            linked(r, idea) &&
            firstLine(r.fields?.unknowns),
        )
        .sort(byUpdated)[0],
    resume = idea
      ? `<section class="notice"><div class="section-heading"><h2>Where I left off</h2><span>${esc(date(idea.updated))}</span></div><p><button class="text-button" data-edit="${esc(idea.id)}">${esc(idea.title)}</button></p><p><small>Next action</small>${idea.fields?.nextStep ? `<button class="text-button" data-edit="${esc(idea.id)}">${esc(idea.fields.nextStep)}</button>` : "No next action recorded"}</p><p><small>Last decision</small>${experiment ? `<button class="text-button" data-edit="${esc(experiment.id)}">${esc(experiment.fields?.decision || "Not decided")}</button>${experiment.fields?.results ? ` ${esc(experiment.fields.results.slice(0, 200))}` : ""}` : "No linked experiment yet."}</p><p><small>Open question</small>${problem ? `<button class="text-button" data-edit="${esc(problem.id)}">${esc(firstLine(problem.fields.unknowns))}</button>` : "No open question recorded."}</p></section>`
      : "";
  return `<div class="page-heading"><div><h1>Workspace</h1><p>What you are thinking about, and what comes next.</p></div></div>${resume}<form id="quick-form" class="capture"><input id="quick-title" aria-label="Capture a thought" placeholder="Write a thought, a question, or something you noticed" maxlength="300" required><button class="button primary" title="Ctrl+Enter adds without the assistant">Add to inbox</button><button type="button" id="quick-mic" class="button secondary" aria-label="Record a voice note">${micMarkup()}</button><label class="assist-toggle${assistantReady() ? "" : " off"}" title="${assistantReady() ? "Let the assistant organise this capture. Ctrl+Enter skips it." : "Choose a model in Settings to use the assistant."}"><input id="quick-assist" type="checkbox"${assistantReady() ? "" : " disabled"}${assistantReady() && (quickAssist ?? state.assistant.autoRunOnCapture) ? " checked" : ""}> Assistant</label></form><p id="quick-preview" class="quick-preview" aria-live="polite"${quickPreview ? "" : " hidden"}>${previewMarkup()}</p><section id="assistant-panel" class="assistant"${assistantPanel() ? "" : " hidden"}>${assistantPanel()}</section><section id="job-asks" class="job-asks"${jobAsks() ? "" : " hidden"}>${jobAsks()}</section>${reviewSection()}${legacyEntries().length ? `<div class="notice">${legacyEntries().length} personal entries found in the previous browser workspace. <button class="text-button" data-migrate>Import them into SQLite</button><small>Only your entries and edited examples are included. The old copy stays intact.</small></div>` : ""}${!all.length ? empty("An empty workspace, ready for your work.", "Start with one observation. You can organize it later.") : ""}<div class="home-grid"><section><div class="section-heading"><h2>Inbox</h2><a href="#inbox">${inbox.length === 1 ? "1 entry" : inbox.length + " entries"} →</a></div>${recordList(inbox.slice(-5).reverse(), "Your inbox is clear.")}</section><section><div class="section-heading"><h2>In progress</h2><span>${progress.length}</span></div>${recordList(progress.slice(-5).reverse(), "No active work yet.")}</section><section><div class="section-heading"><h2>Next actions</h2></div>${recordList(actions.slice(0, 6), "No next actions yet.")}</section><section><div class="section-heading"><h2>Recently edited</h2></div>${recordList([...all].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6), "No recent entries.")}</section></div>`;
}
function collection(view) {
  const items = entries()
    .filter(
      (r) =>
        (query || r.type === view) &&
        (!stageFilter || r.stage === stageFilter) &&
        (!query ||
          [r.title, r.body, r.category, ...Object.values(r.fields)]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase())),
    )
    .sort((a, b) => b.updated.localeCompare(a.updated));
  const conversations = query
    ? state.sessions.filter(
        (s) =>
          !s.deleted &&
          (s.title.toLowerCase().includes(query.toLowerCase()) ||
            state.messages.some(
              (m) =>
                m.sessionId === s.id &&
                m.text.toLowerCase().includes(query.toLowerCase()),
            )),
      )
    : [];
  return `<div class="page-heading"><div><h1>${query ? "Search results" : labels[view]}</h1><p>${query ? `Results for “${esc(query)}”` : "Keep the useful details. Leave the rest for later."}</p></div><button class="button secondary" data-new="${types[view] ? view : "inbox"}">Add entry</button></div><div class="list-toolbar"><span>${items.length} entries</span><label>Stage <select id="stage-filter">${option("", "All stages", stageFilter)}${stages.map((s) => option(s, s, stageFilter)).join("")}</select></label></div>${recordList(items, query ? "No matching entries." : "No entries yet.")}${conversations.length ? `<section class="search-discussions"><h2>Discussions</h2>${conversations.map((s) => `<a class="session-row" href="#chat/${esc(s.id)}">${esc(s.title)} <span>${s.agents.length} participants</span></a>`).join("")}</section>` : ""}`;
}
function trash() {
  const all = state.records.filter((r) => r.deleted),
    sessions = state.sessions.filter((s) => s.deleted);
  return `<div class="page-heading"><div><h1>Trash</h1><p>Items remain recoverable. Nothing is automatically purged.</p></div></div>${!all.length && !sessions.length ? empty("Trash is empty.", "Deleted entries and discussions will appear here.") : ""}${all.map((r) => `<div class="trash-row"><span>${types[r.type]}</span><strong>${esc(r.title)}</strong><button class="button secondary" data-restore="${esc(r.id)}">Restore</button></div>`).join("")}${sessions.map((s) => `<div class="trash-row"><span>Discussion</span><strong>${esc(s.title)}</strong><button class="button secondary" data-restore-session="${esc(s.id)}">Restore</button></div>`).join("")}`;
}
function participant(a, index) {
  return `<div class="participant" data-agent="${esc(a.id)}"><div class="participant-top"><label>Name<input data-agent-field="name" value="${esc(a.name)}" maxlength="100" required></label><button type="button" class="text-button danger" data-remove-agent="${index}">Remove</button></div><div class="form-row"><label>Role<select data-agent-field="role">${Object.entries(
    roles,
  )
    .map(([k, v]) => option(k, v, a.role))
    .join(
      "",
    )}</select></label><label>Provider<select data-agent-field="provider">${Object.entries(
    providers,
  )
    .map(([k, v]) => option(k, v, a.provider))
    .join(
      "",
    )}</select></label></div><label>Model ID<input data-agent-field="model" value="${esc(a.model)}" maxlength="200" list="models-${esc(a.provider)}" placeholder="Choose or enter an exact model ID"></label><button type="button" class="text-button" data-models="${a.provider}">Load available models</button><details><summary>Custom role instructions</summary><textarea data-agent-field="instruction" rows="3" maxlength="10000">${esc(a.instruction)}</textarea></details></div>`;
}
function modelDataLists() {
  return Object.entries(modelLists)
    .map(
      ([p, models]) =>
        `<datalist id="models-${p}">${models.map((m) => option(m.id, m.label || m.id, "")).join("")}</datalist>`,
    )
    .join("");
}
function chat() {
  const { id } = route(),
    sessions = state.sessions
      .filter((s) => !s.deleted)
      .sort((a, b) => b.updated.localeCompare(a.updated)),
    selected = sessions.find((s) => s.id === id);
  return `<div class="page-heading"><div><h1>Discussions</h1><p>Think with one model or bring several perspectives together.</p></div><button class="button primary" data-new-session>New discussion</button></div><div class="chat-layout"><aside class="session-list">${sessions.map((s) => `<a class="session-row ${s.id === id ? "selected" : ""}" href="#chat/${esc(s.id)}"><strong>${esc(s.title || "Untitled discussion")}</strong><small>${esc(s.mode)} · ${s.agents.length} participants</small></a>`).join("") || '<p class="muted">No discussions yet.</p>'}</aside><section class="conversation">${selected ? chatSession(selected) : empty("Choose a discussion or start one.", "Connect a provider in Settings, then choose a model and a role.", '<a class="button secondary" href="#settings">Provider settings</a>')}</section></div>`;
}
function chatSession(s) {
  const running =
    state.activeRuns.find((r) => r.sessionId === s.id) ||
    (streamingSession === s.id && activeRun ? { id: activeRun } : null);
  return `<div class="conversation-heading"><h2>${esc(s.title)}</h2><div><button class="text-button" data-duplicate-session="${esc(s.id)}">Reuse team</button><button class="text-button danger" data-trash-session="${esc(s.id)}">Trash</button></div></div><details class="session-config" ${!s.agents.length || s.agents.some((a) => !a.model) ? "open" : ""}><summary>Participants & context <span>${s.agents.length} participants · ${s.contextIds.length} selected entries</span></summary><form id="session-form" data-id="${esc(s.id)}"><fieldset ${running ? "disabled" : ""}><label>Discussion title<input id="session-title" value="${esc(s.title)}" maxlength="300" required></label><div class="form-row"><label>Mode<select id="session-mode">${option("solo", "Solo — first participant", s.mode)}${option("parallel", "Roundtable — independent replies", s.mode)}${option("team", "Team — discuss previous rounds", s.mode)}</select></label><label>Team rounds<select id="session-rounds">${[1, 2, 3].map((n) => option(String(n), String(n), String(s.rounds))).join("")}</select></label></div><label class="checkbox"><input id="local-only" type="checkbox" ${s.localOnly ? "checked" : ""}> Local endpoint only</label><p class="hint">Up to 6 participants, 3 rounds, and 4,096 output tokens per response. Cost is unavailable; these are request limits, not a dollar budget. Your local server may itself use cloud models.</p><div id="participants">${s.agents.map(participant).join("")}</div><button type="button" class="button secondary" id="add-agent" ${s.agents.length >= 6 ? "disabled" : ""}>Add participant</button><details class="context-selector"><summary>Choose workspace context</summary><p class="hint">Only checked entries and their readable text attachments are included. The latest 24 complete messages in this discussion are also sent.</p>${
    entries()
      .map(
        (r) =>
          `<label class="checkbox"><input type="checkbox" name="context" value="${esc(r.id)}" ${s.contextIds.includes(r.id) ? "checked" : ""}>${types[r.type]}: ${esc(r.title)}</label>`,
      )
      .join("") || '<p class="muted">No entries to attach.</p>'
  }<button type="button" class="text-button" id="preview-context">Preview selected entries</button></details><div class="config-actions"><button class="button primary">Save configuration</button><span class="hint">Changes are also saved before sending.</span></div></fieldset></form></details><div id="model-lists">${modelDataLists()}</div><div id="messages" class="messages" aria-live="off">${messageList(s.id)}</div><div class="chat-status" id="chat-status" role="status">${running ? "Generating responses…" : "Ready"}</div><form id="chat-form"><label class="sr-only" for="prompt">Message</label><textarea id="prompt" rows="3" maxlength="30000" placeholder="What would you like to think through?" ${running ? "disabled" : ""}>${esc(promptDrafts.get(s.id) || "")}</textarea><div class="composer-actions"><label>Send to<select id="send-to" ${running ? "disabled" : ""}>${option("", "Session participants", "")}${s.agents.map((a) => option(a.id, a.name, "")).join("")}</select></label><button class="button primary" ${running ? "disabled" : ""}>Send</button><button type="button" class="button secondary" id="stop-run" data-run="${running?.id || ""}" ${running ? "" : "hidden"}>Stop</button></div></form><div class="synthesis-controls"><label>Synthesize with<select id="moderator">${s.agents.map((a) => option(a.id, `${a.name} · ${a.model || "model not set"}`, "")).join("")}</select></label><button class="button secondary" id="synthesize" ${running || !state.messages.some((m) => m.sessionId === s.id && m.role === "assistant" && m.status === "complete") ? "disabled" : ""}>Summarize discussion</button></div>`;
}
function messageList(sessionId) {
  return (
    state.messages
      .filter((m) => m.sessionId === sessionId)
      .map(
        (m) =>
          `<article class="message ${m.role}" id="message-${esc(m.id)}"><div class="message-meta"><strong>${m.role === "user" ? "You" : esc(m.agent?.name || "Assistant")}</strong><span>${m.role === "assistant" ? `${esc(providers[m.agent?.provider] || "")} · ${esc(m.agent?.model || "")} · ${esc(m.agent?.role || "")} · round ${m.round}` : ""}</span><span class="message-state">${esc(m.status)}</span></div><div class="message-text">${esc(m.text)}</div>${m.error ? `<p class="error">${esc(m.error)}</p>` : ""}${m.role === "assistant" ? `<div class="message-footer"><span>${m.usage ? `${m.usage.input} input / ${m.usage.output} output tokens` : "Usage unavailable"} · cost unavailable</span><button class="text-button" data-message-context="${esc(m.id)}">Inspect sent context</button>${["failed", "cancelled"].includes(m.status) ? `<button class="text-button" data-retry="${esc(m.id)}">Retry this response</button>` : ""}${m.text ? `<label>Save draft<select data-save-response="${esc(m.id)}"><option value="">Choose type…</option>${["note", "idea", "problem", "experiment"].map((t) => option(t, types[t], "")).join("")}</select></label>` : ""}</div>` : ""}</article>`,
      )
      .join("") ||
    empty(
      "Start the conversation.",
      "Replies are generated by the providers you select. No sample answers.",
    )
  );
}
function settings() {
  return `<div class="page-heading"><div><h1>Settings</h1><p>Providers, local data, and recovery.</p></div></div><section class="settings-section"><h2>Model providers</h2><p class="muted">Keys stay in the local server’s ignored secrets file, never in browser storage or exports. They are stored as plain text on this computer. Environment variables take precedence.</p><div class="provider-grid">${state.providers.map((p) => `<form class="provider-form" data-provider="${p.provider}"><h3>${providers[p.provider]}</h3><p class="hint">${p.provider === "local" ? "Local endpoint; connection not yet verified" : p.configured ? "Key configured (" + esc(p.source) + ")" : "No API key configured"}</p>${p.provider === "local" ? `<label>OpenAI-compatible base URL<input name="base" value="${esc(p.base)}" required><small>Ollama: http://127.0.0.1:11434/v1 · LM Studio commonly uses port 1234.</small></label>` : ""}<label>${p.provider === "local" ? "API key (if required)" : "API key"}<input name="key" type="password" autocomplete="new-password" placeholder="Leave blank to keep the current key"></label><label class="checkbox"><input name="clear" type="checkbox"> Remove saved key</label>${p.provider === "local" ? '<p class="hint">Ollama works at the default URL with no key. For OmniRoute or another OpenAI-compatible router on this machine, set the base URL (for example http://127.0.0.1:20128/v1) and its API key.</p>' : ""}<div class="config-actions"><button class="button secondary">Save</button><button type="button" class="text-button" data-settings-models="${p.provider}">Check connection / models</button></div><p class="hint model-result" id="provider-result-${p.provider}"></p></form>`).join("")}</div></section>${voiceSettings()}${assistantSettings()}<section class="settings-section"><h2>Research search</h2><p class="muted">An optional OpenAlex API key avoids anonymous rate limits on paper search. Stored like provider keys; never sent to the browser.</p><div class="provider-grid"><form class="provider-form" data-provider="openalex"><h3>OpenAlex</h3><p class="hint">${state.openAlex?.configured ? "Key configured (" + esc(state.openAlex.source) + ")" : "No API key configured (anonymous search)"}</p><label>API key<input name="key" type="password" autocomplete="new-password" placeholder="Leave blank to keep the current key"></label><label class="checkbox"><input name="clear" type="checkbox"> Remove saved key</label><div class="config-actions"><button class="button secondary">Save</button></div></form></div></section><section class="settings-section"><h2>Workspace data</h2><p class="muted">SQLite and attachments live in the project’s data folder. They are excluded from Git. Automatic backups keep the latest 20 snapshots, including conversations and files, without API keys.</p><div class="data-actions"><a class="button secondary" href="/api/export" download="spark-workspace.json">Export workspace</a><label class="file-label button secondary">Import backup<input type="file" id="import-file" accept=".json,application/json" hidden></label><label>Import behavior<select id="import-mode"><option value="merge">Merge by ID</option><option value="replace">Replace active workspace (old entries go to trash)</option></select></label><button class="button secondary" id="load-backups">Show recovery backups</button></div><div id="backup-list"></div>${legacyEntries().length ? `<button class="text-button" data-migrate>Import ${legacyEntries().length} personal entries from the old browser workspace</button>` : ""}<p class="hint">Imports are validated before changes. Merge overwrites matching IDs. Replacing retains old entries in trash. Attachments: 5 MB per file, 20 MB per workspace including trashed files. Images and PDFs are download-only; model chat currently supports text.</p></section>`;
}
function renderBrief(id) {
  const record = state.records.find((r) => r.id === id);
  if (!record || record.type !== "idea")
    return empty("Idea not found", "The requested idea could not be found.");
  const notRecorded = "Not recorded";
  const text = (v) => (typeof v === "string" && v.trim() ? esc(v) : notRecorded);
  const isLinked = (r) => (record.links || []).includes(r.id) || (r.links || []).includes(record.id);
  const generated = (r) => ["assistant", "simulation"].includes(r.origin?.by);
  const confirmed = (r) => !generated(r) || String((r.type === "competitor" ? r.fields?.sources : r.type === "experiment" ? r.fields?.results : "") ?? "").trim() !== "";
  const linked = (type) => entries().filter((r) => r.type === type && isLinked(r) && confirmed(r));
  const guesses = entries().filter((r) => isLinked(r) && !confirmed(r));
  const guessBody = (r) => [r.body, ...Object.values(r.fields || {})].filter((v) => typeof v === "string" && v.trim()).join("\n\n").slice(0, 2500);
  const section = (title, body) =>
    `<section class="brief-section"><h2>${title}</h2>${body}</section>`;
  const source = (r) =>
    `<h3><button type="button" class="text-button" data-edit="${esc(r.id)}">${esc(r.title)}</button></h3>`;
  const line = (label, value) => `<p><strong>${label}:</strong> ${value}</p>`;
  const or = (html) => html || `<p>${notRecorded}</p>`;
  const f = record.fields || {};
  const m = typeof businessMath === "function" ? businessMath(f) || {} : null;
  const num = (v) =>
    Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : null;
  const money = (v) => (num(v) === null ? notRecorded : esc(f.currency || "") + num(v));
  const count = (v) => num(v) ?? notRecorded;
  const percent = Number.isFinite(m?.margin)
    ? (m.margin * 100).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "%"
    : notRecorded;
  const warnings = Array.isArray(m?.warnings)
    ? m.warnings.map((w) => `<li>${esc(w)}</li>`).join("")
    : "";
  return [
    `<a class="text-button brief-back" href="#idea">Back</a>`,
    `<div class="page-heading brief-heading"><h1>${esc(record.title)}</h1><button type="button" class="button secondary" id="print-brief">Print / save PDF</button></div>`,
    section("Stage", `<p>${text(record.stage)}</p>`),
    section("Solution", `<p>${text(f.solution)}</p>`),
    section("Audience", `<p>${text(f.audience)}</p>`),
    section("Payment", `<p>${text(f.payment)}</p>`),
    section("Next action", `<p>${text(f.nextStep)}</p>`),
    m
      ? section(
          "Business math",
          `${line("Contribution", money(m.contribution))}${line("Margin", percent)}${line("Break-even units", count(m.breakEven))}${line("Capacity units", count(m.capacity))}${line("Profit at capacity", money(m.profitAtCapacity))}${warnings ? `<ul>${warnings}</ul>` : ""}`,
        )
      : "",
    section(
      "Problems",
      or(
        linked("problem")
          .map(
            (r) =>
              `${source(r)}${line("People", text(r.fields?.people))}${line("Example", text(r.fields?.example))}${line("Evidence", text(r.fields?.evidence))}`,
          )
          .join(""),
      ),
    ),
    section(
      "Competitors",
      or(
        linked("competitor")
          .map(
            (r) =>
              `${source(r)}${line("Pricing", sourceLinks(r.fields?.pricing))}${line("Sources", sourceLinks(r.fields?.sources))}`,
          )
          .join(""),
      ),
    ),
    section(
      "Experiments",
      or(
        linked("experiment")
          .map(
            (r) =>
              `${source(r)}${line("Hypothesis", text(r.fields?.hypothesis))}${line("Success", text(r.fields?.success))}${line("Decision", text(r.fields?.decision))}`,
          )
          .join(""),
      ),
    ),
    guesses.length
      ? section(
          "Guesses to test",
          `<p class="hint">Written by a model or imported from Claude Code. Accepted by the owner, but guesses, not evidence. Test each one with real people before relying on it.</p>${guesses.map((r) => `<h3><button type="button" class="text-button" data-edit="${esc(r.id)}">${esc(r.title)}</button> ${originMark(r)}</h3><p class="guess-text">${esc(guessBody(r))}</p>`).join("")}`,
        )
      : "",
  ].join("");
}
function render() {
  const { view, id } = route();
  $("#breadcrumb").textContent = `Workspace / ${labels[view] || "Brief"}`;
  $("#nav").innerHTML = Object.entries(labels)
    .map(
      ([key, label]) =>
        `<a href="#${key}" ${view === key ? 'aria-current="page"' : ""}>${label}${types[key] ? `<span>${entries().filter((r) => r.type === key).length}</span>` : ""}</a>`,
    )
    .join("");
  $("#content").innerHTML = query
    ? collection(view)
    : view === "home"
      ? home()
      : view === "chat"
        ? chat()
        : view === "settings"
          ? settings()
          : view === "trash"
            ? trash()
            : view === "brief"
              ? renderBrief(id)
              : collection(view);
  $("#footer").textContent =
    "Saved in SQLite on this computer · backups exclude API keys";
  if (view === "home" && !query && !matchMedia("(pointer: coarse)").matches && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) focusCapture();
  prefillLocalModels();
  prefillAssistantModel();
}
function syncFields() {
  for (const input of $$("#record-fields [data-field]"))
    fieldDraft[input.dataset.field] = input.value;
}
function renderFields() {
  const type = $("#record-type").value;
  $("#record-fields").innerHTML = Object.entries(fieldLabels[type])
    .map(
      ([key, label]) =>
        `<label>${label}${["deadline", "researchedOn"].includes(key) ? `<input type="date" data-field="${key}" value="${esc(fieldDraft[key] || "")}">` : BUSINESS_MATH_INPUTS.includes(key) ? `<input type="number" step="any" min="0" data-field="${key}" value="${esc(fieldDraft[key] || "")}">` : key === "decision" ? `<select data-field="${key}">${option("", "Not decided", fieldDraft[key])}${["continue", "change direction", "stop"].map((v) => option(v, v, fieldDraft[key])).join("")}</select>` : `<textarea data-field="${key}" rows="2">${esc(fieldDraft[key] || "")}</textarea>`}</label>`,
    )
    .join("");
  renderResearch();
  renderMath();
  renderValidation();
}
function renderMath() {
  const panel = $("#math-panel");
  const isIdea = $("#record-type").value === "idea";
  panel.hidden = !isIdea;
  if (!isIdea) return;
  syncFields();
  const m = businessMath(fieldDraft);
  const currency = (fieldDraft.currency || "").trim();
  const money = (n) => n === null ? "—" : `${currency ? esc(currency) + " " : ""}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const count = (n) => n === null ? "—" : n.toLocaleString();
  const row = (label, value, needs) => {
    const gaps = needs.filter((k) => m.missing.includes(k));
    const note = value === "—" && gaps.length ? ` <small>Missing: ${gaps.map((k) => esc(fieldLabels.idea[k])).join(", ")}</small>` : "";
    return `<p><strong>${label}:</strong> ${value}${note}</p>`;
  };
  panel.innerHTML = `<h3>Business math</h3>${row("Contribution per sale", money(m.contribution), ["price", "variableCost"])}${row("Margin", m.margin === null ? "—" : `${(m.margin * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`, ["price", "variableCost"])}${row("Break-even customers per period", count(m.breakEven), ["fixedCosts", "price", "variableCost"])}${row("Capacity customers per period", count(m.capacity), ["hoursPerCustomer", "availableHours"])}${row("Profit at capacity per period", money(m.profitAtCapacity), ["fixedCosts", "price", "variableCost", "hoursPerCustomer", "availableHours"])}${m.warnings.map((w) => `<p class="hint">${esc(w)}</p>`).join("")}<p class="hint">Assumptions: the numbers you entered above. Nothing is estimated.</p>`;
}
function sourceLinks(value) {
  if (!value) return "Not recorded";
  return value.split(/(https?:\/\/[^\s<>"']+)/gi).map((part) => {
    try {
      const url = new URL(part);
      if (["http:", "https:"].includes(url.protocol))
        return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(part)}</a>`;
    } catch {}
    return esc(part);
  }).join("");
}
function renderResearch() {
  const panel = $("#research-panel");
  const isIdea = $("#record-type").value === "idea";
  panel.hidden = !isIdea;
  if (!isIdea) return;
  const id = $("#record-id").value;
  const linked = entries().filter((r) => r.type === "competitor" && id &&
    ((r.links || []).includes(id) || (recordDraft?.links || []).includes(r.id)));
  panel.innerHTML = `<h3>Competition research</h3><p class="hint">Search opens an external site and sends your query there. Findings are saved only when you add them here; no API calls are made.</p><a id="research-search" class="button secondary" target="_blank" rel="noopener noreferrer">Search the web</a> <button type="button" class="button secondary" id="add-competitor" ${id ? "" : "disabled"}>Add competitor</button> <button type="button" class="button secondary" id="founder-review" ${id ? "" : "disabled"}>Founder review</button>${id ? "" : '<p class="hint">Save this idea before adding a competitor or starting a founder review.</p>'}<p class="hint">Founder presets adapted from founder-skill by Jake Schincariol (MIT).</p><h4>Linked competitors</h4>${linked.length ? `<div class="research-grid">${linked.map((r) => `<div class="research-comparison"><button type="button" class="text-button" data-research-edit="${esc(r.id)}">${esc(r.title)}</button><p><strong>Product facts:</strong> ${esc(r.fields?.facts || "Not recorded")}</p><p><strong>Audience:</strong> ${esc(r.fields?.audience || "Not recorded")}</p><p><strong>Pricing:</strong> ${esc(r.fields?.pricing || "Not recorded")}</p><p><strong>Gaps:</strong> ${esc(r.fields?.gaps || "Not recorded")}</p><p><strong>Sources:</strong> ${sourceLinks(r.fields?.sources)} · ${esc(r.fields?.researchedOn || "Date not recorded")}</p></div>`).join("")}</div>` : '<p class="hint">No linked competitors yet.</p>'}`;
  updateResearchSearch();
  renderPapers();
}
let papers = { forId: null, query: "", results: [], page: 0, total: 0, fetched: "", sourcesTried: [], verification: null, source: "", busy: false, error: "", searched: false };
function paperVerification(p) {
  return p.verified?.by === "crossref" ? `Verified via Crossref DOI ${p.verified.doi}` : p.verified?.by === "arxiv" ? `Verified via arXiv ${p.verified.id}` : "";
}
function paperSourcesLine(tried, v) {
  const parts = tried.map((s) => `${s.name}: ${s.ok ? s.count : s.error || "failed"}`);
  if (v?.dropped) parts.push(`${v.dropped} unverified result${v.dropped === 1 ? "" : "s"} dropped`);
  if (v?.timedOut) parts.push("verification timed out");
  return parts.join(" · ");
}
function paperCitation(p) {
  const who = p.authors.length ? p.authors.join(", ") : "Unknown authors";
  return `${who} (${p.year || "n.d."}). ${p.title}.${p.venue ? " " + p.venue + "." : ""}${p.url ? " " + p.url : ""}`;
}
function safeHref(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function renderPapers() {
  const panel = $("#papers-panel");
  if (!panel) return;
  const isIdea = $("#record-type").value === "idea";
  panel.hidden = !isIdea;
  if (!isIdea) return;
  const id = $("#record-id").value;
  if (papers.forId !== (id || "new")) {
    papers = { forId: id || "new", query: "", results: [], page: 0, total: 0, fetched: "", sourcesTried: [], verification: null, source: "", busy: false, error: "", searched: false };
  }
  if (!papers.query) papers.query = [$("#record-title").value.trim(), ($("[data-field=solution]")?.value || "").split("\n")[0].trim()].filter(Boolean).join(" ");
  const items = papers.results.map((p, i) => {
    const href = safeHref(p.url);
    return `<li class="research-comparison"><strong>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>` : esc(p.title)}</strong><p class="hint">${p.verified ? `<span class="stage">${esc(p.verified.by === "crossref" ? "DOI verified" : "arXiv")}</span> ` : ""}${esc(p.authors.join(", ") || "Unknown authors")} · ${esc(p.year || "year unknown")} · ${esc(p.venue || "venue unknown")}</p>${p.abstract ? `<details><summary>Abstract</summary><p>${esc(p.abstract)}</p></details>` : '<p class="hint">No abstract available.</p>'}<button type="button" class="text-button" data-paper-note="${i}" ${id ? "" : "disabled"}>Save as note</button></li>`;
  }).join("");
  const more = papers.results.length < papers.total && !papers.error;
  panel.innerHTML = `<h3>Find related research</h3><p class="hint">Search sends your query to OpenAlex, Crossref and arXiv. Nothing is saved unless you choose Save as note.</p><label>Search query<input id="papers-query" value="${esc(papers.query)}" maxlength="300"></label> <button type="button" class="button secondary" id="papers-search" ${papers.busy ? "disabled" : ""}>${papers.busy ? "Searching…" : "Search"}</button>${id ? "" : '<p class="hint">Save this idea before saving a paper as a note.</p>'}${papers.error ? `<p class="hint" role="alert">${esc(papers.error)}</p>` : ""}${papers.searched && !papers.error ? `<p class="hint">About ${esc(papers.total)} results · page ${esc(papers.page)} · Searched on ${esc(papers.fetched.slice(0, 10))}. A limited search shows what it found, not that nothing else exists.</p><p class="hint">${esc(paperSourcesLine(papers.sourcesTried, papers.verification))}</p>` : ""}${papers.searched && !papers.error && !papers.results.length ? '<p class="hint">No papers found. Try broader or different words.</p>' : ""}${items ? `<ul class="research-grid">${items}</ul>` : ""}${more ? `<button type="button" class="button secondary" id="papers-more" ${papers.busy ? "disabled" : ""}>More</button>` : ""}`;
}
async function searchPapers(next) {
  const input = $("#papers-query");
  if (input) papers.query = input.value.trim();
  if (!papers.query) {
    papers.error = "Enter a search query.";
    return renderPapers();
  }
  const page = next ? papers.page + 1 : 1;
  papers.busy = true;
  papers.error = "";
  renderPapers();
  try {
    const r = await api(`/api/papers?q=${encodeURIComponent(papers.query)}&page=${page}`);
    papers.results = next ? [...papers.results, ...r.results] : r.results;
    papers.page = r.page;
    papers.total = r.total;
    papers.fetched = r.fetched;
    papers.sourcesTried = r.sourcesTried || [];
    papers.verification = r.verification || null;
    papers.searched = true;
  } catch (error) {
    papers.error = "Search failed: " + error.message;
  }
  papers.busy = false;
  renderPapers();
}
document.addEventListener("click", (event) => {
  const b = event.target.closest("button");
  if (!b || !$("#papers-panel")?.contains(b)) return;
  if (b.id === "papers-search") searchPapers(false);
  else if (b.id === "papers-more") searchPapers(true);
  else if (b.dataset.paperNote !== undefined) {
    const p = papers.results[Number(b.dataset.paperNote)];
    if (!p) return;
    if (JSON.stringify(formRecord()) !== editorSnapshot && !confirm("Discard unsaved changes before opening a note?")) return;
    const ideaId = $("#record-id").value;
    $("#record-dialog").close();
    openRecord(null, "note", { title: p.title, body: paperCitation(p) + (paperVerification(p) ? "\n" + paperVerification(p) : "") + (p.openAccessUrl && p.openAccessUrl !== p.url ? "\nOpen access: " + p.openAccessUrl : ""), links: [ideaId] }).catch((error) => toast(error.message));
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "papers-query") papers.query = event.target.value;
});
function updateResearchSearch() {
  const link = $("#research-search");
  if (!link) return;
  const query = $("[data-field=researchQueries]")?.value.trim() || `${$("#record-title").value.trim()} competitors alternatives`;
  link.href = "https://www.google.com/search?q=" + encodeURIComponent(query);
}
function formRecord() {
  syncFields();
  return {
    id: $("#record-id").value || undefined,
    type: $("#record-type").value,
    title: $("#record-title").value.trim(),
    body: $("#record-body").value,
    category: $("#record-category").value,
    stage: $("#record-stage").value,
    fields: { ...fieldDraft },
    links: [...$("#record-links").selectedOptions].map((o) => o.value),
  };
}
async function openRecord(id, type = "inbox", draft = {}) {
  const record = id ? state.records.find((r) => r.id === id) : null;
  recordDraft = record;
  fieldDraft = { ...(record?.fields || draft.fields || {}) };
  $("#record-form").reset();
  $("#record-id").value = record?.id || "";
  $("#record-type").value = record?.type || type;
  $("#record-title").value = record?.title || draft.title || "";
  $("#record-body").value = record?.body || draft.body || "";
  $("#record-category").value = record?.category || "";
  const stage = record?.stage || (type === "inbox" ? "inbox" : "draft");
  $("#record-stage").innerHTML = stages
    .map((s) => option(s, s, stage))
    .join("");
  $("#record-links").innerHTML = entries()
    .filter((r) => r.id !== id)
    .map(
      (r) =>
        `<option value="${esc(r.id)}"${(record?.links || draft.links || []).includes(r.id) ? " selected" : ""}>${esc(r.title)} (${types[r.type]})</option>`,
    )
    .join("");
  $("#record-heading").textContent = record
    ? "Edit entry"
    : draft.body
      ? "Review draft"
      : "Capture";
  $("#record-trash").hidden = !record;
  const generated = ["assistant", "simulation"].includes(record?.origin?.by);
  $("#assistant-mark").hidden = !generated;
  if (generated) {
    const sim = record.origin.by === "simulation";
    $("#assistant-mark-label").className = sim ? "by-simulation" : "by-assistant";
    $("#assistant-mark-label").textContent = sim ? "Simulated" : "by assistant";
    $("#assistant-mark-note").textContent = needsReview(record)
      ? "Not reviewed yet, so it stays out of lists, search and model context. Evidence fields stay empty until you accept it."
      : "Accepted. Check it before relying on it.";
    $("#assistant-accept").hidden = !needsReview(record);
    $("#assistant-accept").dataset.id = record.id;
  }
  $("#attachments-section").hidden = !record;
  $("#brief-button").hidden = !($("#record-id").value && $("#record-type").value === "idea");
  renderFields();
  editorSnapshot = JSON.stringify(formRecord());
  $("#record-dialog").showModal();
  $("#record-title").focus();
  $("#open-voice").textContent = record ? "Record audio" : "Save entry and record";
  window.voiceOpen(record?.id || "");
  if (record) await loadAttachments(record.id);
}
async function loadAttachments(id) {
  const files = await api(
    `/api/attachments?recordId=${encodeURIComponent(id)}`,
  );
  if ($("#record-id").value !== id) return;
  window.voiceFiles(files);
  $("#attachment-list").innerHTML =
    files
      .map(
        (f) =>
          `<div class="attachment-row"><span>${f.deleted ? esc(f.name) : `<a href="/api/attachments/${encodeURIComponent(f.id)}/download">${esc(f.name)}</a>`}<small>${Math.ceil(f.size / 1024)} KB · ${f.textReadable ? "Readable text" : "Download only"}${f.deleted ? " · trashed" : ""}</small></span><button type="button" class="text-button" ${f.deleted ? `data-restore-file="${esc(f.id)}"` : `data-trash-file="${esc(f.id)}"`}>${f.deleted ? "Restore" : "Trash"}</button></div>`,
      )
      .join("") || '<p class="hint">No attachments.</p>';
}
function currentSessionForm() {
  const form = $("#session-form");
  if (!form) return null;
  const prior = state.sessions.find((s) => s.id === form.dataset.id);
  return {
    ...prior,
    title: $("#session-title").value.trim() || "Untitled discussion",
    mode: $("#session-mode").value,
    rounds: Number($("#session-rounds").value),
    localOnly: $("#local-only").checked,
    contextIds: $$('[name="context"]:checked').map((x) => x.value),
    agents: $$(".participant").map((element) => {
      const a = { id: element.dataset.agent };
      for (const input of element.querySelectorAll("[data-agent-field]"))
        a[input.dataset.agentField] = input.value;
      return a;
    }),
  };
}
async function saveSession(renderNow = false) {
  const s = currentSessionForm();
  if (!s) throw Error("Choose a discussion first.");
  const saved = await api("/api/sessions/" + encodeURIComponent(s.id), {
    method: "PATCH",
    data: s,
  });
  state.sessions = state.sessions.map((s) => (s.id === saved.id ? saved : s));
  if (renderNow) render();
  return saved;
}
function newAgent() {
  return {
    id: crypto.randomUUID(),
    name: "Explorer",
    role: "explorer",
    provider: "local",
    model: "",
    instruction: "",
  };
}
async function newSession(source) {
  const saved = await api("/api/sessions", {
    method: "POST",
    data: {
      title: source ? source.title + (source.exactTitle ? "" : " — new discussion") : "New discussion",
      mode: source?.mode || "solo",
      rounds: source?.rounds || 1,
      localOnly: source?.localOnly ?? true,
      agents: source?.agents || [newAgent()],
      contextIds: source?.contextIds || [],
    },
  });
  await refresh(false);
  location.hash = "chat/" + saved.id;
  render();
}
function upsertMessage(message) {
  const i = state.messages.findIndex((m) => m.id === message.id);
  if (i >= 0) state.messages[i] = message;
  else state.messages.push(message);
}
function updateMessages(sessionId) {
  if (route().id === sessionId && $("#messages"))
    $("#messages").innerHTML = messageList(sessionId);
}
async function runChat(action = "run", messageId) {
  if (activeRun) throw Error("Wait for the current run or stop it first.");
  const prompt = $("#prompt")?.value || "",
    target = $("#send-to")?.value || "";
  if (action === "run" && !prompt.trim()) throw Error("Write a message first.");
  const s = await saveSession(),
    data = { sessionId: s.id, action };
  if (action === "run") {
    data.prompt = prompt;
    if (target) data.agentId = target;
  }
  if (action === "retry") data.messageId = messageId;
  if (action === "synthesize") {
    data.moderator = s.agents.find((a) => a.id === $("#moderator").value);
    if (!data.moderator) throw Error("Choose a moderator.");
  }
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw Error(error.error || "Could not start discussion.");
  }
  if (action === "run") promptDrafts.delete(s.id);
  streamingSession = s.id;
  activeRun = "starting";
  render();
  try {
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      ended = false;
    const consume = (event) => {
      if (event.event === "start") {
        activeRun = event.runId;
        state.activeRuns = [
          ...state.activeRuns.filter((r) => r.sessionId !== s.id),
          { id: activeRun, sessionId: s.id },
        ];
        if ($("#stop-run")) $("#stop-run").dataset.run = activeRun;
      }
      if (event.event === "message_start") upsertMessage(event.message);
      if (event.event === "delta") {
        const m = state.messages.find((m) => m.id === event.id);
        if (m) m.text += event.text;
      }
      if (event.event === "message_done") upsertMessage(event.message);
      if (event.event === "end") ended = true;
      if (event.event === "error") toast(event.error);
      updateMessages(s.id);
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.trim()) consume(JSON.parse(line));
      }
    }
    if (buffer.trim()) consume(JSON.parse(buffer));
    if (!ended)
      toast("Connection ended. Check saved response status before retrying.");
  } finally {
    activeRun = null;
    streamingSession = null;
    await refresh(false);
    if (route().view === "chat" && route().id === s.id) render();
  }
}
async function discoverModels(provider, resultId, quiet) {
  const button = $(`[data-models="${provider}"]`);
  if (button) button.disabled = true;
  try {
    const result = await api("/api/models", {
      method: "POST",
      data: { provider },
    });
    modelLists[provider] = result.models;
    if ($("#model-lists")) $("#model-lists").innerHTML = modelDataLists();
    if (resultId)
      $("#" + resultId).textContent =
        `Connected. ${result.models.length} models listed. ${result.models
          .slice(0, 6)
          .map((m) => m.id)
          .join(", ")}${result.models.length > 6 ? "…" : ""}`;
    if (!quiet)
      toast(
      `${result.models.length} model IDs loaded. Choose a text model supported by this provider.`,
    );
  } finally {
    if (button) button.disabled = false;
  }
}
let localModelsRequest = null;
const isEmptyLocalParticipant = (element) =>
  element.querySelector('[data-agent-field="provider"]').value === "local" &&
  !element.querySelector('[data-agent-field="model"]').value.trim();
async function prefillLocalModels() {
  if (!$$(".participant").some(isEmptyLocalParticipant)) return;
  localModelsRequest ??= discoverModels("local", null, true).catch((error) =>
    toast(error.message),
  );
  await localModelsRequest;
  const first = modelLists.local?.[0]?.id;
  if (first)
    for (const element of $$(".participant").filter(isEmptyLocalParticipant))
      element.querySelector('[data-agent-field="model"]').value = first;
}
async function migrateLegacy() {
  const legacy = legacyEntries();
  if (!legacy.length) return toast("No personal entries found.");
  if (
    !confirm(
      `Import ${legacy.length} personal entries? Untouched examples are excluded; the browser copy will remain.`,
    )
  )
    return;
  const typeMap = {
    ideas: "idea",
    problems: "problem",
    experiments: "experiment",
    tech: "technology",
    library: "note",
  };
  const records = legacy.map((r) => ({
    id: "legacy-" + r.id,
    type: typeMap[r.type] || "note",
    title: r.title,
    body: r.description || "",
    category: r.category || "",
    stage: stages.includes(String(r.stage).toLowerCase())
      ? r.stage.toLowerCase()
      : "draft",
    fields: {},
    links: r.linked ? ["legacy-" + r.linked] : [],
    created: new Date(Number(r.created) || Date.now()).toISOString(),
  }));
  await api("/api/import", {
    method: "POST",
    data: {
      mode: "merge",
      archive: {
        format: "spark-workbench",
        version: 2,
        records,
        sessions: [],
        messages: [],
        attachments: [],
      },
    },
  });
  await refresh();
  toast("Personal entries imported. The old browser copy is unchanged.");
}
function closeDialog(id) {
  if (
    id === "record-dialog" &&
    JSON.stringify(formRecord()) !== editorSnapshot &&
    !confirm("Discard unsaved changes?")
  )
    return;
  $("#" + id).close();
}
const STAGE_LABELS = { grill: "Grill", board: "Board", competitors: "Competitors", panel: "Panel", pricing: "Pricing", marketing: "Marketing", experiment: "Experiment" };
const STAGE_STATUS = { pending: "Not started", running: "Running", waiting_user: "Waiting for you", done: "Done", failed: "Failed" };
const JOB_STATUS = { queued: "Queued", running: "Running", waiting_user: "Waiting for you", stopped: "Stopped", done: "Finished", failed: "Failed", cancelled: "Cancelled" };
const jobActive = (j) => ["queued", "running", "waiting_user"].includes(j.status);
const jobsFor = (ideaId) => (state.jobs || []).filter((j) => j.ideaId === ideaId);
const questionCount = (text) => (String(text).match(/^[^\w\n]{0,8}Q\d+\b/gm) || []).length;
const seconds = (ms) => (ms ? (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + " s" : "");
const recordTitle = (id) => state.records.find((r) => r.id === id && !r.deleted)?.title;
function jobStageRow(j, st) {
  const here = j.stage === st.name && jobActive(j),
    stopped = j.gate?.stage === st.name,
    label = stopped ? (j.gate.kind === "cap" ? "Paused at call limit" : "Stopped at gate") : st.status === "done" ? (st.cached ? "Done (reused)" : "Done") : STAGE_STATUS[st.status] || st.status,
    cls = stopped || st.status === "failed" ? "bad" : st.status === "done" ? "ok" : st.status === "waiting_user" || here ? "now" : "";
  const outputs = (st.output?.recordIds || []).map((id) => (recordTitle(id) ? `<button type="button" class="text-button" data-edit="${esc(id)}">${esc(recordTitle(id))}</button>` : "")).join(" ");
  const meta = [st.usage?.calls ? `${st.usage.calls} ${st.usage.calls === 1 ? "call" : "calls"}` : "", seconds(st.usage?.ms)].filter(Boolean).join(" · ");
  return `<li class="${cls}"><span class="vt-name">${esc(STAGE_LABELS[st.name] || st.name)}</span><span class="vt-state">${esc(label)}</span><span class="vt-meta">${esc(meta)}</span>${st.output?.summary ? `<span class="vt-out">${esc(st.output.summary)}</span>` : ""}${outputs ? `<span class="vt-out">${outputs}</span>` : ""}${stopped ? `<span class="vt-gate">${esc(j.gate.reason)}</span>` : ""}${st.status === "failed" && st.error ? `<span class="vt-gate">${esc(st.error)}</span>` : ""}</li>`;
}
function jobWaiting(j) {
  const w = j.waiting;
  if (j.status !== "waiting_user" || !w) return "";
  if (w.kind === "grill") {
    const n = questionCount(w.text);
    return `<div class="job-ask"><p><strong>Spark has ${n || "some"} ${n === 1 ? "question" : "questions"} about ${esc(j.ideaTitle)}</strong> <small>round ${esc(w.round)}</small></p><pre class="grill-text">${esc(w.text)}</pre>${w.fatal ? `<p class="gate">Possible dealbreaker: ${esc(w.fatal)}</p>` : ""}<textarea class="job-answer" data-job="${esc(j.id)}" rows="5" maxlength="6000" placeholder="Answer by number. Write yes to accept a recommended answer." aria-label="Your answers"></textarea><div class="config-actions"><button type="button" class="button primary" data-job-answer="${esc(j.id)}">Send answers</button><button type="button" class="button secondary" data-job-enough="${esc(j.id)}">Enough questions — continue</button>${w.fatal ? `<button type="button" class="button secondary" data-job-park="${esc(j.id)}">Park this idea</button>` : ""}${w.threadId ? `<a class="button secondary" href="#chat/${esc(w.threadId)}">Open thread</a>` : ""}</div></div>`;
  }
  if (w.kind === "approve_profile")
    return `<div class="job-ask"><p><strong>Check the customer profile for ${esc(j.ideaTitle)}</strong></p><p>The panel plays buyers dealt from this simulated profile. Edit the note if it is wrong, then approve it.${w.message ? " " + esc(w.message) : ""}</p><div class="config-actions"><button type="button" class="button secondary" data-edit="${esc(w.noteId)}">Open profile</button><button type="button" class="button primary" data-job-approve="${esc(j.id)}">Approve profile</button></div></div>`;
  return `<div class="job-ask"><p><strong>${esc(j.ideaTitle)}</strong></p><p>${esc(w.message || "Spark needs something from you.")}</p><div class="config-actions"><button type="button" class="button secondary" data-edit="${esc(j.ideaId)}">Open idea</button><button type="button" class="button primary" data-job-continue="${esc(j.id)}">Continue</button></div></div>`;
}
function jobControls(j) {
  const out = [];
  if (j.status === "stopped" && j.gate?.kind === "gate") out.push(`<button type="button" class="button secondary" data-job-resume="${esc(j.id)}" data-override="1">Override and continue</button>`);
  else if (j.status === "stopped" && j.gate?.kind === "cap") out.push(`<button type="button" class="button secondary" data-job-resume="${esc(j.id)}">Allow 25 more calls and resume</button>`);
  else if (["stopped", "failed"].includes(j.status)) out.push(`<button type="button" class="button secondary" data-job-resume="${esc(j.id)}">Resume</button>`);
  if (["queued", "running", "waiting_user", "stopped"].includes(j.status)) out.push(`<button type="button" class="button secondary" data-job-cancel="${esc(j.id)}">Cancel</button>`);
  return out.length ? `<div class="config-actions">${out.join("")}</div>` : "";
}
function validationCard(idea) {
  const jobs = jobsFor(idea.id),
    j = jobs[0],
    ready = !!(state.assistant.planner?.model && state.assistant.writer?.model),
    models = j ? [j.models.planner, j.models.writer, j.models.simulation] : [];
  return `<h3>Validation <span class="by-simulation">Simulated</span></h3><p class="hint">Spark grills you, then a model-played board, competitor scout and buyer panel test the idea. Everything they write is a guess to test, waits under To review, and never fills an evidence field. Grill questions adapted from the grilling skill by Matt Pocock (MIT).</p>${
    ready
      ? `<div class="config-actions"><label class="inline-field">Panel<select id="job-panel-size"><option value="20">20 buyers</option><option value="100">100 buyers (slower)</option></select></label><button type="button" class="button primary" id="test-idea"${jobs.some(jobActive) ? " disabled" : ""}>Test this idea</button></div>`
      : `<p class="hint">Choose planner and writer models under Settings first.</p>`
  }${
    j
      ? `<div class="vt-head"><span>${esc(JOB_STATUS[j.status] || j.status)}${j.stage && jobActive(j) ? " · " + esc(STAGE_LABELS[j.stage] || j.stage) : ""}</span><span class="vt-count">${esc(j.usage.calls)} of ${esc(j.caps.calls)} model calls</span></div><ol class="vt">${j.stages.map((st) => jobStageRow(j, st)).join("")}</ol>${j.error ? `<p class="gate">${esc(j.error)}</p>` : ""}${jobWaiting(j)}${jobControls(j)}<p class="hint">Models: ${esc(models.map((m) => m.model).filter((m, i, a) => a.indexOf(m) === i).join(", "))}${models.some((m) => m.provider !== "local") ? " (cloud)" : " (local)"}</p>`
      : ""
  }<details class="bridge"><summary>Run it in Claude Code instead</summary><p class="hint">Writes this idea to a folder on this computer. You run the commands yourself; Spark never starts Claude Code.</p><div class="config-actions"><button type="button" class="button secondary" id="founder-export">Export to folder</button><button type="button" class="button secondary" id="founder-import">Import results</button></div><div id="founder-out"></div></details>`;
}
function renderValidation() {
  const panel = $("#validation-panel"),
    id = $("#record-id").value,
    idea = id && $("#record-type").value === "idea" ? state.records.find((r) => r.id === id) : null;
  panel.hidden = !idea;
  if (!idea) return;
  const typed = $("#validation-panel .job-answer")?.value || "",
    open = $("#validation-panel .bridge")?.open,
    size = $("#job-panel-size")?.value,
    out = $("#founder-out")?.innerHTML || "";
  panel.innerHTML = validationCard(idea);
  if (typed && $("#validation-panel .job-answer")) $("#validation-panel .job-answer").value = typed;
  if (open) $("#validation-panel .bridge").open = true;
  if (size && $("#job-panel-size")) $("#job-panel-size").value = size;
  if (out) $("#founder-out").innerHTML = out;
}
function jobAsks() {
  const waiting = (state.jobs || []).filter((j) => j.status === "waiting_user" && j.waiting);
  return waiting.length ? `<div class="section-heading"><h2>Spark is waiting for you</h2><span>${waiting.length}</span></div>${waiting.map((j) => `<div class="job-card">${jobWaiting(j)}</div>`).join("")}` : "";
}
function renderAsks() {
  const asks = $("#job-asks");
  if (!asks) return;
  const typed = $("#job-asks .job-answer")?.value || "";
  asks.innerHTML = jobAsks();
  asks.hidden = !asks.innerHTML;
  if (typed && $("#job-asks .job-answer")) $("#job-asks .job-answer").value = typed;
}
const jobSignature = () => JSON.stringify((state.jobs || []).map((j) => [j.id, j.status, j.stage, j.usage.calls, j.waiting?.round, j.waiting?.kind, j.stages.map((s) => s.status + (s.cached ? "c" : "")).join(",")]));
async function pollJobs() {
  if (!(state.jobs || []).some((j) => ["queued", "running"].includes(j.status))) return;
  try {
    const before = jobSignature();
    state = await api("/api/state");
    if (jobSignature() === before) return;
    if ($("#record-dialog").open) renderValidation();
    if (!$(".job-answer:focus")) renderAsks();
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (route().view === "home" && !query && !typing && !$("dialog[open]")) render();
  } catch {}
}
setInterval(pollJobs, 2500);
async function jobAction(url, data, message) {
  try {
    await api(url, { method: "POST", data: data || {} });
    await refresh(false);
    if ($("#record-dialog").open) renderValidation();
    renderAsks();
    if (message) toast(message);
  } catch (e) {
    toast(e.message);
  }
}
async function handleJobClick(b) {
  const jobUrl = (id, action) => "/api/jobs/" + encodeURIComponent(id) + "/" + action;
  if (b.id === "test-idea") {
    const id = $("#record-id").value;
    if (JSON.stringify(formRecord()) !== editorSnapshot && !confirm("Spark tests the saved version of this idea, without your unsaved changes. Continue?")) return true;
    await jobAction("/api/ideas/" + encodeURIComponent(id) + "/test", { panelN: Number($("#job-panel-size").value) }, "Testing started. You can close this window.");
    return true;
  }
  if (b.dataset.jobAnswer) {
    const box = b.closest(".job-ask")?.querySelector(".job-answer");
    await jobAction(jobUrl(b.dataset.jobAnswer, "answer"), { text: box?.value || "" });
    return true;
  }
  if (b.dataset.jobEnough) {
    const box = b.closest(".job-ask")?.querySelector(".job-answer");
    await jobAction(jobUrl(b.dataset.jobEnough, "answer"), { done: true, text: box?.value || "" });
    return true;
  }
  if (b.dataset.jobContinue) {
    await jobAction(jobUrl(b.dataset.jobContinue, "answer"), {});
    return true;
  }
  if (b.dataset.jobApprove) {
    await jobAction(jobUrl(b.dataset.jobApprove, "answer"), { approve: true });
    return true;
  }
  if (b.dataset.jobPark) {
    if (confirm("Move this idea to Parked and stop the test? You can override later.")) await jobAction(jobUrl(b.dataset.jobPark, "park"), {}, "Idea parked.");
    return true;
  }
  if (b.dataset.jobResume) {
    await jobAction(jobUrl(b.dataset.jobResume, "resume"), b.dataset.override ? { override: true } : {});
    return true;
  }
  if (b.dataset.jobCancel) {
    await jobAction(jobUrl(b.dataset.jobCancel, "cancel"), {}, "Test cancelled.");
    return true;
  }
  if (b.id === "founder-export" || b.id === "founder-import") {
    const id = $("#record-id").value,
      exporting = b.id === "founder-export",
      out = $("#founder-out");
    try {
      const r = await api("/api/ideas/" + encodeURIComponent(id) + "/founder-" + (exporting ? "export" : "import"), { method: "POST", data: {} });
      out.innerHTML = exporting
        ? `<p class="hint">${esc(r.note)}</p><pre class="grill-text">${esc(r.commands.join("\n"))}</pre><p class="hint">Folder: ${esc(r.folder)}${r.customer ? "" : ". No approved customer profile yet, so no customer.json was written; /founder-consumer will ask."}</p>`
        : `<p class="hint">${r.created.length} imported under To review${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.</p>${r.created.map((x) => `<p class="hint">${esc(x.title)}</p>`).join("")}`;
      if (!exporting) await refresh(false);
    } catch (e) {
      out.innerHTML = `<p class="gate">${esc(e.message)}</p>`;
    }
    return true;
  }
  return false;
}
async function handleClick(event) {
  const b = event.target.closest("button,a");
  if (!b) return;
  if (await handleJobClick(b)) return;
  if (b.id === "quick-mic") {
    await quickRecord();
    return;
  }
  if (b.id === "open-voice") {
    b.disabled = true;
    try {
      if (!$("#record-id").value) {
        const entry = formRecord();
        entry.title ||= "Voice note · " + new Date().toLocaleString();
        const saved = await api("/api/records", { method: "POST", data: entry });
        await refresh();
        if (!$("#record-dialog").open || $("#record-id").value) return;
        await openRecord(saved.id);
      }
      $("#voice-section").scrollIntoView({ block: "start" });
      $("#voice-record").click();
    } finally {
      b.disabled = false;
    }
    return;
  }
  if (b.id === "add-competitor" || b.dataset.researchEdit) {
    if (JSON.stringify(formRecord()) !== editorSnapshot && !confirm("Discard unsaved changes before opening a competitor?")) return;
    const ideaId = $("#record-id").value;
    $("#record-dialog").close();
    await openRecord(b.dataset.researchEdit || null, "competitor", { links: [ideaId] });
    return;
  }
  if (b.id === "founder-review") {
    if (JSON.stringify(formRecord()) !== editorSnapshot && !confirm("Start the review without your unsaved changes?")) return;
    const idea = state.records.find((r) => r.id === $("#record-id").value);
    if (!idea) return;
    const latest = state.sessions.filter((s) => !s.deleted && s.agents[0]).sort((x, y) => (y.updated || "").localeCompare(x.updated || ""))[0]?.agents[0];
    const linkedIds = entries().filter((r) => r.id !== idea.id && ((r.links || []).includes(idea.id) || (idea.links || []).includes(r.id))).map((r) => r.id);
    const agents = ["boardOffer", "boardMonopoly", "boardProduct", "cfo", "launchLead"].map((role) => ({ ...newAgent(), name: roles[role], role, ...(latest ? { provider: latest.provider, model: latest.model } : {}) }));
    $("#record-dialog").close();
    await newSession({ exactTitle: true, title: idea.title + " — founder review", mode: "parallel", rounds: 1, localOnly: agents.every((x) => x.provider === "local"), agents, contextIds: [idea.id, ...linkedIds].slice(0, 50) });
    return;
  }
  if (b.dataset.close) {
    closeDialog(b.dataset.close);
    return;
  }
  if (b.dataset.new) {
    await openRecord(null, b.dataset.new);
    return;
  }
  if (b.dataset.edit) {
    await openRecord(b.dataset.edit);
    return;
  }
  if (b.hasAttribute("data-new-session")) {
    await newSession();
    return;
  }
  if (b.dataset.duplicateSession) {
    await newSession(
      state.sessions.find((s) => s.id === b.dataset.duplicateSession),
    );
    return;
  }
  if (b.dataset.trashSession) {
    await api("/api/sessions/" + encodeURIComponent(b.dataset.trashSession), {
      method: "DELETE",
    });
    location.hash = "chat";
    await refresh();
    return;
  }
  if (b.dataset.restore) {
    await api("/api/records/" + encodeURIComponent(b.dataset.restore), {
      method: "PATCH",
      data: { deleted: null },
    });
    await refresh();
    return;
  }
  if (b.dataset.restoreSession) {
    await api("/api/sessions/" + encodeURIComponent(b.dataset.restoreSession), {
      method: "PATCH",
      data: { deleted: null },
    });
    await refresh();
    return;
  }
  if (b.id === "brief-button") {
    const ideaId = $("#record-id").value;
    if (!ideaId) return;
    if (JSON.stringify(formRecord()) !== editorSnapshot && !confirm("Discard unsaved changes before opening the brief?")) return;
    $("#record-dialog").close();
    location.hash = "brief/" + ideaId;
    return;
  }
  if (b.id === "print-brief") {
    window.print();
    return;
  }
  if (b.hasAttribute("data-migrate")) {
    await migrateLegacy();
    return;
  }
  if (b.dataset.models) {
    await discoverModels(b.dataset.models);
    return;
  }
  if (b.dataset.settingsModels) {
    await discoverModels(
      b.dataset.settingsModels,
      "provider-result-" + b.dataset.settingsModels,
    );
    return;
  }
  if (b.hasAttribute("data-remove-agent")) {
    const s = currentSessionForm();
    s.agents.splice(Number(b.dataset.removeAgent), 1);
    $("#participants").innerHTML = s.agents.map(participant).join("");
    $("#add-agent").disabled = s.agents.length >= 6;
    return;
  }
  if (b.id === "add-agent") {
    const s = currentSessionForm();
    if (s.agents.length >= 6) return;
    s.agents.push(newAgent());
    $("#participants").innerHTML = s.agents.map(participant).join("");
    $("#add-agent").disabled = s.agents.length >= 6;
    prefillLocalModels();
    return;
  }
  if (b.id === "preview-context") {
    const s = currentSessionForm(),
      result = await api("/api/context", {
        method: "POST",
        data: { ids: s.contextIds },
      });
    $("#text-heading").textContent = "Selected workspace context";
    $("#text-content").textContent = result.text || "No entries selected.";
    $("#text-dialog").showModal();
    return;
  }
  if (b.dataset.messageContext) {
    const result = await api("/api/message-context", {
      method: "POST",
      data: { id: b.dataset.messageContext },
    });
    $("#text-heading").textContent = "Exact messages sent to the provider";
    $("#text-content").textContent = JSON.stringify(result.messages, null, 2);
    $("#text-dialog").showModal();
    return;
  }
  if (b.dataset.retry) {
    await runChat("retry", b.dataset.retry);
    return;
  }
  if (b.id === "synthesize") {
    await runChat("synthesize");
    return;
  }
  if (b.dataset.scrollReview !== undefined) {
    $("#to-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (b.dataset.review || b.dataset.reviewAll || b.id === "assistant-accept") {
    const action = b.dataset.reviewAll || b.dataset.review || "accept",
      ids = b.dataset.ids ? b.dataset.ids.split(",") : [b.dataset.id],
      result = await api("/api/assistant/review", { method: "POST", data: { action, ids } });
    if (b.id === "assistant-accept") $("#record-dialog").close();
    await refresh();
    toast(action === "accept" ? `${result.changed} ${result.changed === 1 ? "entry" : "entries"} accepted.` : `${result.changed} ${result.changed === 1 ? "entry" : "entries"} moved to Trash.`);
    return;
  }
  if (b.dataset.assistantStop) {
    await api("/api/runs/" + encodeURIComponent(b.dataset.assistantStop) + "/cancel", { method: "POST", data: {} });
    toast("Stop requested. Entries already created are kept; Undo removes them.");
    return;
  }
  if (b.dataset.assistantUndo) {
    const run = await api("/api/assistant/runs/" + encodeURIComponent(b.dataset.assistantUndo) + "/undo", { method: "POST", data: {} });
    await refresh();
    const n = run.steps.at(-1).result.trashed;
    toast(`Run undone. ${n} ${n === 1 ? "entry" : "entries"} moved to Trash.`);
    return;
  }
  if (b.id === "stop-run") {
    const id = b.dataset.run;
    if (id && id !== "starting") {
      await api("/api/runs/" + encodeURIComponent(id) + "/cancel", {
        method: "POST",
        data: {},
      });
      toast("Stop requested. Partial replies will be preserved.");
      if (!activeRun) await refresh();
    }
    return;
  }
  if (b.id === "record-trash") {
    await api("/api/records/" + encodeURIComponent($("#record-id").value), {
      method: "DELETE",
    });
    $("#record-dialog").close();
    await refresh();
    toast("Moved to trash. You can restore it.");
    return;
  }
  if (b.dataset.trashFile || b.dataset.restoreFile) {
    const restore = !!b.dataset.restoreFile,
      id = b.dataset.restoreFile || b.dataset.trashFile;
    await api(
      "/api/attachments/" +
        encodeURIComponent(id) +
        (restore ? "/restore" : ""),
      { method: restore ? "POST" : "DELETE", data: restore ? {} : undefined },
    );
    await loadAttachments($("#record-id").value);
    return;
  }
  if (b.id === "load-backups") {
    const result = await api("/api/backups");
    $("#backup-list").innerHTML =
      result.backups
        .map(
          (name) =>
            `<div class="backup-row"><span>${esc(name)}</span><button class="text-button" data-backup="${esc(name)}">Restore</button></div>`,
        )
        .join("") ||
      '<p class="muted">A backup is created after your first saved change.</p>';
    return;
  }
  if (b.dataset.backup) {
    if (
      !confirm(
        "Restore this snapshot? Current entries are retained in trash and a recovery backup is created.",
      )
    )
      return;
    await api("/api/backups/restore", {
      method: "POST",
      data: { name: b.dataset.backup },
    });
    await refresh();
    toast("Snapshot restored.");
  }
}
document.addEventListener("click", (event) => {
  handleClick(event).catch((error) => toast(error.message));
});
document.addEventListener("input", (event) => {
  if (event.target.matches("[data-field=researchQueries], #record-title")) updateResearchSearch();
  if (event.target.closest("#record-fields")) renderMath();
});
document.addEventListener("submit", (event) => {
  event.preventDefault();
  (async () => {
    const form = event.target;
    if (form.id === "quick-form") {
      const title = $("#quick-title").value.trim();
      if (!title) return;
      const withAssistant = !quickBypass && assistantWanted();
      quickBypass = false;
      quickAssist = null;
      const capture = await api("/api/records", {
        method: "POST",
        data: {
          type: "inbox",
          stage: "inbox",
          title,
          body: "",
          fields: {},
          links: [],
        },
      });
      await refresh();
      if (withAssistant) runAssistant(capture.id).catch((error) => toast(error.message));
      return;
    }
    if (form.id === "record-form") {
      const record = formRecord();
      if (recordDraft && recordDraft.type !== record.type) {
        const previous = Object.entries(recordDraft.fields || {}).filter(
          ([, v]) => v,
        );
        if (previous.length)
          record.body +=
            "\n\nPrevious " +
            types[recordDraft.type] +
            " details:\n" +
            previous
              .map(([k, v]) => `${fieldLabels[recordDraft.type][k] || k}: ${v}`)
              .join("\n");
      }
      await api(
        "/api/records" + (record.id ? "/" + encodeURIComponent(record.id) : ""),
        { method: record.id ? "PATCH" : "POST", data: record },
      );
      $("#record-dialog").close();
      await refresh();
      toast("Entry saved.");
      return;
    }
    if (form.id === "session-form") {
      await saveSession(true);
      toast("Configuration saved.");
      return;
    }
    if (form.id === "chat-form") {
      await runChat();
      return;
    }
    if (form.id === "assistant-settings-form") {
      const f = form.elements;
      state.assistant = await api("/api/assistant/settings", {
        method: "POST",
        data: {
          enabled: f.enabled.checked,
          autoRunOnCapture: f.autoRunOnCapture.checked,
          planner: { provider: f.plannerProvider.value, model: f.plannerModel.value },
          writer: { provider: f.writerProvider.value, model: f.writerModel.value },
          maxPapers: Number(f.maxPapers.value),
        },
      });
      render();
      toast("Assistant settings saved.");
      return;
    }
    if (form.id === "voice-settings-form") {
      const f = form.elements,
        data = { target: f.target.value, localBase: f.localBase.value, localModel: f.localModel.value, groqModel: f.groqModel.value, openaiModel: f.openaiModel.value, groqConsent: f.groqConsent.checked, openaiConsent: f.openaiConsent.checked, fallback: f.fallback.checked, fallbackTarget: f.fallbackTarget.value };
      if (f.groqKey.value) data.groqKey = f.groqKey.value;
      state.voice = await api("/api/voice/settings", { method: "POST", data });
      render();
      toast("Transcription settings saved.");
      return;
    }
    if (form.classList.contains("provider-form")) {
      const provider = form.dataset.provider,
        key = form.elements.key.value,
        remove = form.elements.clear.checked,
        data = { provider };
      if (key || remove) data.key = remove ? "" : key;
      if (provider === "local") data.base = form.elements.base.value;
      const saved = await api("/api/providers", { method: "POST", data });
      if (provider === "openalex") state.openAlex = saved;
      else state.providers = saved;
      form.elements.key.value = "";
      if (provider === "local") localModelsRequest = null;
      render();
      toast("Provider settings saved.");
    }
  })().catch((error) => toast(error.message));
});
document.addEventListener("change", (event) => {
  (async () => {
    const input = event.target;
    if (input.id === "record-type") {
      syncFields();
      if ($("#record-stage").value === "inbox" && input.value !== "inbox")
        $("#record-stage").value = "draft";
      renderFields();
    }
    if (input.id === "quick-assist") quickAssist = input.checked;
    if (/^assistant-(planner|writer)-provider$/.test(input.id)) {
      const stage = input.closest(".assistant-stage");
      stage.querySelector("input").setAttribute("list", "models-" + input.value);
      stage.querySelector("[data-models]").dataset.models = input.value;
      stage.querySelector("input").value = "";
      prefillAssistantModel();
    }
    if (input.id === "stage-filter") {
      stageFilter = input.value;
      render();
    }
    if (input.dataset.agentField === "provider") {
      const parent = input.closest(".participant");
      parent
        .querySelector('[data-agent-field="model"]')
        .setAttribute("list", "models-" + input.value);
      parent.querySelector("[data-models]").dataset.models = input.value;
      prefillLocalModels();
    }
    if (input.dataset.saveResponse) {
      const message = state.messages.find(
          (m) => m.id === input.dataset.saveResponse,
        ),
        type = input.value;
      if (type && message)
        await openRecord(null, type, {
          title: "",
          body:
            message.text +
            "\n\nSource: " +
            message.agent.name +
            " / " +
            message.agent.provider +
            " / " +
            message.agent.model +
            "\nModel suggestion — review before treating as evidence.",
        });
      input.value = "";
    }
    if (input.id === "attachment-file") {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024)
        throw Error("Maximum file size is 5 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      await api("/api/attachments", {
        method: "POST",
        data: {
          recordId: $("#record-id").value,
          name: file.name,
          contentBase64: btoa(binary),
        },
      });
      input.value = "";
      await loadAttachments($("#record-id").value);
      toast("File attached.");
    }
    if (input.id === "import-file") {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 34000000) throw Error("Use a backup smaller than 34 MB.");
      const archive = JSON.parse(await file.text()),
        mode = $("#import-mode").value;
      if (
        !confirm(
          `${mode === "merge" ? "Merge" : "Restore"} this backup? Matching IDs will be replaced. A recovery snapshot is created first.`,
        )
      ) {
        input.value = "";
        return;
      }
      await api("/api/import", { method: "POST", data: { archive, mode } });
      await refresh();
      toast("Backup imported.");
    }
  })().catch((error) => {
    toast(error.message);
    if (event.target.type === "file") event.target.value = "";
  });
});
document.addEventListener("input", (event) => {
  if (event.target.id === "prompt")
    promptDrafts.set(route().id, event.target.value);
});
$("#search").addEventListener("input", (event) => {
  query = event.target.value.trim();
  render();
});
window.addEventListener("hashchange", () => {
  query = "";
  stageFilter = "";
  $("#search").value = "";
  render();
  window.scrollTo(0, 0);
});
$("#record-dialog").addEventListener("cancel", (event) => {
  if (
    JSON.stringify(formRecord()) !== editorSnapshot &&
    !confirm("Discard unsaved changes?")
  )
    event.preventDefault();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.target.id === "quick-title") {
    event.preventDefault();
    quickBypass = true;
    $("#quick-form").requestSubmit();
    return;
  }
  if (event.key === "Escape" && quickRec && quickRec.recorder.state === "recording") {
    event.preventDefault();
    quickRec.recorder.stop();
    return;
  }
  if (event.key === "Enter" && event.target.id === "papers-query") {
    event.preventDefault();
    searchPapers(false);
    return;
  }
  if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey) && !$("dialog[open]")) {
    event.preventDefault();
    document.activeElement?.blur();
    if (route().view !== "home" || query) {
      query = "";
      $("#search").value = "";
      if (location.hash !== "#home") location.hash = "#home";
      else render();
    }
    focusCapture();
    return;
  }
  if (
    event.key === "/" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) &&
    !$("dialog[open]")
  ) {
    event.preventDefault();
    $("#search").focus();
  }
});
refresh().then(resumeAssistant).catch((error) => {
  $("#content").innerHTML = empty(
    "Cannot connect to Spark.",
    error.message + " Start the local server, then refresh this page.",
  );
  $("#footer").textContent = "Disconnected — changes have not been saved.";
});
