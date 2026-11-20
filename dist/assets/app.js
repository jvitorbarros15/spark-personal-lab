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
  home: tx("Home"),
  inbox: tx("Inbox"),
  idea: tx("Ideas"),
  problem: tx("Problems"),
  experiment: tx("Experiments"),
  note: tx("Notes"),
  technology: tx("Technology"),
  competitor: tx("Competitors"),
  chat: tx("Discussions"),
  trash: tx("Trash"),
  settings: tx("Settings"),
};
const types = {
  inbox: tx("Capture"),
  idea: tx("Idea"),
  problem: tx("Problem"),
  experiment: tx("Experiment"),
  note: tx("Note"),
  technology: tx("Technology"),
  competitor: tx("Competitor"),
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
const _a1StageNames = { inbox: tx("inbox"), draft: tx("draft"), exploring: tx("exploring"), validating: tx("validating"), building: tx("building"), done: tx("done"), parked: tx("parked") };
const _a1StageLabel = (s) => _a1StageNames[s] || s;
const fieldLabels = {
  inbox: {},
  note: {},
  technology: {
    useCase: tx("What could it make possible?"),
    maturity: tx("Maturity / what you have verified"),
    risks: tx("Limitations and risks"),
    source: tx("Source links"),
  },
  problem: {
    people: tx("Who experiences this?"),
    context: tx("When and where does it happen?"),
    example: tx("A specific example"),
    workaround: tx("Current workaround"),
    evidence: tx("Evidence and source links"),
    unknowns: tx("What do you still need to learn?"),
  },
  idea: {
    solution: tx("What would you create?"),
    audience: tx("Who would use it?"),
    payment: tx("Who might pay, and why?"),
    alternatives: tx("Alternatives and assumptions"),
    nextStep: tx("Next action"),
    researchQueries: tx("Research query (edit before searching)"),
    currency: tx("Currency"),
    price: tx("Price per sale"),
    variableCost: tx("Variable cost per sale"),
    fixedCosts: tx("Fixed costs per period"),
    hoursPerCustomer: tx("Hours per customer"),
    availableHours: tx("Available hours per period"),
  },
  competitor: {
    website: tx("Website"),
    facts: tx("Product and sourced facts"),
    pricing: tx("Pricing"),
    audience: tx("Target audience"),
    sources: tx("Source links (include links for claims and pricing)"),
    researchedOn: tx("Date researched"),
    gaps: tx("Gaps and opportunities"),
  },
  experiment: {
    hypothesis: tx("Hypothesis"),
    plan: tx("Test plan"),
    success: tx("Success criteria"),
    deadline: tx("Target date"),
    results: tx("Results / what happened"),
    decision: tx("Decision"),
  },
};
const roles = {
  explorer: tx("Explorer"),
  investigator: tx("Problem investigator"),
  skeptic: tx("Skeptic"),
  builder: tx("Builder"),
  business: tx("Business analyst"),
  moderator: tx("Moderator"),
  boardOffer: tx("Board · Offer lens"),
  boardMonopoly: tx("Board · Monopoly lens"),
  boardProduct: tx("Board · Product lens"),
  competitorScout: tx("Competitor scout"),
  cfo: tx("CFO"),
  launchLead: tx("Launch lead"),
};
const providers = {
  openai: "OpenAI",
  anthropic: "Anthropic / Claude",
  gemini: "Google / Gemini",
  local: tx("Local endpoint"),
};
let state = {
    records: [],
    sessions: [],
    messages: [],
    providers: [],
    voice: {},
    openAlex: { configured: false, source: "none" },
    webSearch: { configured: false, source: "none" },
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
let justAdded = "",
  stepsShown = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  return { view: labels[view] || view === "brief" || view === "entry" || view === "review" ? view : "home", id };
};
const needsReview = (r) => ["assistant", "simulation"].includes(r.origin?.by) && !r.reviewed;
const entries = () => state.records.filter((r) => !r.deleted && !needsReview(r));
const toReview = () => state.records.filter((r) => !r.deleted && needsReview(r));
const originMark = (r) =>
  r.origin?.by === "simulation"
    ? `<span class="by-simulation">${tx("Simulated")}</span>`
    : r.origin?.by === "assistant"
      ? `<span class="by-assistant">${tx("by assistant")}</span>`
      : "";
const date = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : fmt.date(d);
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
  if (!res.ok) throw Error(result.error ? tx(result.error) : tx("Request failed ({status}).", { status: res.status }));
  return result;
}
async function refresh(renderNow = true) {
  state = await api("/api/state");
  $("#roadmap-link").hidden = !state.roadmap;
  if (!state.language) api("/api/language", { method: "POST", data: { language: I18N.lang } }).then((r) => (state.language = r.language), () => {});
  else if (state.language !== I18N.lang) {
    I18N.remember(state.language);
    location.reload();
  }
  if (renderNow) render();
}
function empty(title, description, action = "") {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
}
const parentIdea = (r) => {
  if (r.type === "idea") return null;
  const ideaId = (state.jobs || []).find((j) => j.id === r.origin?.runId)?.ideaId;
  return state.records.find((x) => x.type === "idea" && !x.deleted && (x.id === ideaId || (r.links || []).includes(x.id) || (x.links || []).includes(r.id))) || null;
};
function rowContext(r) {
  const parent = parentIdea(r),
    text = r.fields?.nextStep || String(/^\s*[{[]/.test(r.body || "") ? "" : r.body || "").replace(/\s+/g, " ").trim().slice(0, 160);
  return parent || text ? `<small>${parent ? `<b>${esc(parent.title)}</b>` : ""}${parent && text ? " · " : ""}${esc(text)}</small>` : "";
}
function entryRow(r) {
  const row = `<button class="entry-row${r.id === justAdded ? " fresh" : ""}" data-type="${esc(r.type)}" data-edit="${esc(r.id)}"><span class="entry-type">${types[r.type]}</span><span class="entry-title">${esc(r.title)}${r.private ? ` <span class="private-mark" title="${tx("Private: nothing about this entry leaves this computer")}">${lockIcon}</span>` : ""}${originMark(r)}${rowContext(r)}</span><span class="stage">${esc(_a1StageLabel(r.stage))}</span><time>${date(r.updated)}</time></button>`;
  const wrapped = r.type === "inbox" ? `<div class="entry-wrap">${row}<button type="button" class="entry-x" data-trash-record="${esc(r.id)}" aria-label="${tx("Move {title} to trash", { title: esc(r.title) })}" title="${tx("Move to trash")}">&times;</button></div>` : row,
    chip = classChip(r);
  return chip ? `<div class="class-wrap">${wrapped}${chip}</div>` : wrapped;
}
const percent = (p) => fmt.pct(p, 0);
function classChip(r) {
  const c = r.classification;
  if (!c) return "";
  if (r.type === "inbox" && c.uncertain) {
    const [a, b] = [{ type: c.type, p: c.p }, ...c.alternatives],
      pick = (x) => `<button type="button" class="class-pick" data-class-pick="${esc(r.id)}" data-type="${esc(x.type)}">${types[x.type]} (${percent(x.p)})</button>`;
    const art = (x) => (I18N.lang === "en" ? (/^[aeiou]/i.test(types[x.type]) ? "an " : "a ") : "");
    return `<p class="class-ask">${b ? tx("Is this {a} or {b}?", { a: art(a) + pick(a), b: art(b) + pick(b) }) : tx("Is this {a}?", { a: art(a) + pick(a) })}</p>`;
  }
  if (r.type === "inbox") return "";
  const mine = c.corrected ? tx("you") : percent(c.p);
  return `<label class="class-chip" title="${tx("How the assistant typed this. Pick another type to correct it.")}"><span class="sr-only">${tx("Type")}</span><select data-class-select="${esc(r.id)}">${Object.keys(types).filter((t) => t !== "inbox").map((t) => `<option value="${t}"${t === r.type ? " selected" : ""}>${types[t]}${t === r.type ? " · " + mine : ""}</option>`).join("")}</select></label>`;
}
async function setType(id, type) {
  const record = state.records.find((x) => x.id === id);
  if (!record || record.type === type) return;
  await api("/api/records/" + encodeURIComponent(id), { method: "PATCH", data: { type, ...(record.type === "inbox" ? { stage: "draft" } : {}) } });
  await refresh();
  toast(tx("Filed as {type}. Spark will remember your correction.", { type: types[type] }));
}
const classifyQuiet = (id) => api("/api/assistant/classify", { method: "POST", data: { captureId: id } }).then(() => refresh()).catch(() => {});
function recordList(records, message = tx("Nothing here yet."), hint = tx("Capture something when you are ready.")) {
  return records.length
    ? `<div class="entry-list">${records.map(entryRow).join("")}</div>`
    : empty(message, hint);
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
  if (quickStarting) return `<span class="mic-dot"></span> ${tx("Starting…")}`;
  if (quickBusy) return `<span class="mic-dot"></span> ${tx("Saving…")}`;
  if (!quickRec) return `<span class="mic-dot idle"></span> ${tx("Record")}`;
  return `<span class="mic-meter${reducedMotion() ? " still" : ""}" aria-hidden="true"><i id="quick-level"></i></span> ${tx("Stop")} <span id="quick-timer">${esc(quickClock())}</span>`;
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
  return `<span class="preview-tag">${tx("Live preview")}</span> ${text ? `<span class="preview-text">${esc(text)}</span>` : ""}${note ? `<span class="preview-note">${esc(note)}</span>` : ""}`;
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
    quickPreview = { text: quickPreview?.text || "", note: tx("Live preview paused — full transcript on Stop") };
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
      quickPreview = { text: "", note: tx("Live preview needs local transcription") };
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
    return toast(tx("Recording is unavailable in this browser or insecure context."));
  quickBusy = quickStarting = true;
  syncMic();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    quickBusy = quickStarting = false;
    syncMic();
    return toast(tx("Microphone unavailable: {error}", { error: e.message }));
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
  quickPreview = { text: "", note: tx("Listening…") };
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
  if (!blob.size) return toast(tx("No audio was captured."));
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  const record = await api("/api/records", {
    method: "POST",
    data: { type: "inbox", stage: "inbox", title: tx("Voice note {when}", { when: fmt.dateTime(new Date()) }), body: "", fields: {}, links: [] },
  });
  let attachment;
  try {
    attachment = await api("/api/attachments", {
      method: "POST",
      data: { recordId: record.id, name: `Voice-note-${Date.now()}.${ext}`, contentBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) },
    });
  } catch (e) {
    await refresh();
    return toast(tx("Voice note entry created but the audio could not be saved: {error}", { error: e.message }));
  }
  const note = full ? " " + tx("Recording stopped at the 5 MB limit.") : "";
  try {
    const { text } = await api("/api/voice/transcribe", { method: "POST", data: { recordId: record.id, attachmentId: attachment.id } });
    if (!text.trim()) throw Error(tx("no speech detected"));
    const words = text.trim().split(/\s+/);
    await api("/api/records/" + encodeURIComponent(record.id), {
      method: "PATCH",
      data: { title: (words.slice(0, 8).join(" ") + (words.length > 8 ? "…" : "")).slice(0, 300), body: text.trim() },
    });
    await refresh();
    toast(tx("Voice note saved — transcript ready to review.") + note);
    if (assistantWanted()) runAssistant(record.id).catch((error) => toast(error.message));
    else classifyQuiet(record.id);
  } catch (e) {
    await api("/api/records/" + encodeURIComponent(record.id), {
      method: "PATCH",
      data: { body: tx("Transcription failed: {error}. Open the entry to retry.", { error: e.message }) },
    }).catch(() => {});
    await refresh();
    toast(tx("Voice note saved, but transcription failed: {error}. Open the entry to retry.", { error: e.message }) + note);
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
    err = st.error ? tx(st.error) : "",
    skip = (what) => tx("{what} skipped: {error}", { what, error: err });
  if (st.action === "understand")
    return st.error
      ? tx("The plan was not valid; trying once more")
      : tx("Understood as {intent}{title}{note}", {
          intent: tx(String(r.intent || "capture").replace(/_/g, " ")),
          title: r.title ? ": " + r.title : "",
          note: r.source === "repaired" ? " (" + tx("repaired plan") + ")" : r.source === "fallback" ? " (" + tx("safe default plan") + ")" : "",
        });
  if (st.action === "repair") return tx("Repair failed; using a safe default plan");
  if (st.action === "create_entry") return st.error ? skip(tx("Create entry")) : r.attachedTo ? tx("Added note “{title}” to an existing entry", { title: r.title }) : tx("Created {type} “{title}”", { type: String(types[r.type] || r.type).toLowerCase(), title: r.title });
  if (st.action === "search_papers")
    return r.skipped ? tx("Paper search skipped: private, nothing leaves this computer") : st.error ? tx("Paper search failed: {error}", { error: err }) : r.saved ? tx("Reading list saved: {saved} of {total} papers found", { saved: r.saved, total: r.total }) : tx("Searched papers: {total} found, none listed", { total: r.total });
  if (st.action === "find_related") return st.error ? skip(tx("Related search")) : tp("Linked {n} related entry|Linked {n} related entries", r.related.length);
  if (st.action === "ask") return st.error ? skip(tx("Question")) : tx("Question for you: {question}", { question: r.question });
  if (st.action === "brainstorm") return st.error ? tx("Reply failed: {error}", { error: err }) : tx("Brainstorm ready");
  if (st.action === "undo") return tp("Undone: {n} entry moved to Trash|Undone: {n} entries moved to Trash", r.trashed);
  return st.error ? tx("{action}: {error}", { action: st.action || tx("Action"), error: err }) : tx("{action}: done", { action: st.action || tx("Action") });
}
function assistantPanel() {
  const live = assistantLive,
    run = live?.run || state.assistantRuns?.[0];
  if (!run) {
    if (live) return `<div class="section-heading"><h2>${tx("Assistant")}</h2><span>${tx("starting")}</span></div><p class="assistant-phase"><span class="mic-dot"></span>${tx("Starting…")}</p>`;
    return assistantReady() ? "" : `<div class="section-heading"><h2>${tx("Assistant")}</h2><span>${tx("off")}</span></div><p class="hint">${tx('Choose a model in <a href="#settings">Settings</a> and the assistant will organise each capture: create an idea, find papers, and brainstorm with you.')}</p>`;
  }
  const running = ["running", "queued"].includes(run.status),
    message = state.messages.find((m) => m.id === run.messageId),
    reply = live ? live.reply : message?.text || "",
    created = run.createdIds.map((id) => state.records.find((r) => r.id === id)).filter((r) => r && !r.deleted),
    waiting = created.filter(needsReview).length,
    models = run.planner && run.writer ? (run.planner.model === run.writer.model ? run.planner.model : `${run.planner.model} → ${run.writer.model}`) : run.model,
    cloud = [run.planner, run.writer].some((st) => st && st.provider !== "local") || (!run.planner && run.provider !== "local"),
    t = run.timings || {},
    timing = t.planMs || t.writeMs ? ` · ${tx("plan {plan}s, reply {reply}s", { plan: fmt.num(t.planMs / 1000, 1), reply: fmt.num(t.writeMs / 1000, 1) })}` : "",
    stopId = live?.runId;
  return `<div class="section-heading"><h2>${tx("Assistant")}</h2><span>${esc(models)} · ${tp("{n} model call|{n} model calls", run.usage.calls)}${cloud ? " (" + tx("cloud") + ")" : ""}${esc(timing)}${runCostText(run.id) ? " · " + esc(runCostText(run.id)) : ""}</span></div><details class="assistant-steps-wrap"${running ? " open" : ""}><summary>${tp("{n} step|{n} steps", run.steps.length)}</summary><ol class="assistant-steps">${run.steps.map((st, i) => `<li class="${st.error ? "err" : "ok"}${live && i >= stepsShown ? " new" : ""}">${esc(stepLabel(st))}</li>`).join("")}${running ? `<li class="pending"><span class="mic-dot"></span>${esc(run.phase ? tx(run.phase) : tx("Working…"))}</li>` : ""}</ol></details>${reply ? `<div class="assistant-reply" aria-label="${tx("Assistant reply")}">${esc(reply)}</div>` : ""}${run.error ? `<p class="error">${esc(tx(run.error))}</p>` : ""}${created.length ? `<div class="assistant-created"><h3>${tx("Created by the assistant")}</h3>${recordList(created)}${waiting ? `<p class="hint">${tx('{n} waiting for your review. <button type="button" class="text-button" data-scroll-review>Go to To review</button>', { n: waiting })}</p>` : ""}</div>` : ""}<div class="assistant-actions">${run.sessionId ? `<a class="button secondary" href="#chat/${esc(run.sessionId)}">${tx("Open thread")}</a>` : ""}${running ? (stopId ? `<button type="button" class="button secondary" data-assistant-stop="${esc(stopId)}">${tx("Stop")}</button>` : "") : created.length ? `<button type="button" class="button secondary" data-assistant-undo="${esc(run.id)}">${tx("Undo this run")}</button>` : ""}${run.status === "undone" ? `<span class="hint">${tx("Undone. The entries are in Trash.")}</span>` : ""}</div>`;
}
function renderAssistant() {
  const el = $("#assistant-panel");
  if (!el) return;
  const html = assistantPanel();
  el.hidden = !html;
  el.innerHTML = html;
  stepsShown = assistantLive?.run?.steps.length ?? stepsShown;
}
async function resumeAssistant() {
  const run = state.assistantRuns?.[0];
  if (!run || !["running", "queued"].includes(run.status) || assistantLive) return;
  stepsShown = run.steps.length;
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
  if (!response.ok) {
    const failure = (await response.json()).error;
    throw Error((failure ? tx(failure) : tx("Could not start the assistant.")) + " " + tx("The capture was saved."));
  }
  stepsShown = 0;
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
    if (!ended) toast(tx("Connection ended. Open the saved run from Home to see what the assistant finished."));
  } finally {
    const typed = $("#quick-title")?.value;
    if (assistantLive === live) assistantLive = null;
    await refresh(!$("dialog[open]"));
    if (typed && $("#quick-title")) $("#quick-title").value = typed;
  }
}
function assistantStage(name, label, st) {
  const provider = $(`#assistant-${name}-provider`)?.value || st?.provider || "local";
  return `<fieldset class="assistant-stage" data-stage="${name}"><legend>${label} <span id="assistant-${name}-cloud">${cloudMark({ provider, model: st?.model })}</span></legend><div class="form-row"><label>${tx("Provider")}<select id="assistant-${name}-provider" name="${name}Provider">${Object.entries(providers).map(([k, v]) => option(k, v, provider)).join("")}</select></label><label>${tx("Model ID")}<input id="assistant-${name}-model" name="${name}Model" value="${esc(st?.model || "")}" maxlength="200" list="models-${esc(provider)}" placeholder="${provider === "local" ? tx("Loading local models…") : tx("Enter an exact model ID")}"></label></div><button type="button" class="text-button" data-models="${esc(provider)}">${tx("Load available models")}</button></fieldset>`;
}
function assistantSettings() {
  const a = state.assistant || {},

    unset = !a.planner?.model,
    cloudStage = [a.planner, a.writer].filter((st) => st && st.provider !== "local"),
    missing = cloudStage.filter((st) => !state.providers.find((x) => x.provider === st.provider)?.configured);
  return `<section class="settings-section" id="set-assistant"><h2>${tx("Capture assistant")}</h2><p class="muted">${tx("After you capture a thought, a planner model fills in one small form, the app creates the entry from it, lists verified papers from OpenAlex, Crossref and arXiv in a single reading list note, and a writer model starts a discussion thread. Everything it creates is marked “by assistant”, waits under “To review” on Home, and can be removed with one Undo per run. A run uses at most 3 model calls. It never edits entries it did not create.")}</p><form id="assistant-settings-form" class="provider-form"><label class="checkbox"><input name="enabled" type="checkbox"${a.enabled || unset ? " checked" : ""}> ${tx("Turn on the capture assistant")}</label><label class="checkbox"><input name="autoRunOnCapture" type="checkbox"${a.autoRunOnCapture !== false ? " checked" : ""}> ${tx("Run on every new capture by default (the toggle on Home still decides per capture)")}</label>${assistantStage("planner", tx("Planner model"), a.planner)}${assistantStage("writer", tx("Writer model (brainstorm reply)"), a.writer)}<p class="hint">${tx("Use one small non-thinking model for both planner and writer (default gemma4:e4b). A single model avoids GPU model swaps on 8 GB cards.")}</p><p class="hint">${tx("Idea testing (Test this idea) uses the writer for the grill, board, panel and marketing. Non-thinking models in the gemma4:e4b class work best; thinking models such as qwen3:4b can leak their reasoning into answers.")}</p><div id="model-lists">${modelDataLists()}</div><label>${tx("Decision model")}<select name="decisionMode"><option value="engine"${a.decision?.mode !== "planner" ? " selected" : ""}>${tx("Local decision engine (default)")}</option><option value="planner"${a.decision?.mode === "planner" ? " selected" : ""}>${tx("Planner JSON (old)")}</option></select></label><div class="form-row"><label>${tx("Local model for decisions")}<input name="decisionModel" value="${esc(a.decision?.model || "")}" maxlength="200" placeholder="${tx("Same as the planner model when it is local, else gemma4:e4b")}"></label><label>${tx("Ask when confidence is below")}<input name="decisionThreshold" type="number" min="0" max="1" step="0.05" value="${esc(a.decision?.threshold ?? 0.6)}" required></label></div><p class="hint">${tx("The local decision engine reads answer probabilities from an Ollama model instead of trusting generated text. It classifies each capture, checks attachments and screens papers, and it asks you when it is unsure. It never sends anything off this computer.")}</p><label>${tx("Papers listed per search")}<input name="maxPapers" type="number" min="1" max="10" step="1" value="${esc(a.maxPapers || 5)}" required></label>${missing.length ? `<p class="hint">${tx("No API key yet for {names}: add one under Model providers.", { names: esc(missing.map((st) => providers[st.provider]).join(", ")) })}</p>` : ""}<p class="hint">${tx("Local models (Ollama) keep everything on this computer. A cloud provider receives, for every capture: the capture text, the titles and types of your 50 most recent reviewed entries, and the titles and abstracts of papers found by search. The home panel shows how many model calls each run used.")}</p><div class="config-actions"><button class="button secondary">${tx("Save")}</button></div></form></section>`;
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
    else if (input && !pick) input.placeholder = tx("Enter an exact model ID");
  }
}
function costSettings() {
  const c = state.cost || { settings: { budget: 5, prices: {}, pricesNote: "" }, byModel: {}, byFeature: {}, spent: 0, budget: 5 },
    rows = (o) => Object.entries(o).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.calls}</td><td>${fmt.num(v.tokensIn + v.tokensOut, 0)}</td><td>${usd(v.unknown && !v.costUsd ? null : v.costUsd)}${v.unknown ? ` (${tx("+{n} unknown", { n: v.unknown })})` : ""}</td></tr>`).join("") || `<tr><td colspan="4">${tx("No cloud calls this month.")}</td></tr>`,
    prices = c.settings.prices,
    missing = [...new Set(["planner", "writer", "simulation"].map((k) => state.assistant?.[k]).filter(isUnpriced).map((a) => a.model))],
    price = (name, p) => `<tr data-price="${esc(name)}"><td>${esc(name)}</td>${["input", "cached", "output"].map((k) => `<td><input type="number" min="0" step="any" name="${k}" value="${esc(p[k] ?? "")}"></td>`).join("")}${["input", "output"].map((k) => `<td><input type="number" min="0" step="any" name="off-${k}" value="${esc(p.off?.[k] ?? "")}" placeholder="${tx("same")}"></td>`).join("")}</tr>`;
  return `<section class="settings-section" id="set-cost"><h2>${tx("Cloud cost and privacy")}</h2><p class="muted">${tx("Cloud models (names ending in :cloud or -cloud, or any non-local provider) are billed per token. Spark records the tokens of every call, stops using a cloud model for the rest of the month when the budget would be passed, and never sends a private entry to a cloud model or searches the web for it. Structured output stages always run locally. Cost counts cached input at the full input price, so it can only overstate.")}</p>${missing.map((m) => `<p class="error">${tx("{model} has no price. Spark runs it on a local model instead until you add a price below.", { model: esc(m) })}</p>`).join("")}<p><strong>${tx("{month} so far: {spent} of {budget}", { month: esc(c.month || ""), spent: usd(c.spent), budget: usd(c.budget) })}</strong>${c.unknownCalls ? ` · ${tp("{n} cloud call with no price|{n} cloud calls with no price", c.unknownCalls)}` : ""}</p><div class="cost-tables"><table class="cost-table"><caption>${tx("By model")}</caption><thead><tr><th>${tx("Model")}</th><th>${tx("Calls")}</th><th>${tx("Tokens")}</th><th>${tx("Cost")}</th></tr></thead><tbody>${rows(c.byModel)}</tbody></table><table class="cost-table"><caption>${tx("By feature")}</caption><thead><tr><th>${tx("Feature")}</th><th>${tx("Calls")}</th><th>${tx("Tokens")}</th><th>${tx("Cost")}</th></tr></thead><tbody>${rows(c.byFeature)}</tbody></table></div><form id="cost-settings-form" class="provider-form"><label>${tx("Monthly budget (USD)")}<input name="budget" type="number" min="0" step="0.5" value="${esc(c.settings.budget)}" required></label><table class="cost-table"><caption>${tx("Prices per 1M tokens (USD)")}</caption><thead><tr><th>${tx("Model")}</th><th>${tx("Input")}</th><th>${tx("Cached")}</th><th>${tx("Output")}</th><th>${tx("Off-peak input")}</th><th>${tx("Off-peak output")}</th></tr></thead><tbody>${Object.entries(prices).map(([k, v]) => price(k, v)).join("")}${missing.map((m) => price(m, {})).join("")}</tbody></table><p class="hint">${esc(tx(c.settings.pricesNote))} ${tx("Off-peak is outside 12:00 to 18:00 UTC on weekdays, and all weekend. A model without a price is billed as unknown.")}</p><div class="config-actions"><button class="button secondary">${tx("Save")}</button></div></form></section>`;
}
function monthLine() {
  const c = state.cost;
  return c && (c.spent > 0 || c.unknownCalls) ? `<p class="hint month-line">${tx('Cloud spend this month: {spent} of {budget}{extra}. <a href="#settings">Details</a>', { spent: usd(c.spent), budget: usd(c.budget), extra: c.unknownCalls ? ` · ${tp("{n} call with no price|{n} calls with no price", c.unknownCalls)}` : "" })}</p>` : "";
}
function voiceSettings() {
  const v = state.voice,
    usable = { groq: v.groqConsent && v.groqKeyConfigured, openai: v.openaiConsent && v.openaiKeyConfigured },
    sel = (name, value, items) => `<select name="${name}">${items.map(([k, l, d]) => `<option value="${k}"${value === k ? " selected" : ""}${d ? " disabled" : ""}>${esc(l)}</option>`).join("")}</select>`;
  return `<section class="settings-section" id="set-voice"><h2>${tx("Voice transcription")}</h2><p class="muted">${tx("Used by the home microphone and the entry editor. Audio is always saved locally first. Cloud targets only receive audio after you allow it below.")}</p><form id="voice-settings-form" class="provider-form"><label>${tx("Transcribe with")}${sel("target", v.target, [["local", tx("Local server")], ["groq", tx("Groq (free-tier cloud)")], ["openai", tx("OpenAI (cloud)")]])}</label><h3>${tx("Local")}</h3><label>${tx("OpenAI-compatible base URL")}<input name="localBase" value="${esc(v.localBase)}" required><small>${tx("For example a Speaches server. Localhost only.")}</small></label><label>${tx("Model")}<input name="localModel" value="${esc(v.localModel)}" required></label><h3>Groq</h3><p class="hint">${v.groqKeyConfigured ? tx("Key configured ({source})", { source: esc(v.groqKeySource) }) : tx("No API key configured")}</p><label>${tx("API key")}<input name="groqKey" type="password" autocomplete="new-password" placeholder="${tx("Leave blank to keep the current key")}"></label><label>${tx("Model")}<input name="groqModel" value="${esc(v.groqModel)}" required></label><label class="checkbox"><input name="groqConsent" type="checkbox"${v.groqConsent ? " checked" : ""}> ${tx("Send audio to Groq for transcription")}</label><h3>OpenAI</h3><p class="hint">${v.openaiKeyConfigured ? tx("Uses the OpenAI key from Model providers.") : tx("Add an OpenAI key under Model providers first.")}</p><label>${tx("Model")}<input name="openaiModel" value="${esc(v.openaiModel)}" required></label><label class="checkbox"><input name="openaiConsent" type="checkbox"${v.openaiConsent ? " checked" : ""}> ${tx("Send audio to OpenAI for transcription (charges may apply)")}</label><h3>${tx("Fallback")}</h3><label class="checkbox"><input name="fallback" type="checkbox"${v.fallback ? " checked" : ""}${usable.groq || usable.openai ? "" : " disabled"}> ${tx("If the local server fails, retry with cloud")}</label><label>${tx("Cloud fallback")}${sel("fallbackTarget", v.fallbackTarget, [["groq", "Groq", !usable.groq], ["openai", "OpenAI", !usable.openai]])}</label><p class="hint">${tx("Needs consent and an API key for the chosen cloud service.")}</p><div class="config-actions"><button class="button secondary">${tx("Save")}</button></div></form></section>`;
}
function reviewGroups() {
  const groups = new Map();
  for (const r of toReview()) {
    const key = r.origin.runId || r.origin.by;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const job = (state.jobs || []).find((j) => j.id === list[0].origin.runId);
      const latest = list.reduce((m, r) => (r.updated > m ? r.updated : m), ""),
        label = job ? (job.kind === "research_pipeline" ? tx("Research") : tx("Idea test")) : list[0].origin.by === "simulation" ? tx("Simulation") : tx("Assistant run");
      return { key, list, label, idea: job ? job.ideaTitle : tx("Other drafts"), title: job ? label + " · " + job.ideaTitle : label, at: job?.created || latest, status: job ? JOB_STATUS[job.status] || job.status : "", latest };
    })
    .sort((x, y) => y.latest.localeCompare(x.latest));
}
const _a2Stage = { inbox: tx("inbox"), draft: tx("draft"), exploring: tx("exploring"), validating: tx("validating"), building: tx("building"), done: tx("done"), parked: tx("parked") };
const _a2Status = { complete: tx("complete"), failed: tx("failed"), cancelled: tx("cancelled"), running: tx("running"), queued: tx("queued"), pending: tx("pending"), stopped: tx("stopped") };
const _a2Mode = { solo: tx("solo"), parallel: tx("parallel"), team: tx("team") };
const plural = (n, one, many) => tp(`{n} ${one}|{n} ${many || one + "s"}`, n);
function ago(iso) {
  return Number.isFinite(Date.parse(iso)) ? fmt.ago(iso) : "";
}
const when = (iso) => (iso ? `<time datetime="${esc(iso)}" title="${esc(fmt.dateTime(iso))}">${esc(ago(iso))}</time>` : "");
const drafts = (n) => tp("{n} draft|{n} drafts", n);
const reviewCount = (groups) => tx("{drafts} from {runs}", { drafts: drafts(groups.reduce((n, g) => n + g.list.length, 0)), runs: tp("{n} run|{n} runs", groups.length) });
const acceptAll = (g) => `<button type="button" class="button secondary" data-review-all="accept" data-ids="${esc(g.list.map((r) => r.id).join(","))}" aria-label="${tx("Accept all {n} from {title}", { n: g.list.length, title: esc(g.title) })}">${tx("Accept all")}</button>`;
function reviewSection() {
  const groups = reviewGroups();
  if (!groups.length) return "";
  return `<section id="to-review" class="to-review"><div class="section-heading"><h2>${tx("To review")}</h2><span>${reviewCount(groups)}</span></div><ul class="review-runs">${groups
    .slice(0, 3)
    .map((g) => `<li class="review-row review-run"><a class="review-run-name" href="#review/${esc(encodeURIComponent(g.key))}">${esc(g.title)}</a><span class="review-run-n">${drafts(g.list.length)} · ${when(g.at)}${g.status ? " · " + esc(g.status) : ""}</span><span class="review-actions">${acceptAll(g)}<a class="button secondary" href="#review/${esc(encodeURIComponent(g.key))}" aria-label="${tx("Review {title}", { title: esc(g.title) })}">${tx("Review")}</a></span></li>`)
    .join("")}</ul><p class="review-foot"><span class="hint">${tx("Drafts stay out of lists, search and model context until you accept them.")}</span>${groups.length > 3 ? `<a href="#review">${tx("See all {n} runs", { n: groups.length })}</a>` : ""}</p></section>`;
}
function reviewPage(openKey) {
  const groups = reviewGroups();
  let open = "";
  try {
    open = decodeURIComponent(openKey || "");
  } catch {}
  return `<div class="page-heading"><div><h1>${tx("To review")}</h1><p>${groups.length ? reviewCount(groups) + ". " + tx("Drafts stay out of lists, search and model context until you accept them.") : tx("Drafts from the assistant and simulations wait here until you accept them.")}</p></div><a class="button secondary" href="#home">${tx("Back to Home")}</a></div>${
    groups.length
      ? `<div class="to-review review-all">${[...Map.groupBy(groups, (g) => g.idea)]
          .map(
            ([idea, runs]) =>
              `<section class="review-idea"><h2 class="review-idea-h">${esc(idea)} <small>${drafts(runs.reduce((n, g) => n + g.list.length, 0))} · ${tp("{n} run|{n} runs", runs.length)}</small></h2>${runs
                .map(
                  (g) =>
                    `<details class="review-group"${g.key === open || groups.length === 1 ? " open" : ""}><summary class="review-head"><span><b>${esc(g.label)}</b> <small>${drafts(g.list.length)} · ${when(g.at)}${g.status ? " · " + esc(g.status) : ""}</small></span><span class="review-actions">${acceptAll(g)}</span></summary>${g.list
                      .map((r) => `<div class="review-row">${entryRow(r)}<span class="review-actions"><button type="button" class="text-button" data-review="accept" data-id="${esc(r.id)}" aria-label="${tx("Accept {title}", { title: esc(r.title) })}">${tx("Accept")}</button><button type="button" class="text-button quiet" data-review="discard" data-id="${esc(r.id)}" aria-label="${tx("Discard {title}", { title: esc(r.title) })}">${tx("Discard")}</button></span></div>`)
                      .join("")}</details>`,
                )
                .join("")}</section>`,
          )
          .join("")}</div>`
      : empty(tx("All caught up."), tx("Nothing is waiting for your review. New drafts will show up on Home."))
  }`;
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
      ? `<section class="notice"><div class="section-heading"><h2>${tx("Where I left off")}</h2><span>${esc(date(idea.updated))}</span></div><p><button class="text-button" data-edit="${esc(idea.id)}">${esc(idea.title)}</button></p><p><small>${tx("Next action")}</small>${idea.fields?.nextStep ? `<button class="text-button" data-edit="${esc(idea.id)}">${esc(idea.fields.nextStep)}</button>` : tx("No next action recorded")}</p><p><small>${tx("Last decision")}</small>${experiment ? `<button class="text-button" data-edit="${esc(experiment.id)}">${esc(experiment.fields?.decision || tx("Not decided"))}</button>${experiment.fields?.results ? ` ${esc(experiment.fields.results.slice(0, 200))}` : ""}` : tx("No linked experiment yet.")}</p><p><small>${tx("Open question")}</small>${problem ? `<button class="text-button" data-edit="${esc(problem.id)}">${esc(firstLine(problem.fields.unknowns))}</button>` : tx("No open question recorded.")}</p></section>`
      : "";
  const asks = (state.jobs || []).filter((j) => j.status === "waiting_user" && j.waiting).length,
    review = toReview().length,
    needs = [asks ? `<button type="button" class="need-chip" data-scroll="#job-asks">${tp("<b>{n}</b> question waiting|<b>{n}</b> questions waiting", asks)}</button>` : "", review ? `<button type="button" class="need-chip" data-scroll="#to-review">${tx("<b>{n}</b> to review", { n: review })}</button>` : ""].filter(Boolean).join("");
  return `<div class="page-heading"><div><h1>${tx("What's on your mind?")}</h1></div></div><form id="quick-form" class="capture"><input id="quick-title" aria-label="${tx("Capture a thought")}" placeholder="${typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches ? tx("Capture a thought") : tx("Write a thought, a question, or something you noticed")}" maxlength="300" required><button class="button primary" id="quick-add" title="${tx("Ctrl+Enter adds without the assistant")}">${tx("Add to inbox")}</button><button type="button" id="quick-mic" class="button secondary" aria-label="${tx("Record a voice note")}">${micMarkup()}</button><label class="assist-toggle${assistantReady() ? "" : " off"}" title="${assistantReady() ? tx("Let the assistant organise this capture. Ctrl+Enter skips it.") : tx("Choose a model in Settings to use the assistant.")}"><input role="switch" id="quick-assist" type="checkbox"${assistantReady() ? "" : " disabled"}${assistantReady() && (quickAssist ?? state.assistant.autoRunOnCapture) ? " checked" : ""}> ${tx("Assistant")}</label></form><p id="quick-preview" class="quick-preview" aria-live="polite"${quickPreview ? "" : " hidden"}>${previewMarkup()}</p>${monthLine()}${needs ? `<div class="needs-strip" aria-label="${tx("Needs you")}">${needs}</div>` : ""}<section id="job-asks" class="job-asks"${jobAsks() ? "" : " hidden"}>${jobAsks()}</section>${reviewSection()}<section id="assistant-panel" class="assistant"${assistantPanel() ? "" : " hidden"}>${assistantPanel()}</section>${resume}${legacyEntries().length ? `<div class="notice">${tx("{n} personal entries found in the previous browser workspace.", { n: legacyEntries().length })} <button class="text-button" data-migrate>${tx("Import them into SQLite")}</button><small>${tx("Only your entries and edited examples are included. The old copy stays intact.")}</small></div>` : ""}${!all.length ? empty(tx("An empty workspace, ready for your work."), tx("Start with one observation. You can organize it later.")) : ""}<div class="home-grid"><section><div class="section-heading"><h2>${tx("Inbox")}</h2><a href="#inbox">${tp("{n} entry|{n} entries", inbox.length)} →</a></div>${recordList(inbox.slice(-5).reverse(), tx("Your inbox is clear."), tx("New captures land here until you sort them."))}</section><section><div class="section-heading"><h2>${tx("In progress")}</h2><span>${progress.length}</span></div>${recordList(progress.slice(-5).reverse(), tx("Nothing in progress yet."), tx("Ideas and experiments you move past draft show up here."))}</section><section><div class="section-heading"><h2>${tx("Next actions")}</h2></div>${recordList(actions.slice(0, 6), tx("No next actions yet."), tx("Add a next action to an idea and it appears here."))}</section><section><div class="section-heading"><h2>${tx("Recently edited")}</h2></div>${recordList([...all].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6), tx("Nothing edited yet."), tx("Your latest changes will be listed here."))}</section></div>`;
}
const LIST_HINTS = { inbox: tx("Quick captures, waiting to be sorted."), idea: tx("Things you might build. Open one to test it."), problem: tx("Pains and open questions worth solving."), experiment: tx("Small tests, and what you decided."), note: tx("Notes, research frames and anything worth keeping."), technology: tx("Tools and techniques you are tracking."), competitor: tx("Who else is solving this, and how.") };
function groupedList(items, message, hint) {
  const same = new Map();
  for (const r of items) same.set(r.title, [...(same.get(r.title) || []), r]);
  if (![...same.values()].some((l) => l.length > 1)) return recordList(items, message, hint);
  return `<div class="entry-list">${[...same.entries()].map(([title, list]) => (list.length === 1 ? entryRow(list[0]) : `<details class="row-group" data-type="${esc(list[0].type)}"><summary><span class="entry-title">${esc(title)}</span><span class="stage">${tx("{n} entries", { n: list.length })}</span></summary>${list.map(entryRow).join("")}</details>`)).join("")}</div>`;
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
  if (query && !items.length && !conversations.length) return `<div class="page-heading"><div><h1>${tx("Search results")}</h1><p>${tx("Nothing matches “{query}”.", { query: esc(query) })}</p></div></div>${empty(tx("No results for that search."), tx("Try fewer words or a different spelling. Search looks at titles, notes, fields and discussions."), `<button type="button" class="button secondary" data-clear-search>${tx("Clear search")}</button>`)}`;
  return `<div class="page-heading"><div><h1>${query ? tx("Search results") : labels[view]}</h1><p>${query ? tx("Results for “{query}”", { query: esc(query) }) : LIST_HINTS[view] || tx("Keep the useful details. Leave the rest for later.")}</p></div>${query ? `<button type="button" class="button secondary" data-clear-search>${tx("Clear search")}</button>` : `<button class="button secondary" data-new="${types[view] ? view : "inbox"}">${tx("Add entry")}</button>`}</div><div class="list-toolbar"><span>${tp("{n} entry|{n} entries", items.length)}</span><label>${tx("Stage")} <select id="stage-filter">${option("", tx("All stages"), stageFilter)}${stages.map((s) => option(s, _a2Stage[s] || s, stageFilter)).join("")}</select></label></div>${query ? recordList(items, tx("No entries match."), tx("Matching discussions are listed below.")) : groupedList(items, stageFilter ? tx("Nothing at this stage.") : tx("Nothing here yet."), stageFilter ? tx("Pick another stage, or All stages.") : tx("Add your first one with the button above."))}${conversations.length ? `<section class="search-discussions"><h2>${tx("Discussions")}</h2>${conversations.map((s) => `<a class="session-row" href="#chat/${esc(s.id)}">${esc(s.title)} <span>${tp("{n} participant|{n} participants", s.agents.length)}</span></a>`).join("")}</section>` : ""}`;
}
function trash() {
  const all = state.records.filter((r) => r.deleted),
    sessions = state.sessions.filter((s) => s.deleted);
  return `<div class="page-heading"><div><h1>${tx("Trash")}</h1><p>${tx("Items remain recoverable. Nothing is automatically purged.")}</p></div></div>${!all.length && !sessions.length ? empty(tx("Trash is empty."), tx("Deleted entries and discussions will appear here.")) : ""}${all.map((r) => `<div class="trash-row"><span>${types[r.type]}</span><strong>${esc(r.title)}</strong><button class="button secondary" data-restore="${esc(r.id)}">${tx("Restore")}</button></div>`).join("")}${sessions.map((s) => `<div class="trash-row"><span>${tx("Discussion")}</span><strong>${esc(s.title)}</strong><button class="button secondary" data-restore-session="${esc(s.id)}">${tx("Restore")}</button></div>`).join("")}`;
}
function participant(a, index) {
  return `<div class="participant" data-agent="${esc(a.id)}"><div class="participant-top"><label>${tx("Name")}<input data-agent-field="name" value="${esc(a.name)}" maxlength="100" required></label><button type="button" class="text-button danger" data-remove-agent="${index}">${tx("Remove")}</button></div><div class="form-row"><label>${tx("Role")}<select data-agent-field="role">${Object.entries(
    roles,
  )
    .map(([k, v]) => option(k, v, a.role))
    .join(
      "",
    )}</select></label><label>${tx("Provider")}<select data-agent-field="provider">${Object.entries(
    providers,
  )
    .map(([k, v]) => option(k, v, a.provider))
    .join(
      "",
    )}</select></label></div><label>${tx("Model ID")}<input data-agent-field="model" value="${esc(a.model)}" maxlength="200" list="models-${esc(a.provider)}" placeholder="${tx("Choose or enter an exact model ID")}"></label><button type="button" class="text-button" data-models="${a.provider}">${tx("Load available models")}</button><details><summary>${tx("Custom role instructions")}</summary><textarea data-agent-field="instruction" rows="3" maxlength="10000">${esc(a.instruction)}</textarea></details></div>`;
}
function modelDataLists() {
  return Object.entries(modelLists)
    .map(
      ([p, models]) =>
        `<datalist id="models-${p}">${models.map((m) => option(m.id, m.label || m.id, "")).join("")}</datalist>`,
    )
    .join("");
}
function sessionStatus(s) {
  if (state.activeRuns.some((r) => r.sessionId === s.id) || (streamingSession === s.id && activeRun)) return tx("Running");
  const last = state.messages.filter((m) => m.sessionId === s.id).pop();
  return last?.status === "failed" ? tx("Last reply failed") : last ? tx("Replied") : tx("No messages");
}
function chat() {
  const { id } = route(),
    sessions = state.sessions
      .filter((s) => !s.deleted)
      .sort((a, b) => b.updated.localeCompare(a.updated)),
    selected = sessions.find((s) => s.id === id);
  return `<div class="page-heading"><div><h1>${tx("Discussions")}</h1><p>${tx("Think with one model or bring several perspectives together.")}</p></div><button class="button primary" data-new-session>${tx("New discussion")}</button></div><div class="chat-layout"><aside class="session-list">${sessions.map((s) => `<a class="session-row ${s.id === id ? "selected" : ""}" href="#chat/${esc(s.id)}"><strong>${esc(s.title || tx("Untitled discussion"))}</strong><small>${esc(_a2Mode[s.mode] || s.mode)} · ${tp("{n} participant|{n} participants", s.agents.length)} · ${when(s.updated)} · ${esc(sessionStatus(s))}</small></a>`).join("") || `<p class="muted">${tx("No discussions yet.")}</p>`}</aside><section class="conversation">${selected ? chatSession(selected) : empty(tx("Choose a discussion or start one."), tx("Connect a provider in Settings, then choose a model and a role."), `<a class="button secondary" href="#settings">${tx("Provider settings")}</a>`)}</section></div>`;
}
function chatSession(s) {
  const running =
    state.activeRuns.find((r) => r.sessionId === s.id) ||
    (streamingSession === s.id && activeRun ? { id: activeRun } : null);
  return `<div class="conversation-heading"><h2>${esc(s.title)}</h2><div><button class="text-button" data-duplicate-session="${esc(s.id)}">${tx("Reuse team")}</button><button class="text-button danger" data-trash-session="${esc(s.id)}">${tx("Trash")}</button></div></div><details class="session-config" ${!s.agents.length || s.agents.some((a) => !a.model) ? "open" : ""}><summary>${tx("Participants & context")} <span>${tp("{n} participant|{n} participants", s.agents.length)} · ${tp("{n} selected entry|{n} selected entries", s.contextIds.length)}</span></summary><form id="session-form" data-id="${esc(s.id)}"><fieldset ${running ? "disabled" : ""}><label>${tx("Discussion title")}<input id="session-title" value="${esc(s.title)}" maxlength="300" required></label><div class="form-row"><label>${tx("Mode")}<select id="session-mode">${option("solo", tx("Solo — first participant"), s.mode)}${option("parallel", tx("Roundtable — independent replies"), s.mode)}${option("team", tx("Team — discuss previous rounds"), s.mode)}</select></label><label>${tx("Team rounds")}<select id="session-rounds">${[1, 2, 3].map((n) => option(String(n), String(n), String(s.rounds))).join("")}</select></label></div><label class="checkbox"><input id="local-only" type="checkbox" ${s.localOnly ? "checked" : ""}> ${tx("Local endpoint only")}</label><p class="hint">${tx("Up to 6 participants, 3 rounds, and 4,096 output tokens per response. Cost is unavailable; these are request limits, not a dollar budget. Your local server may itself use cloud models.")}</p><div id="participants">${s.agents.map(participant).join("")}</div><button type="button" class="button secondary" id="add-agent" ${s.agents.length >= 6 ? "disabled" : ""}>${tx("Add participant")}</button><details class="context-selector"><summary>${tx("Choose workspace context")}</summary><p class="hint">${tx("Only checked entries and their readable text attachments are included. The latest 24 complete messages in this discussion are also sent.")}</p>${
    entries()
      .map(
        (r) =>
          `<label class="checkbox"><input type="checkbox" name="context" value="${esc(r.id)}" ${s.contextIds.includes(r.id) ? "checked" : ""}>${types[r.type]}: ${esc(r.title)}</label>`,
      )
      .join("") || `<p class="muted">${tx("No entries to attach.")}</p>`
  }<button type="button" class="text-button" id="preview-context">${tx("Preview selected entries")}</button></details><div class="config-actions"><button class="button primary">${tx("Save configuration")}</button><span class="hint">${tx("Changes are also saved before sending.")}</span></div></fieldset></form></details><div id="model-lists">${modelDataLists()}</div><div id="messages" class="messages" aria-live="off">${messageList(s.id)}</div><div class="chat-status" id="chat-status" role="status">${running ? tx("Generating responses…") : tx("Ready")}</div><form id="chat-form"><label class="sr-only" for="prompt">${tx("Message")}</label><textarea id="prompt" rows="3" maxlength="30000" placeholder="${tx("What would you like to think through?")}" ${running ? "disabled" : ""}>${esc(promptDrafts.get(s.id) || "")}</textarea><div class="composer-actions"><label>${tx("Send to")}<select id="send-to" ${running ? "disabled" : ""}>${option("", tx("Session participants"), "")}${s.agents.map((a) => option(a.id, a.name, "")).join("")}</select></label><button class="button primary" ${running ? "disabled" : ""}>${tx("Send")}</button><button type="button" class="button secondary" id="stop-run" data-run="${running?.id || ""}" ${running ? "" : "hidden"}>${tx("Stop")}</button></div></form><div class="synthesis-controls"><label>${tx("Synthesize with")}<select id="moderator">${s.agents.map((a) => option(a.id, `${a.name} · ${a.model || tx("model not set")}`, "")).join("")}</select></label><button class="button secondary" id="synthesize" ${running || !state.messages.some((m) => m.sessionId === s.id && m.role === "assistant" && m.status === "complete") ? "disabled" : ""}>${tx("Summarize discussion")}</button></div>`;
}
function messageList(sessionId) {
  return (
    state.messages
      .filter((m) => m.sessionId === sessionId)
      .map(
        (m) =>
          `<article class="message ${m.role}" id="message-${esc(m.id)}"><div class="message-meta"><strong>${m.role === "user" ? tx("You") : esc(m.agent?.name || tx("Assistant"))}</strong><span>${m.role === "assistant" ? `${esc(providers[m.agent?.provider] || "")} · ${esc(m.agent?.model || "")} · ${esc(m.agent?.role || "")} · ${tx("round {n}", { n: m.round })}` : ""}</span><span class="message-state">${esc(_a2Status[m.status] || m.status)}</span></div><div class="message-text">${esc(m.text)}</div>${m.error ? `<p class="error">${esc(m.error)}</p>` : ""}${m.role === "assistant" ? `<div class="message-footer"><span>${m.usage ? tx("{input} input / {output} output tokens", { input: m.usage.input, output: m.usage.output }) : tx("Usage unavailable")} · ${esc(state.cost?.byRun?.[m.runId] ? (state.cost.byRun[m.runId].cloudCalls ? (state.cost.byRun[m.runId].unknown ? tx("cost unknown") : usd(state.cost.byRun[m.runId].costUsd)) : tx("local, $0")) : tx("cost unavailable"))}</span><button class="text-button" data-message-context="${esc(m.id)}">${tx("Inspect sent context")}</button>${["failed", "cancelled"].includes(m.status) ? `<button class="text-button" data-retry="${esc(m.id)}">${tx("Retry this response")}</button>` : ""}${m.text ? `<label>${tx("Save draft")}<select data-save-response="${esc(m.id)}"><option value="">${tx("Choose type…")}</option>${["note", "idea", "problem", "experiment"].map((t) => option(t, types[t], "")).join("")}</select></label>` : ""}</div>` : ""}</article>`,
      )
      .join("") ||
    empty(
      tx("Start the conversation."),
      tx("Replies are generated by the providers you select. No sample answers."),
    )
  );
}
function collapseProvider(p, html) {
  if (p.provider === "local" || p.configured) return html;
  return `<details class="provider-fold"><summary><b>${esc(providers[p.provider])}</b><span class="muted">${tx("No key")}</span><span class="fold-add">${tx("Add")}</span></summary>${html}</details>`;
}
function settings() {
  const theme = window.sparkTheme?.get() || "system",
    jump = [["appearance", tx("Appearance")], ["providers", tx("Providers")], ["voice", tx("Voice")], ["assistant", tx("Assistant")], ["cost", tx("Cost")], ["research", tx("Research")], ["web", tx("Web search")], ["data", tx("Data")]];
  return `<div class="page-heading"><div><h1>${tx("Settings")}</h1><p>${tx("Providers, local data, and recovery.")}</p></div></div><nav class="settings-index" aria-label="${tx("Jump to a settings section")}">${jump.map(([id, l]) => `<a href="#settings" data-jump="set-${id}">${l}</a>`).join("")}</nav><section class="settings-section" id="set-appearance"><h2>${tx("Appearance")}</h2><p class="muted">${tx("Light, dark, or follow this computer. Saved in this browser only.")}</p><fieldset class="theme-choice"><legend class="sr-only">${tx("Appearance")}</legend>${[["light", tx("Light")], ["dark", tx("Dark")], ["system", tx("System")]].map(([v, l]) => `<label class="theme-opt"><input type="radio" name="theme" value="${v}"${theme === v ? " checked" : ""}> ${l}</label>`).join("")}</fieldset><fieldset class="theme-choice" id="lang-choice"><legend>${tx("Language")}</legend>${[["en", "English"], ["pt-BR", "Português (Brasil)"]].map(([v, l]) => `<label class="theme-opt"><input type="radio" name="lang" value="${v}"${I18N.lang === v ? " checked" : ""}> ${l}</label>`).join("")}</fieldset></section><section class="settings-section" id="set-providers"><h2>${tx("Model providers")}</h2><p class="muted">${tx("Keys stay in the local server’s ignored secrets file, never in browser storage or exports. They are stored as plain text on this computer. Environment variables take precedence.")}</p><div class="provider-grid">${state.providers.map((p) => collapseProvider(p, `<form class="provider-form" data-provider="${p.provider}"><h3>${providers[p.provider]}</h3><p class="hint">${p.provider === "local" ? tx("Local endpoint; connection not yet verified") : p.configured ? tx("Key configured ({source})", { source: esc(p.source) }) : tx("No API key configured")}</p>${p.provider === "local" ? `<label>${tx("OpenAI-compatible base URL")}<input name="base" value="${esc(p.base)}" required><small>${tx("Ollama: http://127.0.0.1:11434/v1 · LM Studio commonly uses port 1234.")}</small></label><label class="checkbox"><input name="trusted" type="checkbox"${p.marked ? " checked" : ""}> ${tx("This endpoint is local and private")}</label>` : ""}<label>${p.provider === "local" ? tx("API key (if required)") : tx("API key")}<input name="key" type="password" autocomplete="new-password" placeholder="${tx("Leave blank to keep the current key")}"></label><label class="checkbox"><input name="clear" type="checkbox"> ${tx("Remove saved key")}</label>${p.provider === "local" ? `<p class="hint">${tx("Ollama at http://127.0.0.1:11434 is treated as local. Any other endpoint, including a router such as OmniRoute that forwards to cloud models, is treated as a cloud route: it is billed, budget-capped, and never receives private entries. Tick the box only if every request stays on this computer.")}</p>` : ""}<div class="config-actions"><button class="button secondary">${tx("Save")}</button><button type="button" class="text-button" data-settings-models="${p.provider}">${tx("Check connection / models")}</button></div><p class="hint model-result" id="provider-result-${p.provider}"></p></form>`)).join("")}</div></section>${voiceSettings()}${assistantSettings()}${costSettings()}<section class="settings-section" id="set-research"><h2>${tx("Research search")}</h2><p class="muted">${tx("An optional OpenAlex API key avoids anonymous rate limits on paper search. Stored like provider keys; never sent to the browser.")}</p><div class="provider-grid"><form class="provider-form" data-provider="openalex"><h3>OpenAlex</h3><p class="hint">${state.openAlex?.configured ? tx("Key configured ({source})", { source: esc(state.openAlex.source) }) : tx("No API key configured (anonymous search)")}</p><label>${tx("API key")}<input name="key" type="password" autocomplete="new-password" placeholder="${tx("Leave blank to keep the current key")}"></label><label class="checkbox"><input name="clear" type="checkbox"> ${tx("Remove saved key")}</label><div class="config-actions"><button class="button secondary">${tx("Save")}</button></div></form></div></section><section class="settings-section" id="set-web"><h2>${tx("Web search")}</h2><p class="muted">${tx("Lets the competitor step search the web and read pages, so competitors come with prices and links instead of model memory. Uses Ollama’s hosted web search: create a free API key at ollama.com/settings/keys and paste it here. Stored like provider keys, never sent to the browser. Private entries never search. Each search is logged in Cost at $0. Search queries and page addresses go to ollama.com.")}</p><div class="provider-grid"><form class="provider-form" data-provider="websearch"><h3>${tx("Ollama web search")}</h3><p class="hint">${state.webSearch?.configured ? tx("Key configured ({source})", { source: esc(state.webSearch.source) }) : tx("No API key configured (competitors come from model memory, marked unconfirmed)")}</p><label>${tx("API key")}<input name="key" type="password" autocomplete="new-password" placeholder="${tx("Leave blank to keep the current key")}"></label><label class="checkbox"><input name="clear" type="checkbox"> ${tx("Remove saved key")}</label><div class="config-actions"><button class="button secondary">${tx("Save")}</button></div></form></div></section><section class="settings-section" id="set-data"><h2>${tx("Workspace data")}</h2><p class="muted">${tx("SQLite and attachments live in the project’s data folder. They are excluded from Git. Automatic backups keep the latest 20 snapshots, including conversations and files, without API keys.")}</p><div class="data-actions"><a class="button secondary" href="/api/export" download="spark-workspace.json">${tx("Export workspace")}</a><label class="file-label button secondary">${tx("Import backup")}<input type="file" id="import-file" accept=".json,application/json" hidden></label><label>${tx("Import behavior")}<select id="import-mode"><option value="merge">${tx("Merge by ID")}</option><option value="replace">${tx("Replace active workspace (old entries go to trash)")}</option></select></label><button class="button secondary" id="load-backups">${tx("Show recovery backups")}</button></div><div id="backup-list"></div>${legacyEntries().length ? `<button class="text-button" data-migrate>${tx("Import {n} personal entries from the old browser workspace", { n: legacyEntries().length })}</button>` : ""}<p class="hint">${tx("Imports are validated before changes. Merge overwrites matching IDs. Replacing retains old entries in trash. Attachments: 5 MB per file, 20 MB per workspace including trashed files. Images and PDFs are download-only; model chat currently supports text.")}</p></section>`;
}
function renderBrief(id) {
  const record = state.records.find((r) => r.id === id);
  if (!record || record.type !== "idea")
    return empty(tx("Idea not found"), tx("The requested idea could not be found."));
  const notRecorded = tx("Not recorded");
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
  const num = (v) => (Number.isFinite(v) ? fmt.num(v, 2) : null);
  const money = (v) => (num(v) === null ? notRecorded : esc(fmt.money(v, f.currency)));
  const count = (v) => num(v) ?? notRecorded;
  const percent = Number.isFinite(m?.margin) ? fmt.pct(m.margin, 1) : notRecorded;
  const warnings = Array.isArray(m?.warnings)
    ? m.warnings.map((w) => `<li>${esc(w)}</li>`).join("")
    : "";
  return [
    `<a class="text-button brief-back" href="#idea">${tx("Back")}</a>`,
    `<div class="page-heading brief-heading"><h1>${esc(record.title)}</h1><button type="button" class="button secondary" id="print-brief">${tx("Print / save PDF")}</button></div>`,
    section(tx("Stage"), `<p>${text(_a2Stage[record.stage] || record.stage)}</p>`),
    section(tx("Solution"), `<p>${text(f.solution)}</p>`),
    section(tx("Audience"), `<p>${text(f.audience)}</p>`),
    section(tx("Payment"), `<p>${text(f.payment)}</p>`),
    section(tx("Next action"), `<p>${text(f.nextStep)}</p>`),
    m
      ? section(
          tx("Business math"),
          `${line(tx("Contribution"), money(m.contribution))}${line(tx("Margin"), percent)}${line(tx("Break-even units"), count(m.breakEven))}${line(tx("Capacity units"), count(m.capacity))}${line(tx("Profit at capacity"), money(m.profitAtCapacity))}${warnings ? `<ul>${warnings}</ul>` : ""}`,
        )
      : "",
    section(
      tx("Problems"),
      or(
        linked("problem")
          .map(
            (r) =>
              `${source(r)}${line(tx("People"), text(r.fields?.people))}${line(tx("Example"), text(r.fields?.example))}${line(tx("Evidence"), text(r.fields?.evidence))}`,
          )
          .join(""),
      ),
    ),
    section(
      tx("Competitors"),
      or(
        linked("competitor")
          .map(
            (r) =>
              `${source(r)}${line(tx("Pricing"), sourceLinks(r.fields?.pricing))}${line(tx("Sources"), sourceLinks(r.fields?.sources))}`,
          )
          .join(""),
      ),
    ),
    section(
      tx("Experiments"),
      or(
        linked("experiment")
          .map(
            (r) =>
              `${source(r)}${line(tx("Hypothesis"), text(r.fields?.hypothesis))}${line(tx("Success"), text(r.fields?.success))}${line(tx("Decision"), text(r.fields?.decision))}`,
          )
          .join(""),
      ),
    ),
    guesses.length
      ? section(
          tx("Guesses to test"),
          `<p class="hint">${tx("Written by a model or imported from Claude Code. Accepted by the owner, but guesses, not evidence. Test each one with real people before relying on it.")}</p>${guesses.map((r) => `<h3><button type="button" class="text-button" data-edit="${esc(r.id)}">${esc(r.title)}</button> ${originMark(r)}</h3><p class="guess-text">${esc(guessBody(r))}</p>`).join("")}`,
        )
      : "",
  ].join("");
}
function render() {
  const { view, id } = route();
  $("#breadcrumb").textContent = tx("Workspace / {name}", { name: labels[view] || (view === "entry" ? tx("Entry") : view === "review" ? tx("To review") : tx("Brief")) });
  $("#nav").innerHTML = Object.entries(labels)
    .map(
      ([key, label]) =>
        `<a href="#${key}" ${view === key ? 'aria-current="page"' : ""}>${label}${types[key] ? `<span>${entries().filter((r) => r.type === key).length}</span>` : ""}</a>`,
    )
    .join("");
  if (view === "entry") {
    renderEntryRoute(id);
    $("#footer").textContent = tx("Saved in SQLite on this computer · backups exclude API keys");
    return;
  }
  unloadEntry();
  $("#content").hidden = false;
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
              : view === "review"
                ? reviewPage(id)
                : collection(view);
  $("#footer").textContent =
    tx("Saved in SQLite on this computer · backups exclude API keys");
  if (view === "home" && !query && (wantCapture || !matchMedia("(pointer: coarse)").matches) && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
    wantCapture = false;
    focusCapture();
  }
  prefillLocalModels();
  prefillAssistantModel();
}
function syncFields() {
  for (const input of $$("#record-form [data-field]"))
    fieldDraft[input.dataset.field] = input.value;
}
const fieldHome = (key) => (key === "currency" || BUSINESS_MATH_INPUTS.includes(key) ? "math-fields" : key === "researchQueries" ? "research-fields" : "record-fields");
function syncChrome() {
  const idea = $("#record-type").value === "idea";
  $("#record-form").dataset.type = $("#record-type").value;
  $("#doc-menu").open = false;
  $("#brief-button").hidden = !idea;
  $("#founder-review").hidden = !idea;
  $("#layout-edit").hidden = !idea;
  if (!idea) setLayoutEditing(false);
  applyLayout();
}
const fit = (el) => {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
};
function growBody() {
  for (const el of [$("#record-title"), $("#record-body")]) if (!el.hidden) fit(el);
}
function refreshRead(wrap) {
  const input = wrap.querySelector("textarea,input"),
    btn = wrap.querySelector(".rd-btn");
  if (!input || !btn) return;
  const v = input.value.trim();
  btn.textContent = v || btn.dataset.empty;
  btn.classList.toggle("empty", !v);
}
function startEdit(wrap) {
  const input = wrap.querySelector("textarea,input");
  wrap.classList.add("editing");
  input.hidden = false;
  if (input.tagName === "TEXTAREA") fit(input);
  input.focus();
  if (input.type === "text" || input.tagName === "TEXTAREA") input.setSelectionRange(input.value.length, input.value.length);
}
function endEdit(wrap, focusBack) {
  if (!wrap.classList.contains("editing")) return;
  refreshRead(wrap);
  wrap.classList.remove("editing");
  wrap.querySelector("textarea,input").hidden = true;
  if (focusBack) wrap.querySelector(".rd-btn").focus();
}
const fieldShort = { solution: tx("Add what you would create"), audience: tx("Add who would use it"), payment: tx("Add who might pay"), alternatives: tx("Add alternatives and assumptions"), nextStep: tx("Add a next action"), researchQueries: tx("Add a research query"), currency: tx("Add currency"), price: tx("Add price"), variableCost: tx("Add variable cost"), fixedCosts: tx("Add fixed costs"), hoursPerCustomer: tx("Add hours per customer"), availableHours: tx("Add available hours"), useCase: tx("Add what it makes possible"), maturity: tx("Add what you have verified"), risks: tx("Add limitations and risks"), source: tx("Add source links"), people: tx("Add who experiences this"), context: tx("Add when and where"), example: tx("Add an example"), workaround: tx("Add the workaround"), evidence: tx("Add evidence"), unknowns: tx("Add what you still need to learn"), website: tx("Add a website"), facts: tx("Add sourced facts"), pricing: tx("Add pricing"), sources: tx("Add source links"), researchedOn: tx("Add the date"), gaps: tx("Add gaps and opportunities"), hypothesis: tx("Add a hypothesis"), plan: tx("Add a test plan"), success: tx("Add success criteria"), deadline: tx("Add a target date"), results: tx("Add results") };
function fieldMarkup(key, label) {
  const v = fieldDraft[key] || "",
    lid = "fl-" + key,
    bid = "fb-" + key;
  if (key === "decision")
    return `<div class="fld"><span class="fld-label" id="${lid}">${label}</span><select data-field="${key}" aria-labelledby="${lid}">${option("", tx("Not decided"), v)}${[["continue", tx("continue")], ["change direction", tx("change direction")], ["stop", tx("stop")]].map(([x, l]) => option(x, l, v)).join("")}</select></div>`;
  const kind = ["deadline", "researchedOn"].includes(key) ? "date" : key === "currency" ? "text" : BUSINESS_MATH_INPUTS.includes(key) ? "number" : "area",
    input =
      kind === "area"
        ? `<textarea data-field="${key}" rows="2" aria-labelledby="${lid}" hidden>${esc(v)}</textarea>`
        : `<input type="${kind}"${kind === "number" ? ' step="any" min="0"' : ""}${key === "currency" ? ' maxlength="8"' : ""} data-field="${key}" value="${esc(v)}" aria-labelledby="${lid}" hidden>`,
    prompt = fieldShort[key] || tx("Add {what}", { what: label.toLowerCase() });
  return `<div class="fld rd-wrap" data-key="${key}"><span class="fld-label" id="${lid}">${label}</span><button type="button" class="rd-btn${v ? "" : " empty"}" id="${bid}" aria-labelledby="${lid} ${bid}" data-empty="${esc(prompt)}">${esc(v || prompt)}</button>${input}</div>`;
}
function renderFields() {
  const type = $("#record-type").value,
    group = {};
  for (const [key, label] of Object.entries(fieldLabels[type])) (group[fieldHome(key)] ||= []).push(fieldMarkup(key, label));
  for (const id of ["record-fields", "math-fields", "research-fields"]) $("#" + id).innerHTML = (group[id] || []).join("");
  syncChrome();
  renderResearch();
  renderMath();
  renderValidation();
  loadResearch();
  loadSummary();
  renderGlance();
}
function paintCharts(root) {
  for (const el of root.querySelectorAll("[data-css]")) for (const decl of el.dataset.css.split(";")) {
    const [k, v] = decl.split(":");
    if (k && v) el.style.setProperty(k.trim(), v.trim());
  }
}
const pctr = (v) => fmt.pct(v, 0);
const PANEL_FLOOR = 0.2; // matches PANEL_FLOOR in pipeline.cjs
function barRows(rows, floor) {
  return `<ul class="bars">${rows.map((r, i) => `<li class="${r.tone || ""}" data-css="--v:${Math.max(0, Math.min(1, r.v || 0))};--i:${i}"${r.attrs ? " " + r.attrs + ' tabindex="0" role="button"' : ""}><span class="b-label">${esc(r.label)}</span><span class="b-track"><i class="b-fill"></i>${floor === undefined ? "" : `<b class="b-floor" data-css="left:${floor * 100}%"></b>`}</span><span class="b-val">${r.val}</span></li>`).join("")}</ul>`;
}
const dash = { sel: null, selFor: "", open: new Set(), lim: {}, summary: { forId: "", data: null, busy: false, error: "" }, opener: null };
const DRAWER_TITLES = { test: tx("Test run"), research: tx("Research"), numbers: tx("Numbers"), comp: tx("Competition research") };
const KIND_ORDER = ["direct", "indirect", "substitute", "other"];
const KIND_LABEL = { direct: tx("Direct"), indirect: tx("Indirect"), substitute: tx("Substitutes"), other: tx("Added by you") };
const fmtMoney = (n, cur) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : esc(fmt.money(n, cur)));
const fmtCount = (n) => (n === null || n === undefined ? "—" : fmt.num(n));
const ideaJobs = (id, kind) => (state.jobs || []).filter((j) => j.ideaId === id && (kind ? j.kind === kind : j.kind !== "research_pipeline"));
function stageOut(id, name, kind) {
  for (const job of ideaJobs(id, kind)) {
    const st = job.stages.find((s) => s.name === name && s.output);
    if (st) return { job, out: st.output };
  }
  return null;
}
const REASON_FALLBACK = "This step did not finish.";
const PLAIN_REASONS = ["Spark reached the model call limit for this test.","The model took too long to answer.","Paper search isn't reachable right now. Retry in a minute.","The local model server isn't running. Start Ollama, then retry.","Couldn't reach OpenAI. Check your connection, then retry.","Couldn't reach Anthropic. Check your connection, then retry.","Couldn't reach Gemini. Check your connection, then retry.","That model isn't available. Check the model in Settings, then retry.","The model provider rejected the key. Check Settings.","The model service was too busy to answer.","The model's answer could not be read.","The model sent back nothing.","Spark could not reach the model.","A model or key is missing in Settings.","No papers were found for these searches.","This step did not finish."];
const plainReason = (text) => tx(PLAIN_REASONS.includes(text) ? text : REASON_FALLBACK);
const _a3FriendlyRaw = (message) => /^(Choose|Search limit|Run an|The summary is already|A test is running|This test is still|That step is not|Spark is shutting|Job not found|Idea not found|Enter|Include|Write|Answer)/.test(String(message));
const friendlyError = (message) => (_a3FriendlyRaw(message) ? tx(String(message)) : tx("That did not work this time. Try again in a moment."));
const retrying = new Set();
const retryKey = (jobId, stage) => jobId + "|" + stage;
function stageProblem(j, st) {
  if (!j || !st) return null;
  if (st.status === "failed") return { kind: "failed", reason: plainReason(st.reason), stage: st.name, name: st.name };
  if (st.status === "done" && st.output?.incomplete) return { kind: "incomplete", final: !!st.output.incomplete.final, reason: st.output.incomplete.reason ? tx(st.output.incomplete.reason) : "", stage: st.output.incomplete.stage || st.name, hint: st.output.incomplete.action || "", name: st.name };
  if (st.status === "done" && st.stale) return { kind: "stale", reason: tx("Built on older {stage} results.", { stage: (STAGE_LABELS[st.stale.by] || st.stale.by).toLowerCase() }), stage: st.name, name: st.name };
  return null;
}
function retryNote(j, p, titled) {
  if (!j || !p) return "";
  if (p.final) return `<div class="retry-note ${p.kind}"><p>${titled ? `<b>${esc(STAGE_LABELS[p.name] || p.name)}.</b> ` : ""}${esc(p.reason)}</p></div>`;
  const busy = retrying.has(retryKey(j.id, p.stage)) || ["queued", "running"].includes(j.status),
    label = p.kind === "stale" ? tx("Update from new results") : p.hint === "Re-estimate" ? tx("Re-estimate") : tx("Retry this step");
  return `<div class="retry-note ${p.kind}"><p>${titled ? `<b>${esc(STAGE_LABELS[p.name] || p.name)}.</b> ` : ""}${esc(p.reason)}</p><button type="button" class="button secondary" data-retry="${esc(j.id)}" data-retry-stage="${esc(p.stage)}"${p.hint ? ` title="${esc(tx(p.hint))}"` : ""}${busy ? " disabled" : ""}>${busy ? tx("Working…") : label}</button></div>`;
}
function cardRetry(id, name, kind) {
  const j = ideaJobs(id, kind)[0];
  return retryNote(j, stageProblem(j, j?.stages.find((s) => s.name === name)));
}
function jobProblem(j) {
  if (j.status === "failed") {
    const st = j.stages.find((s) => s.status === "failed");
    return st ? `${STAGE_LABELS[st.name] || st.name}: ${plainReason(st.reason)}` : tx(REASON_FALLBACK);
  }
  return j.status === "stopped" && /^Interrupted when Spark stopped/.test(j.error || "") ? tx(j.error) : "";
}
async function retryStage(jobId, stage) {
  const key = retryKey(jobId, stage);
  retrying.add(key);
  renderDash();
  try {
    await api(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST", data: { stage } });
    await refresh(false);
    if (entryVisible()) renderValidation(), loadResearch(true);
    renderAsks();
    toast(tx("Trying again. You can leave this page; it keeps running."));
  } catch (e) {
    toast(friendlyError(e.message));
  } finally {
    retrying.delete(key);
    renderDash();
    if (entryVisible()) renderValidation();
  }
}
const CFO_FIELDS = ["price", "variableCost", "fixedCosts", "hoursPerCustomer", "availableHours"];
function fieldsToUse(cfo) {
  const out = {};
  for (const k of cfo?.assumed || []) if (parseAmount(fieldDraft[k]).blank && cfo.assumptions?.[k]) out[k] = String(cfo.assumptions[k].value);
  return out;
}
function cfoOutdated(cfo) {
  for (const k of CFO_FIELDS) {
    const p = parseAmount(fieldDraft[k]),
      need = ["price", "hoursPerCustomer", "availableHours"].includes(k),
      usable = !p.blank && p.n >= 0 && (!need || p.n > 0);
    if (k === "price") {
      const was = cfo.atOwnPrice?.price ?? null;
      if (usable ? was !== p.n : was !== null) return true;
    } else if (usable ? cfo.inputs?.[k] !== p.n : cfo.source?.[k] === "yours") return true;
  }
  return false;
}
async function useNumbers() {
  const found = stageOut($("#record-id").value, "cfo"),
    use = fieldsToUse(found?.out);
  if (!Object.keys(use).length) return;
  for (const [k, v] of Object.entries(use)) {
    fieldDraft[k] = v;
    const input = $(`#record-form [data-field="${k}"]`);
    if (input) input.value = v;
  }
  try {
    await saveRecord();
    toast(tx("Your numbers were filled in from the assumptions. Edit any of them."));
  } catch (e) {
    toast(friendlyError(e.message));
  }
  renderMath();
  renderDash();
}
function limited(key, items, render, first = 10, step = 10) {
  const n = dash.lim[key] ?? first,
    shown = items.slice(0, n),
    controls = items.length > first ? `<div class="more-row"><span class="hint">${tx("Showing {shown} of {total}", { shown: shown.length, total: items.length })}</span>${items.length > n ? `<button type="button" class="button secondary" data-more="${key}" data-first="${first}" data-step="${step}">${tx("Show {n} more", { n: Math.min(step, items.length - n) })}</button>` : ""}${n > first ? `<button type="button" class="button secondary" data-less="${key}" data-first="${first}" data-step="${step}">${tx("Show less")}</button>` : ""}</div>` : "";
  return { html: shown.map(render).join(""), controls };
}
function fill(id, html) {
  let el = $("#" + id);
  if (el?.classList.contains("card")) el = el.querySelector(".card-c");
  if (!el || el._html === html) return;
  el._html = html;
  el.innerHTML = html;
  paintCharts(el);
  for (const d of el.querySelectorAll("details[data-key]")) d.open = dash.open.has(d.dataset.key);
}
function renderMeta() {
  const el = $("#entry-glance"),
    rec = state.records.find((r) => r.id === $("#record-id").value);
  if (!el) return;
  if (!rec || $("#record-type").value === "idea") {
    el.innerHTML = "";
    return;
  }
  const n = $("#record-links").selectedOptions.length;
  el.innerHTML = `<div class="g-cell"><dt>${tx("Created")}</dt><dd>${esc(date(rec.created) || "—")}</dd></div><div class="g-cell"><dt>${tx("Updated")}</dt><dd>${esc(date(rec.updated) || "—")}</dd></div><div class="g-cell"><dt>${tx("Links")}</dt><dd>${n}</dd></div>`;
}
function renderGlance() {
  renderMeta();
  renderDash();
}
function renderDash() {
  const id = $("#record-id").value,
    idea = id && $("#record-type").value === "idea" ? state.records.find((r) => r.id === id) : null;
  if (!idea) return;
  dash.cmapW ||= Math.round(($("#card-comp .card-c")?.clientWidth || 0) / 16) * 16 || undefined;
  fill("card-kpis", heroKpis(idea));
  fill("card-hero", heroCard(idea));
  fill("card-charts", chartsCard(idea));
  fill("card-numbers", numbersCard(idea));
  fill("card-timeline", timelineCard(idea));
  fill("card-comp", compCard(idea));
  fill("card-research", researchCard(idea));
  fill("outputs-panel", outputsPanel(idea));
  imSync(idea);
  imRender();
  if (dash.selFor === id) showSeg(dash.sel, false);
}

async function loadSummary() {
  const id = $("#record-id").value;
  if (!id || $("#record-type").value !== "idea") return;
  const s = dash.summary;
  if (s.forId !== id) Object.assign(s, { forId: id, data: null, busy: false, error: "" });
  try {
    const d = await api(`/api/ideas/${encodeURIComponent(id)}/summary`);
    if (s.forId === id) s.data = d;
  } catch (e) {
    s.error = e.message;
  }
  renderDash();
}
async function writeSummary(force) {
  const id = $("#record-id").value,
    s = dash.summary;
  if (!id || s.busy) return;
  s.busy = true;
  s.error = "";
  renderDash();
  try {
    const d = await api(`/api/ideas/${encodeURIComponent(id)}/summary`, { method: "POST", data: { force } });
    if (s.forId === id) s.data = d;
    await refresh(false);
  } catch (e) {
    s.error = _a3FriendlyRaw(e.message) ? tx(String(e.message)) : tx("The summary did not get written this time.");
  } finally {
    s.busy = false;
    renderDash();
  }
}

const SUMMARY_PARTS = [["signal", tx("Strongest signal")], ["risk", tx("Biggest risk")]],
  SUMMARY_MORE = [["numbers", tx("The numbers")], ["competitors", tx("Competitors to watch")]];
function kpi(label, value, sub, pane, tone = "") {
  return `<button type="button" class="kpi ${tone}" data-drawer="${pane}"><span class="kpi-l">${label}</span><strong>${value}</strong><span class="kpi-s">${sub}</span></button>`;
}
function heroKpis(idea) {
  const cur = (fieldDraft.currency || "").trim(),
    board = stageOut(idea.id, "board")?.out,
    panel = stageOut(idea.id, "panel")?.out,
    pricing = stageOut(idea.id, "pricing")?.out,
    m = businessMath(fieldDraft),
    sim = liveSim(pricing),
    out = [];
  if (board?.votes?.length) {
    const fund = board.votes.filter((v) => v.startsWith("FUND")).length,
      scores = board.scores.filter((x) => Number.isFinite(x)),
      avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    out.push(kpi(tx("Board"), tx("{fund} of {total} fund", { fund, total: board.votes.length }), avg === null ? tx("no scores") : tx("avg {avg} of 10", { avg: fmt.num(avg, 1) }), "test", fund === 0 ? "bad" : ""));
  } else out.push(kpi(tx("Board"), tx("Not run"), tx("Test this idea"), "test", "muted"));
  if (panel) out.push(kpi(tx("Buy rate"), panel.inconclusive ? tx("Inconclusive") : tx("{pct} yes", { pct: esc(pctr(panel.targetRate)) }), `${esc(panel.targetSegment)} · ${esc(tp("{n} buyer|{n} buyers", panel.answered))}`, "test", panel.inconclusive || panel.targetRate < PANEL_FLOOR ? "bad" : "ok"));
  else out.push(kpi(tx("Buy rate"), tx("Not run"), tx("Panel of buyers"), "test", "muted"));
  const cfo = stageOut(idea.id, "cfo")?.out,
    price = pricing?.suggested ?? cfo?.testPrice,
    from = pricing?.suggested !== null && pricing?.suggested !== undefined ? pricing.suggestedFrom : "assumed";
  out.push(price !== null && price !== undefined ? kpi(tx("Test price"), fmtMoney(price, cur), from === "assumed" ? tx("assumed by the CFO") : from === "competitors" ? tx("from competitor prices") : from === "pitched" ? tx("the price you pitched") : from === "yours" ? tx("your own price") : Number.isFinite(pricing.range?.[0]) ? tx("range {from} to {to}", { from: fmtMoney(pricing.range[0], cur), to: fmtMoney(pricing.range[1], cur) }) : tx("buyers' answers were thin"), "numbers") : kpi(tx("Test price"), tx("Not yet"), tx("Run the test to get one"), "test", "muted"));
  const mm = cfo ? cfo.atOwnPrice || cfo.atTestPrice : m.margin !== null ? m : sim && sim.margin !== null ? sim : null,
    flags = mm?.flags || mm?.warnings || [];
  out.push(mm ? kpi(mm === m ? tx("Margin per sale") : cfo ? (cfo.atOwnPrice ? tx("Margin per sale") : tx("Margin per sale at test price")) : tx("Margin per sale at test price"), formatMargin(mm.margin), (mm.breakEven !== null && mm.capacity !== null ? tx("break-even {be} of {cap}", { be: fmtCount(mm.breakEven), cap: fmtCount(mm.capacity) }) : mm.breakEven !== null ? tx("break-even {be}", { be: fmtCount(mm.breakEven) }) : tx("each sale loses money")) + (cfo?.check ? " · " + tx("check these numbers") : cfo?.assumed?.length ? " · " + tx("assumed inputs") : ""), "numbers", cfo?.check ? "muted" : flags.length ? "bad" : "ok") : kpi(tx("Margin"), tx("Not yet"), tx("Test the idea to work it out"), "test", "muted"));
  return `<div class="kpis">${out.join("")}</div>`;
}
function heroCard(idea) {
  const id = idea.id,
    s = dash.summary,
    d = s.forId === id ? s.data : null,
    sm = d?.summary,
    asks = (state.jobs || []).filter((j) => j.ideaId === id && j.kind !== "research_pipeline" && j.status === "waiting_user"),
    working = ideaJobs(id).find((j) => ["queued", "running"].includes(j.status)),
    failed = [...ideaJobs(id), ...ideaJobs(id, "research_pipeline")].find((j) => j.summaryError && !j.summary),
    ready = !!(state.assistant.planner?.model && state.assistant.writer?.model),
    when = sm?.at ? fmt.date(sm.at) : "";
  let body;
  if (!d && !s.error) body = `<p class="skeleton-line">${tx("Loading the summary…")}</p>`;
  else if (s.busy || (working && working.stage === "summary")) body = `<p class="working" role="status"><span class="dots" aria-hidden="true"></span>${tx("Writing the summary from the pipeline results…")}</p>`;
  else if (!d?.ready) body = `<p class="lead muted">${tx("Nothing tested yet.")}</p><p class="hint">${tx("Run the idea test and Spark writes a short summary of what the pipelines learned.")}</p><div class="config-actions"><button type="button" class="button primary" data-drawer="test">${ready ? tx("Test this idea") : tx("Open test run")}</button></div>`;
  else if (!sm) body = `<p class="lead muted">${tx("No summary yet.")}</p><p class="hint">${failed ? esc(tx("The summary did not get written. {reason}", { reason: plainReason(failed.summaryError) })) : tx("The pipelines have results. Write a short summary of them.")}</p><div class="config-actions"><button type="button" class="button primary" data-summary="1"${ready ? "" : " disabled"}>${failed ? tx("Retry this step") : tx("Write the summary")}</button></div>`;
  else {
    const sec = sm.sections;
    body = sec
      ? `<p class="lead">${esc(sec.verdict)}</p><dl class="sum">${SUMMARY_PARTS.map(([k, l]) => `<div><dt>${l}</dt><dd>${esc(sec[k])}</dd></div>`).join("")}</dl><details class="more sum-more" data-key="sum-more"><summary>${tx("The numbers and the competitors")}</summary><dl class="sum">${SUMMARY_MORE.map(([k, l]) => `<div><dt>${l}</dt><dd>${esc(sec[k])}</dd></div>`).join("")}</dl></details><div class="next-step"><span>${tx("Next step")}</span><p>${esc(sec.next)}</p></div>`
      : `<p class="lead sum-plain">${esc(sm.text).replace(/\n+/g, "<br>")}</p>`;
  }
  const stale = sm && d && !d.current && !s.busy,
    ask = asks.length ? `<div class="alert-row"><span><b>${tx("Spark is waiting for you")}</b>${asks[0].waiting?.kind === "grill" ? " " + tx("with a few questions") : ""}.</span><button type="button" class="button primary" data-drawer="test">${tx("Answer")}</button></div>` : "",
    foot = sm ? `<span class="card-meta">${esc(sm.model)}${sm.localOnly ? " · " + tx("local only") : ""}${when ? " · " + esc(when) : ""}${stale ? ` · <span class="stale">${tx("results changed since")}</span>` : ""}</span>` : "";
  return `<header class="card-h"><h2>${tx("What the pipelines found")}</h2><span class="by-simulation">${tx("Simulated")}</span>${foot}<span class="card-tools">${sm || d?.ready ? `<button type="button" class="button secondary" data-summary="force"${s.busy || working ? " disabled" : ""}>${s.busy ? tx("Writing…") : tx("Regenerate")}</button>` : ""}</span></header>${s.error ? `<div class="retry-note failed"><p>${esc(tx(s.error))}</p><button type="button" class="button secondary" data-summary="force"${s.busy || working ? " disabled" : ""}>${tx("Retry this step")}</button></div>` : ""}${ask}${body}`;
}

function segDetail(o, i) {
  if (!o) return "";
  const all = i === -1 || i === null || i === undefined || !o.bySegment[i],
    x = all ? null : o.bySegment[i],
    yes = all ? Math.round(o.buyRate * o.answered) : (x.yes ?? Math.round(x.buyRate * x.buyers)),
    total = all ? o.answered : x.buyers,
    reasons = (!all && x.reasons?.length ? x.reasons : o.objections || []).slice(0, 3),
    own = !all && x.reasons?.length;
  return `<p><strong>${esc(all ? tx("All buyers") : x.group)}</strong> <span class="seg-count">${tx("{yes} yes · {no} no · {pct}", { yes, no: total - yes, pct: esc(pctr(total ? yes / total : 0)) })}</span></p>${!all && x.group === o.targetSegment ? `<p class="hint">${tx("Target segment. The gate is {pct} yes.", { pct: pctr(PANEL_FLOOR) })}</p>` : ""}${reasons.length ? `<p class="seg-h">${own ? tx("Top reasons to pass here") : tx("Top reasons to pass")}</p><ol class="why">${reasons.map((r) => `<li>${esc(r.text)} <small>${esc(r.count)}</small></li>`).join("")}</ol>` : `<p class="hint">${tx("No reasons recorded.")}</p>`}`;
}
function showSeg(i, pin) {
  const box = $("#seg-detail");
  if (!box) return;
  const hit = stageOut(dash.selFor, "panel")?.out;
  if (pin) dash.sel = dash.hl = i;
  for (const sq of $$("#card-charts .bsq")) sq.classList.toggle("dim", dash.hl >= 0 && Number(sq.dataset.bseg) !== dash.hl);
  box.innerHTML = segDetail(hit, i ?? dash.sel);
  for (const li of $$("#card-charts [data-seg]")) li.classList.toggle("is-sel", Number(li.dataset.seg) === (i ?? dash.sel));
}
function panelChart(j) {
  const o = j?.stages?.find((st) => st.name === "panel")?.output;
  if (!o?.bySegment?.length) return "";
  const rows = [{ label: tx("All buyers"), v: o.buyRate, val: `${pctr(o.buyRate)} <small>${tx("of {n}", { n: esc(o.answered) })}</small>`, tone: "all", attrs: 'data-seg="-1"' }, ...o.bySegment.map((x, i) => ({ label: x.group, v: x.buyRate, val: `${pctr(x.buyRate)} <small>${tx("of {n}", { n: esc(x.buyers) })}</small>`, tone: x.group === o.targetSegment ? "target" : "", attrs: `data-seg="${i}"` }))];
  return `<figure class="chart"><figcaption><h3>${tx("Would they buy?")}</h3><p class="hint">${tx("Yes-rate by segment. Hover or tap a bar. The dashed line is the {pct} gate.", { pct: pctr(PANEL_FLOOR) })}</p></figcaption>${barRows(rows, PANEL_FLOOR)}<div id="seg-detail" class="seg-detail" aria-live="polite"></div>${o.inconclusive ? `<p class="gate">${tx("Inconclusive: fewer than half the buyers answered.")}</p>` : ""}</figure>`;
}
// One square per simulated buyer. Green: a yes they are fairly sure of. Yellow: unsure either way (confidence 1 or 2 of 5), or a no that named what would change it. Red: a no they are sure of.
const BUYER_TONES = { buy: tx("would buy"), maybe: tx("on the fence"), no: tx("would not buy") };
function buyerTone(b) {
  if (Number(b.confidence) <= 2 || (b.buys !== "yes" && String(b.wouldFlipIf || "").trim())) return "maybe";
  return b.buys === "yes" ? "buy" : "no";
}
// Per-buyer rows are not in the job list; they are fetched once for the job on screen.
function loadBuyers(job) {
  const key = job.id + job.updated;
  if (dash.buyers?.key === key) return dash.buyers.list;
  dash.buyers = { key, list: [] };
  api("/api/jobs/" + encodeURIComponent(job.id))
    .then((full) => {
      if (dash.buyers.key !== key || !full.buyers?.length) return;
      dash.buyers.list = full.buyers;
      renderDash();
    })
    .catch(() => {});
  return dash.buyers.list;
}
function panelBuyers(o, buyers = dash.buyers?.list) {
  if (!o || !buyers?.length) return [];
  const segs = (o.bySegment || []).map((x) => x.group),
    rank = { buy: 0, maybe: 1, no: 2 };
  return buyers.map((b) => ({ ...b, tone: buyerTone(b), seg: segs.indexOf(b.segment) })).sort((a, b) => a.seg - b.seg || rank[a.tone] - rank[b.tone] || String(a.id).localeCompare(String(b.id)));
}
function buyerGrid(o, buyers) {
  const list = panelBuyers(o, buyers);
  if (!list.length) return "";
  const n = (t) => list.filter((b) => b.tone === t).length,
    counts = tx("{buy} buy · {maybe} maybe · {no} no", { buy: n("buy"), maybe: n("maybe"), no: n("no") }),
    runs = [...new Set(list.map((x) => x.segment))].map((seg) => tx("{seg} {from} to {to}", { seg: esc(seg), from: list.findIndex((x) => x.segment === seg) + 1, to: list.findLastIndex((x) => x.segment === seg) + 1 }));
  return `<figure class="chart buyers"><figcaption><h3>${tx("Every simulated buyer")}</h3><details class="menu binfo"><summary aria-label="${tx("How the colours are decided")}" title="${tx("How the colours are decided")}"><span>i</span></summary><div class="menu-list"><p>${tx("Buy: a yes with confidence 3 or more of 5.")}</p><p>${tx("Maybe: confidence 1 or 2 either way, or a no that named what would change it.")}</p><p>${tx("No: a no with confidence 3 or more.")}</p><p>${tx("Squares run down each column, grouped by segment. Tap a segment bar above to highlight its buyers.")}</p></div></details><p class="hint">${tx("One square per buyer. Pick one to read their answer.")}</p></figcaption><div class="bwrap"><div class="bgrid" role="group" aria-label="${tx("Simulated buyers: {counts}", { counts })}" data-css="--rows:${Math.ceil(Math.sqrt(list.length))};--cols:${Math.ceil(list.length / Math.ceil(Math.sqrt(list.length)))}">${list
    .map((b, i) => `<button type="button" class="bsq t-${b.tone}" data-buyer="${i}" data-bseg="${b.seg}" tabindex="${i ? -1 : 0}" aria-describedby="buyer-pop" aria-label="${tx("Buyer {n}, {seg}, {tone}", { n: i + 1, seg: esc(b.segment), tone: BUYER_TONES[b.tone] })}"></button>`)
    .join("")}</div><div class="bside"><p class="legend bkey" aria-label="${counts}"><span class="t-buy">${tx("{n} buy", { n: n("buy") })}</span><span class="t-maybe">${tx("{n} maybe", { n: n("maybe") })}</span><span class="t-no">${tx("{n} no", { n: n("no") })}</span></p><p class="bsegs">${runs.join(" · ")}</p></div></div><div id="buyer-pop" class="bpop" role="tooltip" aria-live="polite" hidden></div></figure>`;
}
function buyerPop(b, i, cur) {
  const money = (v) => fmt.money(Number(v), cur),
    who = [[b.name, b.age].filter(Boolean).join(", "), b.segment, Number.isFinite(b.income) ? tx("about {amount} a year", { amount: money(b.income) }) : "", b.behaviour].filter(Boolean),
    verdict = b.tone === "buy" ? tx("Would buy") : b.tone === "no" ? tx("Would not buy") : b.buys === "yes" ? tx("Would buy, but unsure") : Number(b.confidence) <= 2 ? tx("Would not buy, but unsure") : tx("Would not buy, could change"),
    conf = Math.min(5, Math.max(1, Number(b.confidence) || 3)),
    prices = b.prices && [[tx("Too cheap"), "tooCheap"], [tx("A bargain"), "bargain"], [tx("Getting expensive"), "expensive"], [tx("Too expensive"), "tooExpensive"]].filter(([, k]) => Number.isFinite(Number(b.prices[k])));
  return `<p class="bpop-h"><strong>${tx("Buyer {n}", { n: i + 1 })}</strong><span class="bverdict t-${b.tone}">${verdict}</span></p><p class="bpop-who">${esc(who.join(" · "))}</p><p class="bpop-conf">${tx("Confidence {n} of 5", { n: conf })}<span class="bconf" aria-hidden="true">${[1, 2, 3, 4, 5].map((k) => `<i${k <= conf ? ' class="on"' : ""}></i>`).join("")}</span></p><blockquote>${esc(b.reason || tx("No reason given."))}</blockquote><p class="bpop-flip"><span>${tx("What would change their mind")}</span>${esc(String(b.wouldFlipIf || "").trim() || tx("They did not say."))}</p>${prices?.length ? `<dl class="bprices">${prices.map(([l, k]) => `<div><dt>${l}</dt><dd>${esc(money(b.prices[k]))}</dd></div>`).join("")}</dl>` : ""}`;
}
function showBuyer(btn, pin) {
  const fig = btn.closest(".buyers"),
    pop = fig.querySelector(".bpop"),
    i = Number(btn.dataset.buyer),
    buyer = panelBuyers(stageOut(dash.selFor, "panel")?.out)[i];
  if (!buyer) return;
  if (pin) fig.dataset.pin = String(i);
  pop.innerHTML = buyerPop(buyer, i, (fieldDraft.currency || "").trim());
  pop.hidden = false;
  for (const x of fig.querySelectorAll(".bsq.is-on")) x.classList.remove("is-on");
  btn.classList.add("is-on");
  const wrap = fig.querySelector(".bwrap");
  if (matchMedia("(max-width: 760px)").matches) pop.style.removeProperty("top");
  else pop.style.setProperty("top", wrap.offsetTop + wrap.offsetHeight + 8 + "px");
}
function hideBuyer(fig) {
  if (!fig) return;
  delete fig.dataset.pin;
  fig.querySelector(".bpop").hidden = true;
  for (const x of fig.querySelectorAll(".bsq.is-on")) x.classList.remove("is-on");
}
document.addEventListener("mouseover", (event) => {
  const sq = event.target.closest?.(".bsq");
  if (sq && sq.closest(".buyers").dataset.pin === undefined) showBuyer(sq);
});
document.addEventListener("mouseout", (event) => {
  const grid = event.target.closest?.(".bgrid");
  if (grid && !grid.contains(event.relatedTarget) && grid.closest(".buyers").dataset.pin === undefined && !grid.contains(document.activeElement)) hideBuyer(grid.closest(".buyers"));
});
document.addEventListener("focusin", (event) => {
  const sq = event.target.closest?.(".bsq");
  if (!sq) return;
  for (const x of sq.parentNode.querySelectorAll('.bsq[tabindex="0"]')) x.tabIndex = -1;
  sq.tabIndex = 0;
  if (sq.closest(".buyers").dataset.pin === undefined) showBuyer(sq);
});
document.addEventListener("focusout", (event) => {
  const grid = event.target.closest?.(".bgrid");
  if (grid && !grid.contains(event.relatedTarget)) hideBuyer(grid.closest(".buyers"));
});
document.addEventListener("click", (event) => {
  const sq = event.target.closest?.(".bsq"),
    open = document.querySelector(".buyers[data-pin]");
  if (sq) {
    const fig = sq.closest(".buyers");
    if (fig.dataset.pin === sq.dataset.buyer) hideBuyer(fig);
    else showBuyer(sq, true);
  } else if (open) hideBuyer(open);
});
document.addEventListener("keydown", (event) => {
  const sq = event.target.closest?.(".bsq");
  if (!sq) return;
  // Squares fill columns top to bottom, so the arrows follow where a square sits, not its order in the markup.
  const all = [...sq.parentNode.querySelectorAll(".bsq")],
    step = (dx, dy) => {
      const lines = [...new Set(all.map((x) => (dx ? x.offsetLeft : x.offsetTop)))].sort((p, q) => p - q),
        to = lines[lines.indexOf(dx ? sq.offsetLeft : sq.offsetTop) + (dx || dy)],
        line = all.filter((x) => (dx ? x.offsetLeft : x.offsetTop) === to);
      return line.length ? line.reduce((best, x) => (Math.abs((dx ? x.offsetTop : x.offsetLeft) - (dx ? sq.offsetTop : sq.offsetLeft)) < Math.abs((dx ? best.offsetTop : best.offsetLeft) - (dx ? sq.offsetTop : sq.offsetLeft)) ? x : best)) : null;
    },
    next = { ArrowRight: step(1, 0), ArrowLeft: step(-1, 0), ArrowDown: step(0, 1), ArrowUp: step(0, -1), Home: all[0], End: all.at(-1) }[event.key];
  if (event.key === "Escape" && !sq.closest(".buyers").querySelector(".bpop").hidden) {
    event.stopPropagation();
    hideBuyer(sq.closest(".buyers"));
  } else if (next) {
    event.preventDefault();
    delete sq.closest(".buyers").dataset.pin;
    next.focus();
  } else if (event.key in { ArrowRight: 1, ArrowLeft: 1, ArrowDown: 1, ArrowUp: 1 }) event.preventDefault();
}, true);
function chartsCard(idea) {
  const p = stageOut(idea.id, "panel"),
    pr = stageOut(idea.id, "pricing");
  if (dash.selFor !== idea.id) Object.assign(dash, { hl: -1, selFor: idea.id, sel: p ? Math.max(0, p.out.bySegment.findIndex((x) => x.group === p.out.targetSegment)) : -1 });
  const left = p ? panelChart(p.job) : "",
    right = pr ? priceChart(pr.job) : "",
    issues = cardRetry(idea.id, "panel") + (cardRetry(idea.id, "pricing") && !cardRetry(idea.id, "panel").includes('data-retry-stage="panel"') ? cardRetry(idea.id, "pricing") : "");
  return `<header class="card-h"><h2>${tx("Evidence from the panel")}</h2><span class="by-simulation">${tx("Simulated")}</span><span class="card-tools"><button type="button" class="button secondary" data-drawer="test">${tx("Full results")}</button></span></header>${issues}${left || right ? `<div class="chart-pair">${left}${right}</div>${p ? buyerGrid(p.out, loadBuyers(p.job)) : ""}` : `<p class="lead muted">${tx("No charts yet.")}</p><p class="hint">${tx("The buyer panel and price range appear here once the test reaches them.")}</p>`}`;
}

function mathCharts(m, src = fieldDraft) {
  const cur = (fieldDraft.currency || "").trim(),
    price = parseAmount(src.price).n,
    cost = parseAmount(src.variableCost).n;
  let split = "",
    need = "";
  if (m.contribution !== null && price > 0) {
    const vShare = Math.min(1, cost / price),
      loses = m.contribution <= 0;
    split = `<figure class="chart"><figcaption><h3>${tx("Where each sale goes")}</h3></figcaption><div class="stack" role="img" aria-label="${tx("Of {price} per sale, {cost} is variable cost and {contribution} is contribution", { price: fmtMoney(price, cur), cost: fmtMoney(Math.min(cost, price), cur), contribution: fmtMoney(Math.max(0, m.contribution), cur) })}"><i class="s-var" data-css="flex:${vShare}"></i><i class="s-con${loses ? " bad" : ""}" data-css="flex:${Math.max(0.0001, 1 - vShare)}"></i></div><p class="stack-key"><span><i class="k-var"></i>${tx("Cost {amount}", { amount: fmtMoney(cost, cur) })}</span><span><i class="k-con${loses ? " bad" : ""}"></i>${tx("Kept {amount}", { amount: fmtMoney(m.contribution, cur) })}${m.margin === null ? "" : " · " + formatMargin(m.margin)}</span></p></figure>`;
  }
  if (m.breakEven !== null || m.capacity !== null) {
    const top = Math.max(m.breakEven || 0, m.capacity || 0) || 1,
      short = m.breakEven !== null && m.capacity !== null && m.breakEven > m.capacity,
      rows = [];
    if (m.breakEven !== null) rows.push({ label: tx("Break-even"), v: m.breakEven / top, val: `${fmtCount(m.breakEven)}`, tone: short ? "bad" : "all" });
    if (m.capacity !== null) rows.push({ label: tx("Capacity"), v: m.capacity / top, val: `${fmtCount(m.capacity)}`, tone: short ? "" : "ok" });
    need = `<figure class="chart"><figcaption><h3>${tx("Customers needed vs. you can serve")}</h3><p class="hint">${tx("Per period.")}</p></figcaption>${barRows(rows)}</figure>`;
  }
  return split + need;
}
const _a4Needed = (m) => {
  const names = (l) => l.map((k) => tx(MATH_NAMES[k] || k)).join(", ");
  return [m.missing.length ? tx("Still needed: {list}.", { list: names(m.missing) }) : "", m.invalid.length ? tx("Cannot be negative: {list}.", { list: names(m.invalid) }) : ""].filter(Boolean).join(" ");
};
const _a4MapSummary = (v) => {
  const m = String(v || "").match(/^(\d+) themes?, (\d+) gaps? from (\d+) papers?\.$/);
  return m ? tx("{themes}, {gaps} from {papers}.", { themes: tp("{n} theme|{n} themes", +m[1]), gaps: tp("{n} gap|{n} gaps", +m[2]), papers: tp("{n} paper|{n} papers", +m[3]) }) : tx(String(v || ""));
};
function liveSim(pr) {
  return pr && pr.suggested !== null && pr.suggested !== undefined ? businessMath({ ...fieldDraft, price: String(pr.suggested) }) : null;
}
function ownNumbersCard(idea, issue) {
  const cur = (fieldDraft.currency || "").trim(),
    m = businessMath(fieldDraft),
    pr = stageOut(idea.id, "pricing")?.out,
    sim = liveSim(pr),
    cols = [[tx("Your numbers"), m]];
  if (sim) cols.push([tx("At the test price {price}", { price: fmtMoney(pr.suggested, cur) }), sim]);
  const rows = [[tx("Kept per sale"), (x) => fmtMoney(x.contribution, cur)], [tx("Margin"), (x) => (x.margin === null ? "—" : formatMargin(x.margin))], [tx("Break-even"), (x) => fmtCount(x.breakEven)], [tx("Capacity"), (x) => fmtCount(x.capacity)], [tx("Profit at capacity"), (x) => fmtMoney(x.profitAtCapacity, cur)]];
  const table = `<table class="mtab"><thead><tr><th scope="col"><span class="sr-only">${tx("Figure")}</span></th>${cols.map(([l]) => `<th scope="col">${l}</th>`).join("")}</tr></thead><tbody>${rows.map(([l, f]) => `<tr><th scope="row">${l}</th>${cols.map(([, x]) => `<td>${f(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const cta = _a4Needed(m) ? `<div class="alert-row num-cta"><span><b>${m.missing.length ? tp("Add {n} more number to fill this in.|Add {n} more numbers to fill this in.", m.missing.length) : tx("Check your numbers.")}</b> ${esc(_a4Needed(m))}</span><button type="button" class="button secondary" data-drawer="numbers">${m.missing.length === 1 ? tx("Add {name}", { name: esc(MATH_NAMES[m.missing[0]]) }) : tx("Add numbers")}</button></div>` : "";
  const simMissing = sim && _a4Needed(sim) && sim.missing.some((k) => !m.missing.includes(k)) ? `<div class="alert-row num-cta"><span><b>${sim.missing.length === 1 ? tx("The test price column needs one more number.") : tx("The test price column needs {n} more numbers.", { n: sim.missing.length })}</b> ${esc(_a4Needed(sim))}</span><button type="button" class="button secondary" data-drawer="numbers">${sim.missing.length === 1 ? tx("Add {name}", { name: esc(MATH_NAMES[sim.missing[0]] || tx("it")) }) : tx("Add numbers")}</button></div>` : "";
  const ownPrice = parseAmount(fieldDraft.price),
    priceNote = sim && pr.suggested !== null && !ownPrice.blank && ownPrice.n > 0 && ownPrice.n !== pr.suggested ? `<p class="hint">${tx("Your price is {own}. The test price {test} is what the simulated buyers suggested; the second column shows your costs at that price. Your price field is untouched.", { own: fmtMoney(ownPrice.n, cur), test: fmtMoney(pr.suggested, cur) })}</p>` : "";
  const notes = [...new Set([...m.warnings.map((w) => tx(w)), ...(sim ? sim.warnings.map((w) => tx("At the test price: {warning}", { warning: tx(w) })) : [])].filter(Boolean))];
  const bad = m.warnings.length || sim?.warnings?.length;
  const offer = `<div class="config-actions"><button type="button" class="button primary" data-drawer="test">${tx("Test this idea")}</button></div><p class="hint">${tx("The test works out margin, break-even, year 1 and the cash you need, and estimates anything you have not entered, clearly marked as an assumption.")}</p>`;
  if (m.missing.length === 5 && !m.invalid.length && (!sim || (sim.contribution === null && sim.breakEven === null && sim.capacity === null))) return `<header class="card-h"><h2>${tx("Numbers")}</h2><span class="card-tools"><button type="button" class="button secondary" data-drawer="numbers">${tx("Add numbers")}</button></span></header>${issue}<p class="lead muted">${tx("Not worked out yet.")}</p>${offer}`;
  return `<header class="card-h"><h2>${tx("Numbers")}</h2><span class="card-tools"><button type="button" class="button secondary" data-drawer="numbers">${tx("Edit numbers")}</button></span></header><div class="num-grid"><div>${table}<p class="hint">${tx("Break-even and capacity are customers per period.")}</p></div><div class="num-charts">${mathCharts(m) || `<p class="hint">${tx("Add a price and a variable cost to see where each sale goes.")}</p>`}</div></div>${issue}${priceNote}${cta}${simMissing}${notes.length ? `<ul class="notes${bad ? " bad" : ""}">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}${m.missing.length ? offer : ""}`;
}
const MATH_NAMES = { price: tx("price"), variableCost: tx("variable cost"), fixedCosts: tx("fixed costs"), hoursPerCustomer: tx("hours per customer"), availableHours: tx("available hours") };
const CFO_NAMES = { price: tx("Price"), variableCost: tx("Variable cost per sale"), fixedCosts: tx("Fixed costs per period"), hoursPerCustomer: tx("Hours per customer"), availableHours: tx("Hours available per period"), startup: tx("Startup spend (one-off)") };
function numbersCard(idea) {
  const found = stageOut(idea.id, "cfo"),
    cfo = found?.out,
    issue = cardRetry(idea.id, "cfo");
  if (!cfo) return ownNumbersCard(idea, issue);
  const cur = (fieldDraft.currency || "").trim(),
    own = cfo.atOwnPrice,
    test = cfo.atTestPrice,
    cols = [...(own ? [[tx("At your price {price}", { price: fmtMoney(own.price, cur) }), own]] : []), [tx("At the test price {price}", { price: fmtMoney(test.price, cur) }), test]],
    rows = [
      [tx("Kept per sale"), (x) => fmtMoney(x.contribution, cur)],
      [tx("Margin per sale"), (x) => formatMargin(x.margin)],
      [tx("Break-even"), (x) => (x.breakEven === null ? tx("never") : fmtCount(x.breakEven))],
      [tx("Capacity"), (x) => fmtCount(x.capacity)],
      [tx("Profit at capacity"), (x) => fmtMoney(x.profitAtCapacity, cur)],
      [tx("Year 1 profit"), (x) => fmtMoney(x.year1Profit, cur)],
      [tx("Cash needed"), (x) => fmtMoney(x.cashNeeded, cur)],
      [tx("Startup earned back"), (x) => (x.paybackMonth ? tx("month {n}", { n: x.paybackMonth }) : tx("after year 1"))],
    ],
    table = `<table class="mtab"><thead><tr><th scope="col"><span class="sr-only">${tx("Figure")}</span></th>${cols.map(([l]) => `<th scope="col">${l}</th>`).join("")}</tr></thead><tbody>${rows.map(([l, f]) => `<tr><th scope="row">${l}</th>${cols.map(([, x]) => `<td>${f(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
    shown = own || test,
    assumed = new Set(cfo.assumed || []),
    inputRow = (k) => {
      const a = cfo.assumptions?.[k],
        yours = cfo.source?.[k] === "yours",
        val = k === "hoursPerCustomer" || k === "availableHours" ? fmtCount(cfo.inputs?.[k]) : fmtMoney(cfo.inputs?.[k], cur);
      return `<div class="inp"><dt>${CFO_NAMES[k]}</dt><dd>${val} ${yours ? `<span class="tag yours">${tx("Yours")}</span>` : assumed.has(k) ? `<span class="tag assumed">${tx("ASSUMPTION")}</span>${cfo.check ? ` <span class="tag check">${tx("Check this")}</span>` : ""}` : `<span class="tag">${tx("From the buyers")}</span>`}${a?.why ? `<small>${esc(a.why)}</small>` : ""}</dd></div>`;
    },
    startup = cfo.assumptions?.startup,
    use = fieldsToUse(cfo),
    notes = [...new Set([...(test.flags || []).map((f) => (own ? tx("At the test price: {warning}", { warning: tx(f) }) : tx(f))), ...(own?.flags || []).map((f) => tx("At your price: {warning}", { warning: tx(f) }))])],
    outdated = cfoOutdated(cfo) && !issue ? retryNote(found.job, { kind: "stale", reason: tx("You changed your numbers since this was worked out."), stage: "cfo", name: "cfo" }) : "";
  const year = `<details class="more" data-key="num-year"><summary>${tx("Year 1, month by month")}</summary><table class="mtab"><thead><tr><th scope="col">${tx("Month")}</th><th scope="col">${tx("Customers")}</th><th scope="col">${tx("Revenue")}</th><th scope="col">${tx("Profit")}</th><th scope="col">${tx("Running total")}</th></tr></thead><tbody>${shown.months.map((r) => `<tr><th scope="row">${r.month}</th><td>${fmtCount(r.customers)}</td><td>${fmtMoney(r.revenue, cur)}</td><td>${fmtMoney(r.profit, cur)}</td><td>${fmtMoney(r.cumulative, cur)}</td></tr>`).join("")}</tbody></table><p class="hint">${tx("After the startup spend. {basis} The ramp is an assumption: {why}", { basis: own ? tx("At your price.") : tx("At the test price."), why: esc(cfo.assumptions?.ramp?.why || "") })}</p></details>`,
    what = `<details class="more" data-key="num-what"><summary>${tx("What if the price drops, sales dip or costs rise")}</summary>${cols.map(([l, x]) => `<table class="mtab"><caption>${l}</caption><thead><tr><th scope="col">${tx("Scenario")}</th><th scope="col">${tx("Profit margin at plan volume (after fixed costs)")}</th><th scope="col">${tx("Break-even")}</th><th scope="col">${tx("Year 1 profit")}</th></tr></thead><tbody>${x.sensitivity.map((r) => `<tr><th scope="row">${esc(tx(r.name))}</th><td>${formatMargin(r.marginAtPlan)}</td><td>${r.breakEven === null ? tx("never") : fmtCount(r.breakEven)}</td><td>${fmtMoney(r.year1Profit, cur)}</td></tr>`).join("")}</tbody></table>`).join("")}<p class="hint">${tx("Margin per sale is what is left of each sale after its own costs. Profit margin at plan volume also subtracts fixed costs, spread over the customers you plan to have, so it is lower.")}</p></details>`;
  return `<header class="card-h"><h2>${tx("Numbers")}</h2><span class="by-simulation">${tx("Simulated")}</span><span class="card-tools"><button type="button" class="button secondary" data-drawer="numbers">${tx("Edit numbers")}</button></span></header>${issue}${outdated}<div class="num-grid"><div>${table}<p class="hint">${tx("Break-even and capacity are customers per period. Year 1 uses a slow ramp-up, not full capacity from day one.")}</p></div><div class="num-charts">${mathCharts(shown, { price: shown.price, variableCost: cfo.inputs?.variableCost }) || ""}</div></div><h3 class="grp">${tx("Inputs")}</h3><dl class="inputs">${CFO_FIELDS.map(inputRow).join("")}<div class="inp"><dt>${CFO_NAMES.startup}</dt><dd>${fmtMoney(cfo.inputs?.startup, cur)} <span class="tag assumed">${tx("ASSUMPTION")}</span>${startup?.why ? `<small>${esc(startup.why)}</small>` : ""}</dd></div></dl>${assumed.size ? `<p class="hint">${tx("Inputs marked ASSUMPTION are estimates by the CFO model from your idea, the competitors and the buyers. They are not saved on your idea.")}</p>` : ""}${cfo.check ? `<ul class="notes bad">${cfo.check.problems.map((x) => `<li>${esc(tx(x))}</li>`).join("")}</ul><p class="hint">${tx("These estimates look wrong, so they are not shown as confident. Re-estimate asks the model again, or enter your own numbers.")}</p>` : ""}${Object.keys(use).length && !cfo.check ? `<div class="config-actions"><button type="button" class="button primary" data-use-numbers="1">${tx("Use these numbers")}</button></div><p class="hint">${tx("Copies {list} into your idea. Nothing changes until you click.", { list: Object.keys(use).map((k) => CFO_NAMES[k].toLowerCase()).join(", ") })}</p>` : ""}${year}${what}${notes.length ? `<ul class="notes${notes.length ? " bad" : ""}">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`;
}

const STAGE_ORDER = ["grill", "competitors", "board", "panel", "pricing", "cfo", "marketing", "brand", "experiment"];
function timelineCard(idea) {
  const j = ideaJobs(idea.id)[0],
    ready = !!(state.assistant.planner?.model && state.assistant.writer?.model),
    stages = j ? j.stages : STAGE_ORDER.map((name) => ({ name, status: "pending" })),
    cls = (st) => (j?.gate?.stage === st.name || st.status === "failed" ? "bad" : st.status === "done" ? "ok" : st.status === "waiting_user" || (j?.stage === st.name && jobActive(j)) ? "now" : ""),
    label = (st) => (j?.gate?.stage === st.name ? tx("stopped") : st.status === "done" ? (st.stale ? tx("outdated") : st.output?.incomplete ? tx("incomplete") : st.cached ? tx("reused") : tx("done")) : st.status === "waiting_user" ? tx("waiting for you") : j?.stage === st.name && jobActive(j) ? tx("running") : st.status === "failed" ? tx("didn't finish") : "");
  const status = j ? (j.stage === "summary" && jobActive(j) ? tx("{status} · writing summary", { status: JOB_STATUS[j.status] || j.status }) : j.stage && jobActive(j) ? tx("{status} · {stage}", { status: JOB_STATUS[j.status] || j.status, stage: STAGE_LABELS[j.stage] || j.stage }) : JOB_STATUS[j.status] || j.status) : tx("Not run yet");
  return `<header class="card-h"><h2>${tx("Stages")}</h2><span class="card-tools"><details class="menu"><summary aria-label="${tx("Test options")}" title="${tx("Test options")}">⋯</summary><div class="menu-list"><button type="button" data-drawer="test">${tx("Open the full test run")}</button><button type="button" data-drawer="test" data-stage="grill">${tx("Grill answers")}</button></div></details></span></header><ol class="steps">${stages.map((st) => `<li class="${cls(st)}"><button type="button" data-drawer="test" data-stage="${esc(st.name)}"><i aria-hidden="true"></i><span class="st-n">${esc(STAGE_LABELS[st.name] || st.name)}</span><span class="st-s">${esc(label(st).replace(/^./, (c) => c.toUpperCase()))}</span></button></li>`).join("")}</ol><p class="hint steps-note">${esc(status)}${j && j.gate ? ": " + esc(tx(j.gate.reason)) : ""}</p>${j ? j.stages.map((st) => retryNote(j, stageProblem(j, st), true)).join("") : ""}<div class="config-actions"><button type="button" class="button ${j ? "secondary" : "primary"}" data-drawer="test"${ready ? "" : " disabled"}>${j ? (jobActive(j) ? tx("Open the run") : tx("Test again")) : tx("Test this idea")}</button></div>`;
}

const COMP_FACTS = { sells: tx("Sells"), price: tx("Price"), positioning: tx("Positioning"), complaint: tx("Complaint") };
const parseComp = (r) => {
  const facts = r.fields?.facts || "",
    line = (re) => facts.match(re)?.[1]?.trim() || "",
    kind = (line(/Kind:\s*(direct|indirect|substitute)/i) || "other").toLowerCase(),
    sourced = {};
  for (const m of facts.matchAll(/^(Sells|Price|Their positioning, copied|Public complaint, verbatim) \(source: (\S+), accessed [^)]+\):\s*(.+)$/gm)) {
    const url = safeHref(m[2]),
      key = m[1] === "Sells" ? "sells" : m[1] === "Price" ? "price" : m[1].startsWith("Their") ? "positioning" : "complaint";
    if (url) sourced[key] = { text: m[3].trim().replace(/^"(.*)"$/, "$1"), url };
  }
  const reviewed = !needsReview(r),
    confirmed = reviewed && !!String(r.fields?.sources ?? "").trim();
  return { id: r.id, name: r.title.replace(/\s*\((?:unconfirmed|confirmed by source)\)\s*$/i, ""), kind, sourced, sells: sourced.sells?.text || line(/^Sells \(hypothesis\):\s*(.+)$/im), positioning: sourced.positioning?.text || line(/^Positioning[^:\n]*:\s*(.+)$/im) || (kind === "other" ? facts.split("\n")[0] : ""), complaint: sourced.complaint?.text || line(/^Likely buyer complaint[^:\n]*:\s*(.+)$/im), where: line(/^Where to check[^:\n]*:\s*(.+)$/im), gap: r.fields?.gaps || "", confirmed, reviewed, pricing: confirmed ? String(r.fields?.pricing ?? "").trim() : "" };
};
const compChip = (c) => {
  const n = Object.keys(c.sourced).length;
  return c.confirmed ? `<span class="conf ok">${tx("Confirmed")}</span>` : n ? `<span class="conf ok" title="${tx("Found on a web page, not reviewed yet")}">${tp("Sourced ({n} link)|Sourced ({n} links)", n)}</span>` : `<span class="conf">${tx("Unconfirmed")}</span>`;
};
const _a4Kind = { direct: tx("direct"), indirect: tx("indirect"), substitute: tx("substitute") };
const compPrice = (c) => (c.pricing ? tx("Price: {price}", { price: esc(c.pricing) }) : c.sourced.price ? tx("Price: {price} · {link} <small>(found on a page, not yet reviewed)</small>", { price: esc(c.sourced.price.text), link: `<a href="${esc(c.sourced.price.url)}" target="_blank" rel="noopener noreferrer">${tx("source")}</a>` }) : tx("Price not confirmed"));
const compSourced = (c) => Object.entries(c.sourced).map(([k, f]) => `<dt>${tx("{fact} (sourced)", { fact: COMP_FACTS[k] })}</dt><dd>${esc(f.text)} <a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${tx("source")}</a></dd>`).join("");
const plainLabel = (s) => String(s || "").replace(/\s*\([^)]*\)/g, "").trim() || String(s || "");
// Nunito 700 advance widths in em, rounded up so an estimated label never runs past its box.
const textW = (s, px) => [...s].reduce((w, c) => w + (/[iljtfr.,:;'!|()/ -]/.test(c) ? 0.38 : /[mwMW@%&]/.test(c) ? 0.95 : /[A-Z0-9]/.test(c) ? 0.7 : 0.6), 0) * px;
function wrapLabel(s, max, px) {
  const lines = [];
  for (const word of s.split(/\s+|(?<=\/)/).filter(Boolean)) {
    const last = lines[lines.length - 1],
      join = last === undefined ? word : last + (last.endsWith("/") ? "" : " ") + word;
    if (last !== undefined && textW(join, px) <= max) lines[lines.length - 1] = join;
    else lines.push(word);
  }
  return lines;
}
function compMap(items, stage, width) {
  const pts = items.filter((x) => x.no);
  if (!stage?.axes || pts.length < 2) return "";
  const W = Math.max(280, Math.min(1100, Math.round(width) || 640)),
    H = W < 460 ? Math.round(W * 1.15) : Math.max(300, Math.min(380, Math.round(W * 0.5))),
    L = 44,
    R = 8,
    T = 8,
    B = 44,
    RD = 11,
    FS = 12.5,
    LH = 15,
    px = (v) => L + 16 + (v / 10) * (W - L - R - 32),
    py = (v) => H - B - 16 - (v / 10) * (H - T - B - 32),
    a = stage.axes,
    placed = [];
  for (const x of pts) {
    let cx = px(x.x),
      cy = py(x.y);
    for (let tries = 0; tries < 8 && placed.some((q) => Math.hypot(q[0] - cx, q[1] - cy) < RD * 2 + 2); tries++) cx += (tries % 2 ? -1 : 1) * (RD * 2 + 2) * (tries + 1);
    placed.push([(x.cx = Math.max(L + RD + 2, Math.min(W - R - RD - 2, cx))), (x.cy = cy)]);
  }
  const box = { x0: L + 3, x1: W - R - 3, y0: T + 3, y1: H - B - 3 },
    maxW = Math.max(96, Math.min(180, (W - L - R) * 0.4)),
    labels = [],
    hit = (p, q) => Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y)),
    dotBox = (p) => ({ x: p.cx - RD - 2, y: p.cy - RD - 2, w: RD * 2 + 4, h: RD * 2 + 4 });
  for (const p of pts) {
    const lines = wrapLabel(plainLabel(p.name), maxW, FS),
      w = Math.ceil(Math.max(...lines.map((l) => textW(l, FS)))) + 6,
      h = lines.length * LH + 2,
      side = (dir, dy, dx = 0) => ({ x: dir > 0 ? p.cx + RD + 5 + dx : p.cx - RD - 5 - dx - w, y: p.cy - h / 2 + dy, w, h, lead: dy !== 0 || dx !== 0 }),
      centred = (y) => ({ x: Math.max(box.x0, Math.min(box.x1 - w, p.cx - w / 2)), y, w, h, lead: false }),
      first = p.cx + RD + 5 + w <= box.x1 ? [1, -1] : [-1, 1],
      tries = [side(first[0], 0), side(first[1], 0), centred(p.cy + RD + 3), centred(p.cy - RD - 3 - h)];
    for (const dx of [0, 36, 80]) for (let dy = dx ? 0 : 15; dy < H; dy += 15) tries.push(side(first[0], dy, dx), side(first[1], dy, dx), side(first[0], -dy, dx), side(first[1], -dy, dx));
    let best = null,
      bestCost = Infinity;
    for (const c of tries) {
      if (c.x < box.x0 || c.x + c.w > box.x1 || c.y < box.y0 || c.y + c.h > box.y1) continue;
      const cost = labels.reduce((n, l) => n + hit(c, l), 0) + pts.reduce((n, q) => n + (q === p && !c.lead ? 0 : hit(c, dotBox(q))), 0);
      if (cost < bestCost) [best, bestCost] = [c, cost];
      if (!cost) break;
    }
    best = best || centred(Math.min(box.y1 - h, p.cy + RD + 3));
    labels.push(Object.assign(best, { p, lines }));
  }
  const axisTitle = (ax) => (ax.low || ax.high ? tx("{label} ({low} to {high})", { label: ax.label, low: ax.low, high: ax.high }) : `${ax.label}`),
    kindName = (k) => (k === "other" ? tx("added by you") : _a4Kind[k] || k),
    ends = (ax, room) => {
      const lo = plainLabel(ax.low),
        hi = plainLabel(ax.high);
      return lo && hi && textW(lo, 12) + textW(hi, 12) + 24 <= room ? [lo, hi] : ["", ""];
    },
    name = (label, room, fallback) => (textW(plainLabel(label), 12.5) <= room ? plainLabel(label) : fallback),
    [xlo, xhi] = ends(a.x, W - L - R),
    [ylo, yhi] = ends(a.y, H - T - B),
    midY = (T + H - B) / 2,
    n = (v) => v.toFixed(1),
    leader = (l) => {
      if (!l.lead) return "";
      const ex = l.x > l.p.cx ? l.x : l.x + l.w,
        ey = l.y + l.h / 2,
        d = Math.hypot(ex - l.p.cx, ey - l.p.cy) || 1;
      return `<line class="lead" x1="${n(l.p.cx + ((ex - l.p.cx) / d) * RD)}" y1="${n(l.p.cy + ((ey - l.p.cy) / d) * RD)}" x2="${n(ex)}" y2="${n(ey)}"/>`;
    },
    dot = (l) =>
      `<a href="#entry/${esc(l.p.id)}" class="dot k-${l.p.kind}" aria-label="${l.p.no}, ${esc(l.p.name)}, ${kindName(l.p.kind)}"><title>${esc(l.p.name)} (${kindName(l.p.kind)})</title><circle cx="${n(l.p.cx)}" cy="${n(l.p.cy)}" r="${RD}"/><text class="no" x="${n(l.p.cx)}" y="${n(l.p.cy + 4)}">${l.p.no}</text><text class="nm" x="${n(l.x + 3)}" y="${n(l.y + 12)}">${l.lines.map((t, i) => `<tspan x="${n(l.x + 3)}"${i ? ` dy="${LH}"` : ""}>${esc(t)}</tspan>`).join("")}</text></a>`,
    xAxis = `<g class="axis"><title>${esc(axisTitle(a.x))}</title>${xlo ? `<text class="end" x="${L + 4}" y="${H - B + 17}">${esc(xlo)}</text><text class="end" x="${W - R - 4}" y="${H - B + 17}" text-anchor="end">${esc(xhi)}</text>` : ""}<text class="name" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">${esc(name(a.x.label, W - L - R, tx("Across")))}</text></g>`,
    yAxis = `<g class="axis"><title>${esc(axisTitle(a.y))}</title>${ylo ? `<text class="end" transform="translate(${L - 9} ${H - B - 4}) rotate(-90)">${esc(ylo)}</text><text class="end" transform="translate(${L - 9} ${T + 4}) rotate(-90)" text-anchor="end">${esc(yhi)}</text>` : ""}<text class="name" transform="translate(13 ${midY}) rotate(-90)" text-anchor="middle">${esc(name(a.y.label, H - T - B, tx("Up")))}</text></g>`;
  return `<figure class="cmap"><figcaption><h3 class="grp">${tx("Where they sit")}</h3><p class="hint">${stage.axesBy === "derived" ? tx("Worked out from the sourced prices and each competitor's kind, not a measured position. Each dot opens that competitor.") : tx("A model's estimate, not sourced fact. Each dot opens that competitor.")}</p></figcaption><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${tx("Positioning map, {x} across and {y} up. {points}", { x: esc(a.x.label), y: esc(a.y.label), points: esc(pts.map((x) => x.no + " " + x.name).join(", ")) })}"><rect class="plot" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" rx="14"/><line class="gl" x1="${n(px(5))}" y1="${T + 10}" x2="${n(px(5))}" y2="${H - B - 10}"/><line class="gl" x1="${L + 10}" y1="${n(py(5))}" x2="${W - R - 10}" y2="${n(py(5))}"/>${xAxis}${yAxis}${labels.map(leader).join("")}${labels.map(dot).join("")}</svg><p class="cmap-now hint" aria-hidden="true">${tx("Point at a dot, or tab to it, for its full name.")}</p><ul class="cmap-key">${[...new Set(pts.map((x) => x.kind))].map((k) => `<li class="k-${k}"><i aria-hidden="true"></i>${esc(KIND_LABEL[k])}</li>`).join("")}</ul><details class="comp-more" data-key="cmap-axes"><summary>${tx("What the axes mean")}</summary><p class="hint">${tx("Across: {x}. Up: {y}.", { x: esc(axisTitle(a.x)), y: esc(axisTitle(a.y)) })}</p></details></figure>`;
}
for (const type of ["mouseover", "focusin"])
  document.addEventListener(type, (event) => {
    const dot = event.target.closest?.(".cmap .dot");
    if (dot) dot.closest(".cmap").querySelector(".cmap-now").textContent = dot.getAttribute("aria-label").replace(/^(\d+), /, "$1 · ");
  });
function compCard(idea) {
  const found = stageOut(idea.id, "competitors"),
    coords = new Map((found?.out.items || []).map((x) => [x.recordId, x])),
    linked = state.records.filter((r) => r.type === "competitor" && !r.deleted && ((r.links || []).includes(idea.id) || (idea.links || []).includes(r.id)) && (!needsReview(r) || !found || r.origin?.runId === found.job.id)).map(parseComp).map((x) => ({ ...x, x: coords.get(x.id)?.x ?? null, y: coords.get(x.id)?.y ?? null })).filter((x, i, all) => all.findIndex((y) => y.name.toLowerCase() === x.name.toLowerCase() && y.kind === x.kind) === i)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const mapped = linked.filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
  if (found?.out.axes && mapped.length >= 2) mapped.forEach((c, i) => (c.no = i + 1));
  const row = (c) => `<li class="comp"><div class="comp-top">${c.no ? `<span class="comp-no" aria-hidden="true">${c.no}</span>` : ""}<a class="comp-name" href="#entry/${esc(c.id)}">${esc(c.name)}</a><span class="kind k-${esc(c.kind)}">${esc(c.kind === "other" ? tx("yours") : _a4Kind[c.kind] || c.kind)}</span>${compChip(c)}</div>${c.positioning ? `<p class="comp-pos">${esc(c.positioning)}</p>` : ""}<p class="comp-price">${compPrice(c)}</p>${c.complaint || c.gap || c.where || c.sells || Object.keys(c.sourced).length ? `<details class="comp-more" data-key="comp-${esc(c.id)}"><summary>${tx("Complaint, gap, where to check")}</summary><dl>${compSourced(c)}${!c.sourced.sells && c.sells ? `<dt>${tx("Sells")}</dt><dd>${esc(c.sells)}</dd>` : ""}${!c.sourced.complaint && c.complaint ? `<dt>${tx("Likely complaint")}</dt><dd>${esc(c.complaint)}</dd>` : ""}${c.gap ? `<dt>${tx("Gap it leaves")}</dt><dd>${esc(c.gap)}</dd>` : ""}${c.where ? `<dt>${tx("Check price and source")}</dt><dd>${esc(c.where)}</dd>` : ""}<dt>${tx("To confirm")}</dt><dd>${c.reviewed ? tx("Open it, and add a source link and date.") : tx("Open it, accept it, and add a source link and date.")}</dd></dl></details>` : ""}</li>`;
  const lim = limited("comps", linked, (c) => c, 4, 4),
    shown = linked.slice(0, dash.lim.comps ?? 4),
    groups = KIND_ORDER.map((k) => [k, shown.filter((c) => c.kind === k)]).filter(([, l]) => l.length),
    body = linked.length ? groups.map(([k, l]) => `<h3 class="grp">${KIND_LABEL[k]} <small>${l.length}</small></h3><ul class="comps">${l.map(row).join("")}</ul>`).join("") + lim.controls : `<p class="lead muted">${tx("No competitors here yet.")}</p><p class="hint">${found ? tx("You can also add one yourself.") : tx("The competitor scout runs inside the idea test. You can also add one yourself.")}</p>`;
  const tail = found && (found.out.gap || found.out.copycat) ? `<dl class="gapl">${found.out.gap ? `<dt>${tx("The gap")}</dt><dd>${esc(found.out.gap)}</dd>` : ""}${found.out.copycat ? `<dt>${tx("Fastest copycat")}</dt><dd>${esc(found.out.copycat)}</dd>` : ""}</dl>` : "";
  const side = !!tail && (dash.cmapW || 0) >= 760 && mapped.length >= 2 && !!found?.out.axes,
    noMap = found && linked.length >= 2 && !(found.out.axes && mapped.length >= 2) ? `<div class="retry-note"><p>${tx("Map not available: the model did not place these competitors.")}</p><button type="button" class="button secondary" data-retry="${esc(found.job.id)}" data-retry-stage="competitors">${tx("Retry this step")}</button></div>` : "";
  return `<header class="card-h"><h2>${tx("Competitors")}</h2>${linked.some((c) => !c.confirmed) ? `<span class="by-simulation">${tx("Simulated")}</span>` : ""}<span class="card-tools"><details class="menu"><summary aria-label="${tx("Competitor options")}" title="${tx("Competitor options")}">⋯</summary><div class="menu-list"><button type="button" data-add-competitor="1">${tx("Add a competitor")}</button><button type="button" data-drawer="comp">${tx("Search the web")}</button></div></details></span></header>${cardRetry(idea.id, "competitors")}${body}${side ? `<div class="cmap-row">${compMap(linked, found?.out, (dash.cmapW || 0) - 24 - 280)}${tail}</div>` : compMap(linked, found?.out, dash.cmapW) + noMap + tail}`;
}

function rsYears(papers) {
  const years = new Map();
  for (const p of papers) {
    const y = p.year || tx("n.d."),
      e = years.get(y) || { include: 0, maybe: 0, exclude: 0 };
    e[p.decision] = (e[p.decision] || 0) + 1;
    years.set(y, e);
  }
  const cols = [...years.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))),
    total = (e) => e.include + e.maybe + e.exclude,
    top = Math.max(1, ...cols.map(([, e]) => total(e)));
  return cols.length ? `<figure class="chart"><figcaption><h4>${tx("Papers by year")}</h4><p class="legend"><span class="include">${tx("Included")}</span><span class="maybe">${tx("Undecided")}</span><span class="exclude">${tx("Excluded")}</span></p></figcaption><div class="yrs" role="img" aria-label="${tx("Papers by year of publication")}">${cols.map(([y, e]) => `<div class="yr"><span class="yr-n">${total(e)}</span><span class="yr-bar" data-css="--h:${total(e) / top}">${["include", "maybe", "exclude"].filter((k) => e[k]).map((k) => `<i class="${k}" data-css="flex:${e[k]}"></i>`).join("")}</span><span class="yr-l">${cols.length > 9 && /^\d{4}$/.test(String(y)) ? "'" + String(y).slice(-2) : esc(y)}</span></div>`).join("")}</div></figure>` : "";
}
function researchCard(idea) {
  const j = researchJob(idea.id),
    v = rs.forId === idea.id ? rs.view : null,
    n = v?.papers?.length || 0,
    c = v?.counts || {},
    map = j?.stages?.find((s) => s.name === "map" && s.status === "done")?.output,
    ready = !!(state.assistant.planner?.model && state.assistant.writer?.model);
  const status = j ? `${JOB_STATUS[j.status] || j.status}${j.stage && jobActive(j) ? " · " + (STAGE_LABELS[j.stage] || j.stage) : ""}` : tx("Not run yet");
  return `<header class="card-h"><h2>${tx("Research")}</h2><span class="card-tools"><button type="button" class="button secondary" data-drawer="research">${n ? tx("Open papers") : tx("Open")}</button></span></header>${j?.status === "waiting_user" ? `<div class="alert-row"><span><b>${tx("Research is waiting for you.")}</b></span><button type="button" class="button primary" data-drawer="research">${tx("Continue")}</button></div>` : ""}<p class="hint">${esc(status)}</p>${j ? j.stages.map((st) => retryNote(j, stageProblem(j, st), true)).join("") : ""}${n ? `<dl class="mini-stats"><div><dt>${tx("Candidates")}</dt><dd>${n}</dd></div><div><dt>${tx("Included")}</dt><dd>${c.include || 0}</dd></div><div><dt>${tx("Excluded")}</dt><dd>${c.exclude || 0}</dd></div><div><dt>${tx("Undecided")}</dt><dd>${c.maybe || 0}</dd></div></dl>${rsYears(v.papers)}${map ? `<p class="hint">${esc(_a4MapSummary(map.summary))}</p>` : ""}` : `<p class="hint">${tx("Search the literature for papers close to this idea.")}</p>`}${j ? "" : `<div class="config-actions"><button type="button" class="button secondary" data-drawer="research"${ready ? "" : " disabled"}>${tx("Research this")}</button></div>`}`;
}

const noteText = (id) => {
  const r = state.records.find((x) => x.id === id && !x.deleted);
  return r ? r.body.replace(/^(?:Simulated|Simulado):[^\n]*\n+/, "").trim() : "";
};
function outputsPanel(idea) {
  const j = ideaJobs(idea.id)[0];
  if (!j) return "";
  const det = (name, summary, inner) => `<details id="out-${name}" class="out" data-key="out-${name}"><summary><span>${esc(STAGE_LABELS[name])}</span><small>${esc(summary ? tx(summary) : "")}</small></summary>${inner}</details>`,
    ids = (st) => (st.output?.recordIds || []).filter((id) => recordTitle(id)),
    open = (st) => ids(st).map((id) => `<button type="button" class="text-button" data-edit="${esc(id)}">${esc(recordTitle(id))}</button>`).join(" "),
    out = [];
  for (const st of j.stages) {
    if (st.status !== "done" || !st.output) continue;
    const o = st.output;
    let inner = "";
    if (st.name === "grill") inner = o.qa ? `<pre class="out-text">${esc(o.qa)}</pre>` : "";
    else if (st.name === "board") inner = `<p>${esc(o.chair || "")}</p><p class="hint">${tx("Scores {scores} · {votes}", { scores: esc((o.scores || []).map((x) => x ?? "?").join(" / ")), votes: esc((o.votes || []).join(" / ")) })}</p>${open(st)}`;
    else if (st.name === "competitors") inner = `<p>${esc(o.gap || "")}</p><p class="hint">${tx("Fastest copycat: {copycat}. The competitors are on the dashboard.", { copycat: esc(o.copycat || tx("unknown")) })}</p>`;
    else if (st.name === "panel") inner = `<p>${esc(o.summary || "")}</p>${(o.flips || []).length ? `<p class="seg-h">${tx("What would flip a no")}</p><ul>${o.flips.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}${open(st)}`;
    else if (st.name === "pricing") inner = `<pre class="out-text">${esc(noteText(ids(st)[0]))}</pre>`;
    else if (st.name === "cfo") inner = `<pre class="out-text">${esc(noteText(ids(st)[0]))}</pre>`;
    else if (st.name === "marketing" || st.name === "brand") inner = `<pre class="out-text">${esc(o.text || "")}</pre>${open(st)}`;
    else if (st.name === "experiment") {
      const rec = state.records.find((x) => x.id === ids(st)[0]);
      inner = `<p><b>${tx("Hypothesis.")}</b> ${esc(o.hypothesis || "")}</p>${rec?.fields?.plan ? `<p><b>${tx("Plan.")}</b> ${esc(rec.fields.plan)}</p>` : ""}${rec?.fields?.success ? `<p><b>${tx("Success line.")}</b> ${esc(rec.fields.success)}</p>` : ""}${open(st)}`;
    }
    out.push(det(st.name, o.summary || "", inner));
  }
  return out.length ? `<h3 class="run-head">${tx("Full stage outputs")}</h3><div class="outs">${out.join("")}</div>` : "";
}

const CARD_TITLES = { kpis: tx("Key numbers"), hero: tx("Summary"), charts: tx("Evidence"), numbers: tx("Numbers"), details: tx("Details"), timeline: tx("Stages"), comp: tx("Competitors"), research: tx("Research"), links: tx("Links and files"), canvas: tx("Business model"), chat: tx("Work on this idea"), branches: tx("Branches") };
const DEFAULT_LAYOUTS = {
  idea: [["kpis", 2], ["hero", 2], ["charts", 2], ["numbers", 2], ["canvas", 3], ["chat", 2], ["details", 1], ["branches", 3], ["timeline", 1], ["research", 1], ["links", 1], ["comp", 3]],
  other: [["details", 2], ["links", 1]],
};
const defaultLayout = (type) => (DEFAULT_LAYOUTS[type] || DEFAULT_LAYOUTS.other).map(([id, w]) => ({ id, w, h: "full" }));
const phoneLayout = () => matchMedia("(max-width: 699px)").matches;
const GRIP_DOTS = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="5" cy="3.5" r="1.4"/><circle cx="11" cy="3.5" r="1.4"/><circle cx="5" cy="8" r="1.4"/><circle cx="11" cy="8" r="1.4"/><circle cx="5" cy="12.5" r="1.4"/><circle cx="11" cy="12.5" r="1.4"/></svg>';
const cardEls = () => $$("#dash > .card[data-card]");
const cardId = (el) => el.dataset.card;
function mergedLayout(type) {
  const base = defaultLayout(type),
    known = new Set(base.map((c) => c.id)),
    saved = (state.layouts?.[type] || []).filter((c) => known.has(c.id)),
    seen = new Set(saved.map((c) => c.id));
  return [...saved, ...base.filter((c) => !seen.has(c.id))];
}
function pack(el) {
  if (!el.offsetParent && !el.getClientRects().length) return;
  el.style.gridRowEnd = "span " + Math.max(1, Math.ceil((el.offsetHeight + 20) / 6));
}
const packAll = () => cardEls().forEach(pack);
let packWatch = null;
function initCards() {
  if (initCards.done) return;
  initCards.done = true;
  for (const el of cardEls()) {
    const grip = document.createElement("details");
    grip.className = "menu grip-menu";
    grip.innerHTML = `<summary class="grip" aria-label="${tx("Move or resize {title}", { title: esc(CARD_TITLES[cardId(el)] || tx("card")) })}" title="${tx("Drag to move this card, or click for more options")}">${GRIP_DOTS}</summary><div class="menu-list"><button type="button" data-card-act="earlier">${tx("Move earlier")}</button><button type="button" data-card-act="later">${tx("Move later")}</button><button type="button" data-card-act="wider" class="w-ctl">${tx("Wider")}</button><button type="button" data-card-act="narrower" class="w-ctl">${tx("Narrower")}</button><button type="button" data-card-act="height" class="w-ctl">${tx("Compact height")}</button><button type="button" data-card-act="reset">${tx("Reset layout")}</button></div>`;
    el.append(grip);
    const bar = document.createElement("div");
    bar.className = "edit-bar";
    bar.innerHTML = `<button type="button" data-card-act="earlier" aria-label="${tx("Move {title} earlier", { title: esc(CARD_TITLES[cardId(el)] || tx("card")) })}" title="${tx("Move earlier")}">&uarr;</button><button type="button" data-card-act="later" aria-label="${tx("Move {title} later", { title: esc(CARD_TITLES[cardId(el)] || tx("card")) })}" title="${tx("Move later")}">&darr;</button><button type="button" data-card-act="narrower" class="w-ctl" aria-label="${tx("Make {title} narrower", { title: esc(CARD_TITLES[cardId(el)] || tx("card")) })}" title="${tx("Narrower")}">&minus;</button><button type="button" data-card-act="wider" class="w-ctl" aria-label="${tx("Make {title} wider", { title: esc(CARD_TITLES[cardId(el)] || tx("card")) })}" title="${tx("Wider")}">+</button><button type="button" data-card-act="height" class="h-ctl">${tx("Compact height")}</button>`;
    el.append(bar);
  }
  if (typeof ResizeObserver !== "undefined") {
    packWatch = new ResizeObserver((hits) =>
      hits.forEach((h) => {
        pack(h.target);
        const mapW = h.target.id === "card-comp" && Math.round(h.target.querySelector(".card-c").clientWidth / 16) * 16;
        if (mapW && mapW !== dash.cmapW) {
          dash.cmapW = mapW;
          const idea = $("#record-type").value === "idea" && state.records.find((r) => r.id === $("#record-id").value);
          if (idea) fill("card-comp", compCard(idea));
        }
      }));
    for (const el of cardEls()) packWatch.observe(el);
  }
  window.addEventListener("resize", () => requestAnimationFrame(packAll));
}
function applyLayout() {
  const dashEl = $("#dash");
  if (!dashEl) return;
  initCards();
  const type = $("#record-type").value,
    layout = mergedLayout(type),
    byId = new Map(cardEls().map((el) => [cardId(el), el]));
  layout.forEach((c, i) => {
    const el = byId.get(c.id);
    if (!el) return;
    el.dataset.w = String(c.w);
    el.dataset.h = c.h;
    if (dashEl.children[i] !== el) dashEl.insertBefore(el, dashEl.children[i] || null);
    syncGrip(el);
  });
  requestAnimationFrame(packAll);
}
function syncGrip(el) {
  const compact = el.dataset.h === "compact",
    btns = el.querySelectorAll('[data-card-act="height"]');
  for (const btn of btns) btn.textContent = compact ? tx("Full height") : tx("Compact height");
}
function readLayout() {
  return cardEls().map((el) => ({ id: cardId(el), w: Number(el.dataset.w) || 1, h: el.dataset.h === "compact" ? "compact" : "full" }));
}
let layoutTimer = null;
function saveLayout() {
  const type = $("#record-type").value,
    layout = readLayout().filter((c) => (DEFAULT_LAYOUTS[type] || DEFAULT_LAYOUTS.other).some(([id]) => id === c.id));
  state.layouts = { ...state.layouts, [type]: layout };
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => api("/api/ui-layout", { method: "POST", data: { type, layout } }).catch((e) => toast(tx(e.message))), 300);
}
function flip(change) {
  const before = new Map(cardEls().map((el) => [el, el.getBoundingClientRect()]));
  change();
  packAll();
  if (reducedMotion()) return;
  for (const [el, a] of before) {
    const b = el.getBoundingClientRect(),
      dx = a.left - b.left,
      dy = a.top - b.top;
    if (Math.abs(dx) + Math.abs(dy) > 1 && el.animate) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  }
}
function visibleCards() {
  return cardEls().filter((el) => el.getClientRects().length);
}
function moveCard(el, dir) {
  const list = visibleCards(),
    i = list.indexOf(el),
    other = list[i + dir];
  if (!other) return false;
  flip(() => (dir < 0 ? other.before(el) : other.after(el)));
  return true;
}
function cardAction(btn) {
  const el = btn.closest(".card[data-card]"),
    act = btn.dataset.cardAct,
    name = CARD_TITLES[cardId(el)] || tx("Card");
  if (act === "reset") return resetLayout();
  if (act === "earlier" || act === "later") {
    if (!moveCard(el, act === "earlier" ? -1 : 1)) return toast(act === "earlier" ? tx("{name} is already first.", { name }) : tx("{name} is already last.", { name }));
    toast(act === "earlier" ? tx("{name} moved up.", { name }) : tx("{name} moved down.", { name }));
  } else if (act === "wider" || act === "narrower") {
    const w = Math.max(1, Math.min(3, Number(el.dataset.w) + (act === "wider" ? 1 : -1)));
    if (w === Number(el.dataset.w)) return toast(act === "wider" ? tx("{name} is already as wide as it gets.", { name }) : tx("{name} is already as narrow as it gets.", { name }));
    flip(() => (el.dataset.w = String(w)));
    toast(tp("{name} is now {n} column wide.|{name} is now {n} columns wide.", w, { name }));
  } else if (act === "height") {
    flip(() => (el.dataset.h = el.dataset.h === "compact" ? "full" : "compact"));
    syncGrip(el);
    toast(el.dataset.h === "compact" ? tx("{name} is now compact.", { name }) : tx("{name} is now full height.", { name }));
  }
  saveLayout();
  el.querySelector(".grip")?.focus({ preventScroll: true });
}
function setLayoutEditing(on) {
  document.body.classList.toggle("layout-editing", on);
  $("#layout-edit").setAttribute("aria-pressed", String(on));
  $("#layout-edit").textContent = on ? tx("Done editing") : tx("Edit layout");
  $("#layout-reset-bar").hidden = !on;
}
function resetLayout() {
  const type = $("#record-type").value;
  if (state.layouts) delete state.layouts[type];
  flip(applyLayout);
  api("/api/ui-layout", { method: "POST", data: { type, layout: null } }).catch((e) => toast(tx(e.message)));
  toast(tx("Layout reset."));
}
let drag = null,
  dragEnded = 0;
document.addEventListener("pointerdown", (event) => {
  const grip = event.target.closest?.(".grip");
  if (!grip || event.button !== 0 || phoneLayout()) return;
  drag = { el: grip.closest(".card[data-card]"), x: event.clientX, y: event.clientY, moved: false, id: event.pointerId, grip };
});
document.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  if (!drag.moved) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    drag.moved = true;
    drag.grip.setPointerCapture?.(event.pointerId);
    for (const d of $$("details.menu[open]")) d.open = false;
    drag.el.classList.add("dragging");
    document.body.classList.add("is-dragging");
  }
  drag.el.style.pointerEvents = "none";
  const under = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("#dash > .card[data-card]");
  drag.el.style.pointerEvents = "";
  if (!under || under === drag.el) return;
  const r = under.getBoundingClientRect(),
    after = event.clientY > r.top + r.height / 2 && (event.clientX > r.left + r.width * 0.15 || event.clientY > r.top + r.height * 0.7);
  if (after ? under.nextElementSibling === drag.el : under.previousElementSibling === drag.el) return;
  flip(() => (after ? under.after(drag.el) : under.before(drag.el)));
});
const endDrag = (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const was = drag;
  drag = null;
  document.body.classList.remove("is-dragging");
  was.el.classList.remove("dragging");
  if (was.moved) {
    dragEnded = Date.now();
    saveLayout();
  }
};
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
document.addEventListener(
  "click",
  (event) => {
    if (Date.now() - dragEnded < 250 && event.target.closest?.(".grip")) {
      event.preventDefault();
      event.stopPropagation();
    }
  },
  true,
);
// While the drawer is open the page behind it cannot be scrolled, focused or read.
function drawerBackdrop(on) {
  document.documentElement.classList.toggle("drawer-open", on);
  for (const el of document.querySelectorAll(".sidebar, main > header, .entry-bar, .entry-head, #dash, .phone-actions, #footer")) el.inert = on;
}
function openDrawer(pane, opener, stage) {
  const form = $("#record-form");
  if (!form.dataset.drawer) dash.opener = opener || document.activeElement;
  form.dataset.drawer = pane;
  drawerBackdrop(true);
  $("#drawer").inert = false;
  $("#drawer-title").textContent = DRAWER_TITLES[pane] || tx("Details");
  $("#drawer-close").focus({ preventScroll: true });
  if (pane === "research") loadResearch();
  if (stage) {
    const d = $("#out-" + stage);
    if (d) {
      d.open = true;
      dash.open.add(d.dataset.key);
      setTimeout(() => d.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" }), 60);
    }
  }
}
function closeDrawer(restore = true) {
  const form = $("#record-form");
  if (!form.dataset.drawer) return;
  delete form.dataset.drawer;
  drawerBackdrop(false);
  $("#drawer").inert = true;
  if (restore && dash.opener?.isConnected) dash.opener.focus({ preventScroll: true });
  dash.opener = null;
}
document.addEventListener("click", (event) => {
  const t = event.target;
  if (t.closest("[data-drawer-close],#drawer-close")) return closeDrawer();
  const open = t.closest("button[data-drawer]");
  if (open) return openDrawer(open.dataset.drawer, open, open.dataset.stage);
  const more = t.closest("[data-more],[data-less]");
  if (more) {
    const key = more.dataset.more || more.dataset.less,
      first = Number(more.dataset.first),
      step = Number(more.dataset.step),
      n = dash.lim[key] ?? first;
    dash.lim[key] = more.dataset.more ? n + step : Math.max(first, n - step);
    renderDash();
    renderResearchRun();
    return;
  }
  const jump = t.closest("[data-jump]");
  if (jump) {
    event.preventDefault();
    return void document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
  const act = t.closest("[data-card-act]");
  if (act) return cardAction(act);
  if (t.closest("#layout-reset") || t.closest("#layout-reset-bar")) return resetLayout();
  if (t.closest("#layout-edit")) return setLayoutEditing(!document.body.classList.contains("layout-editing"));
  const sum = t.closest("[data-summary]");
  if (sum) return void writeSummary(sum.dataset.summary === "force");
  const seg = t.closest("[data-seg]");
  if (seg) showSeg(Number(seg.dataset.seg), true);
});
document.addEventListener("mouseover", (event) => {
  const seg = event.target.closest?.("[data-seg]");
  if (seg) showSeg(Number(seg.dataset.seg), false);
});
document.addEventListener("mouseout", (event) => {
  if (event.target.closest?.("[data-seg]") && !event.relatedTarget?.closest?.("[data-seg]")) showSeg(dash.sel, false);
});
document.addEventListener("focusin", (event) => {
  const seg = event.target.closest?.("[data-seg]");
  if (seg) showSeg(Number(seg.dataset.seg), false);
});
document.addEventListener("keydown", (event) => {
  const seg = event.target.closest?.("[data-seg]");
  if (seg && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    showSeg(Number(seg.dataset.seg), true);
  } else if (event.key === "Escape" && $("#record-form").dataset.drawer && !event.target.closest?.(".rd-wrap.editing")) {
    event.preventDefault();
    closeDrawer();
  }
});
document.addEventListener(
  "toggle",
  (event) => {
    const d = event.target;
    if (d.dataset?.key) d.open ? dash.open.add(d.dataset.key) : dash.open.delete(d.dataset.key);
  },
  true,
);
function renderMath() {
  const panel = $("#math-panel");
  const isIdea = $("#record-type").value === "idea";
  panel.hidden = !isIdea;
  if (!isIdea) return;
  syncFields();
  const m = businessMath(fieldDraft),
    cur = (fieldDraft.currency || "").trim(),
    row = (label, value) => `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`;
  panel.innerHTML = `<dl class="stats">${row(tx("Kept per sale"), fmtMoney(m.contribution, cur), ["price", "variableCost"])}${row(tx("Margin"), m.margin === null ? "—" : formatMargin(m.margin), ["price", "variableCost"])}${row(tx("Break-even customers per period"), fmtCount(m.breakEven), ["fixedCosts", "price", "variableCost"])}${row(tx("Capacity customers per period"), fmtCount(m.capacity), ["hoursPerCustomer", "availableHours"])}${row(tx("Profit at capacity per period"), fmtMoney(m.profitAtCapacity, cur), ["fixedCosts", "price", "variableCost", "hoursPerCustomer", "availableHours"])}</dl>${missingText(m) ? `<p class="hint">${esc(missingText(m))}</p>` : ""}${m.warnings.map((w) => `<p class="gate">${esc(w)}</p>`).join("")}<p class="hint">${tx("Only the numbers you entered. Nothing is estimated. Fixed costs and hours are per period; price and variable cost are per sale.")}</p>`;
  renderGlance();
}
function sourceLinks(value) {
  if (!value) return tx("Not recorded");
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
  panel.innerHTML = `<p class="hint">${tx("Search opens an external site and sends your query there. Nothing is saved until you add it as a competitor. Linked competitors are on the dashboard.")}</p><div class="config-actions"><a id="research-search" class="button secondary" target="_blank" rel="noopener noreferrer">${tx("Search the web")}</a> <button type="button" class="button secondary" id="add-competitor" ${id ? "" : "disabled"}>${tx("Add competitor")}</button></div>${id ? "" : `<p class="hint">${tx("Save this idea before adding a competitor.")}</p>`}<p class="hint">${tx("Founder presets adapted from founder-skill by Jake Schincariol (MIT).")}</p>`;
  updateResearchSearch();
  renderPapers();
}
let papers = { forId: null, query: "", results: [], page: 0, total: 0, fetched: "", sourcesTried: [], verification: null, source: "", busy: false, error: "", searched: false };
function paperVerification(p) {
  return p.verified?.by === "crossref" ? tx("Verified via Crossref DOI {doi}", { doi: p.verified.doi }) : p.verified?.by === "arxiv" ? tx("Verified via arXiv {id}", { id: p.verified.id }) : "";
}
function paperSourcesLine(tried, v) {
  const parts = tried.map((s) => `${s.name}: ${s.ok ? s.count : s.error ? tx(s.error) : tx("failed")}`);
  if (v?.dropped) parts.push(tp("{n} unverified result dropped|{n} unverified results dropped", v.dropped));
  if (v?.timedOut) parts.push(tx("verification timed out"));
  return parts.join(" · ");
}
function paperCitation(p) {
  const who = p.authors.length ? p.authors.join(", ") : tx("Unknown authors");
  return `${who} (${p.year || tx("n.d.")}). ${p.title}.${p.venue ? " " + p.venue + "." : ""}${p.url ? " " + p.url : ""}`;
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
    return `<li class="research-comparison"><strong>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>` : esc(p.title)}</strong><p class="hint">${p.verified ? `<span class="stage">${esc(p.verified.by === "crossref" ? tx("DOI verified") : "arXiv")}</span> ` : ""}${esc(p.authors.join(", ") || tx("Unknown authors"))} · ${esc(p.year || tx("year unknown"))} · ${esc(p.venue || tx("venue unknown"))}</p>${p.abstract ? `<details><summary>${tx("Abstract")}</summary><p>${esc(p.abstract)}</p></details>` : `<p class="hint">${tx("No abstract available.")}</p>`}<button type="button" class="text-button" data-paper-note="${i}" ${id ? "" : "disabled"}>${tx("Save as note")}</button></li>`;
  }).join("");
  const more = papers.results.length < papers.total && !papers.error;
  panel.innerHTML = `<h3>${tx("Find related research")}</h3><p class="hint">${tx("Search sends your query to OpenAlex, Crossref and arXiv. Nothing is saved unless you choose Save as note.")}</p><label>${tx("Search query")}<input id="papers-query" value="${esc(papers.query)}" maxlength="300"></label> <button type="button" class="button secondary" id="papers-search" ${papers.busy ? "disabled" : ""}>${papers.busy ? tx("Searching…") : tx("Search")}</button>${id ? "" : `<p class="hint">${tx("Save this idea before saving a paper as a note.")}</p>`}${papers.error ? `<p class="hint" role="alert">${esc(papers.error)}</p>` : ""}${papers.searched && !papers.error ? `<p class="hint">${tx("About {total} results · page {page} · Searched on {date}. A limited search shows what it found, not that nothing else exists.", { total: esc(papers.total), page: esc(papers.page), date: esc(fmt.dateLong(papers.fetched)) })}</p><p class="hint">${esc(paperSourcesLine(papers.sourcesTried, papers.verification))}</p>` : ""}${papers.searched && !papers.error && !papers.results.length ? `<p class="hint">${tx("No papers found. Try broader or different words.")}</p>` : ""}${items ? `<ul class="research-grid">${items}</ul>` : ""}${more ? `<button type="button" class="button secondary" id="papers-more" ${papers.busy ? "disabled" : ""}>${tx("More")}</button>` : ""}`;
}
async function searchPapers(next) {
  const input = $("#papers-query");
  if (input) papers.query = input.value.trim();
  if (!papers.query) {
    papers.error = tx("Enter a search query.");
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
    papers.error = tx("Search failed: {message}", { message: tx(error.message) });
  }
  papers.busy = false;
  renderPapers();
}
document.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b || !$("#papers-panel")?.contains(b)) return;
  if (b.id === "papers-search") searchPapers(false);
  else if (b.id === "papers-more") searchPapers(true);
  else if (b.dataset.paperNote !== undefined) {
    const p = papers.results[Number(b.dataset.paperNote)];
    if (!p) return;
    if (!(await settle(tx("Discard unsaved changes before opening a note?")))) return;
    const ideaId = $("#record-id").value;
    createEntry("note", { title: p.title, body: paperCitation(p) + (paperVerification(p) ? "\n" + paperVerification(p) : "") + (p.openAccessUrl && p.openAccessUrl !== p.url ? "\n" + tx("Open access:") + " " + p.openAccessUrl : ""), links: [ideaId] }).catch((error) => toast(tx(error.message)));
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "papers-query") papers.query = event.target.value;
});
function updateResearchSearch() {
  const link = $("#research-search");
  if (!link) return;
  const query = $("[data-field=researchQueries]")?.value.trim() || `${$("#record-title").value.trim()} ${tx("competitors alternatives")}`;
  link.href = "https://www.google.com/search?q=" + encodeURIComponent(query);
}
function syncPrivate(record) {
  $("#private-mark").hidden = !record?.private;
  $("#private-toggle").textContent = record?.private ? tx("Remove private lock") : tx("Make private (nothing leaves this computer)");
  $("#private-toggle").hidden = !record;
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
let saveTimer,
  saving = Promise.resolve();
const setSaveStatus = (text, bad) => {
  const el = $("#save-status");
  el.textContent = text;
  el.dataset.state = bad ? "error" : text ? "ok" : "";
};
const isDirty = () => JSON.stringify(formRecord()) !== editorSnapshot;
function scheduleSave() {
  if (!$("#record-id").value) return;
  clearTimeout(saveTimer);
  if (!isDirty()) return;
  setSaveStatus(tx("Unsaved changes"));
  saveTimer = setTimeout(() => saveRecord().catch(() => {}), 900);
}
function saveRecord() {
  clearTimeout(saveTimer);
  const run = saving.then(async () => {
    const id = $("#record-id").value;
    if (!id || !isDirty()) return;
    const record = formRecord();
    if (!record.title) return setSaveStatus(tx("Add a title to save"), true);
    if (recordDraft && recordDraft.type !== record.type) {
      const previous = Object.entries(recordDraft.fields || {}).filter(([, v]) => v);
      if (previous.length) {
        record.body += "\n\n" + tx("Previous {type} details:", { type: types[recordDraft.type] }) + "\n" + previous.map(([k, v]) => `${fieldLabels[recordDraft.type][k] || k}: ${v}`).join("\n");
        $("#record-body").value = record.body;
        growBody();
      }
    }
    setSaveStatus(tx("Saving…"));
    try {
      const base = JSON.parse(editorSnapshot),
        changed = Object.fromEntries(Object.entries(record).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(base[k])));
      await api("/api/records/" + encodeURIComponent(id), { method: "PATCH", data: changed });
      recordDraft = { ...recordDraft, ...record };
      editorSnapshot = JSON.stringify(record);
      await refresh(false);
      setSaveStatus(tx("Saved"));
      if (isDirty()) scheduleSave();
    } catch (error) {
      setSaveStatus(tx("Could not save: {message}", { message: tx(error.message) }), true);
      throw error;
    }
  });
  saving = run.catch(() => {});
  return run;
}
async function settle(message) {
  if ($("#record-id").value) await saveRecord().catch(() => {});
  return !isDirty() || confirm(message);
}
function renderLinkChips() {
  $("#link-chips").innerHTML = [...$("#record-links").selectedOptions].map((o) => `<span class="link-chip"><span>${esc(o.textContent)}</span><button type="button" data-unlink="${esc(o.value)}" aria-label="${tx("Remove link to {title}", { title: esc(o.textContent) })}">×</button></span>`).join("");
}
function renderLinkResults() {
  const q = $("#link-search").value.trim().toLowerCase(),
    list = [...$("#record-links").options].filter((o) => !o.selected && (!q || o.textContent.toLowerCase().includes(q))).slice(0, 8);
  $("#link-results").innerHTML = list.map((o) => `<li><button type="button" role="option" data-link-add="${esc(o.value)}">${esc(o.textContent)}</button></li>`).join("") || `<li class="hint">${tx("No matching entries.")}</li>`;
}
function toggleLinkPop(open) {
  const pop = $("#link-pop");
  pop.hidden = !open;
  $("#add-link").setAttribute("aria-expanded", String(open));
  if (open) {
    $("#link-search").value = "";
    renderLinkResults();
    $("#link-search").focus();
  }
}
function setLink(id, on) {
  const option = [...$("#record-links").options].find((o) => o.value === id);
  if (option) option.selected = on;
  renderLinkChips();
  renderLinkResults();
  scheduleSave();
}
let entryIntent = null,
  backTo = "",
  wantCapture = false;
const entryVisible = () => !$("#record-form").hidden && !!$("#record-id").value;
function goEntry(id, intent = null) {
  entryIntent = intent;
  if (location.hash === "#entry/" + id) applyIntent();
  else location.hash = "entry/" + id;
}
function applyIntent() {
  const intent = entryIntent;
  entryIntent = null;
  setTimeout(() => {
    if (intent?.edit === "title") startEdit($(".entry-title-wrap"));
    else if (intent?.open) openDrawer(intent.open);
    else if (intent?.scroll) $(intent.scroll)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    else $("#record-heading").focus({ preventScroll: true });
  }, 0);
}
async function createEntry(type, draft = {}, intent = null) {
  const body = draft.body || "",
    title = (draft.title || "").trim() || body.split("\n")[0].trim().slice(0, 80) || tx("Untitled {type}", { type: types[type].toLowerCase() });
  const saved = await api("/api/records", { method: "POST", data: { type, stage: type === "inbox" ? "inbox" : "draft", title, body, category: "", fields: draft.fields || {}, links: draft.links || [] } });
  await refresh(false);
  goEntry(saved.id, intent);
}
function goCapture() {
  query = "";
  $("#search").value = "";
  wantCapture = true;
  if (location.hash !== "#home" && location.hash !== "") location.hash = "#home";
  else if (route().view !== "home" || $("#quick-title") === null) render();
  else focusCapture();
}
function unloadEntry() {
  $("#record-form").hidden = true;
  if (!$("#record-id").value && !recordDraft) return;
  clearTimeout(saveTimer);
  for (const wrap of $$(".rd-wrap.editing")) endEdit(wrap);
  $("#record-id").value = "";
  recordDraft = null;
  editorSnapshot = "";
  setSaveStatus("");
  document.title = tx("Spark — Local workbench");
  closeDrawer(false);
  window.voiceOpen?.("");
}
function setBack(type) {
  const href = backTo && !backTo.startsWith("#entry/") ? backTo : "#" + type,
    view = href.slice(1).split("/")[0];
  $("#entry-back").href = href;
  $("#entry-back-label").textContent = labels[view] || (view === "brief" ? tx("Brief") : view === "review" ? tx("To review") : tx("Home"));
}
function renderEntryRoute(id) {
  const rec = state.records.find((r) => r.id === id);
  if (!rec || rec.deleted) {
    unloadEntry();
    $("#content").hidden = false;
    $("#content").innerHTML = `<div class="empty entry-missing"><h1>${rec ? tx("This entry is in Trash") : tx("This entry isn't here")}</h1><p>${rec ? tx("It was moved to Trash, so it is hidden from lists. Restore it to read and edit it again.") : tx("It may have been deleted, or the link may be mistyped. Nothing else is affected.")}</p><div class="config-actions">${rec ? `<button type="button" class="button primary" data-restore="${esc(rec.id)}">${tx("Restore it")}</button>` : ""}<a class="button secondary" href="#home">${tx("Back to Home")}</a></div></div>`;
    document.title = tx("Spark — Local workbench");
    return;
  }
  $("#content").hidden = true;
  $("#record-form").hidden = false;
  if ($("#record-id").value === id) {
    renderValidation();
    renderGlance();
    syncPrivate(rec);
    return;
  }
  loadEntry(rec).catch((error) => toast(tx(error.message)));
}
async function loadEntry(record) {
  for (const wrap of $$(".rd-wrap.editing")) endEdit(wrap);
  closeDrawer(false);
  dash.lim = {};
  dash.selFor = "";
  for (const id of ["card-kpis", "card-hero", "card-charts", "card-numbers", "card-timeline", "card-comp", "card-research", "card-canvas", "card-chat", "card-branches", "outputs-panel"]) {
    let el = $("#" + id);
    if (el?.classList.contains("card")) el = el.querySelector(".card-c");
    if (el) (el._html = ""), (el.innerHTML = "");
  }
  recordDraft = record;
  fieldDraft = { ...(record.fields || {}) };
  $("#record-form").reset();
  $("#record-id").value = record.id;
  $("#record-type").value = record.type;
  $("#record-title").value = record.title;
  $("#record-body").value = record.body || "";
  $("#record-category").value = record.category || "";
  $("#record-stage").innerHTML = stages.map((s) => option(s, _a1StageLabel(s), record.stage)).join("");
  $("#record-links").innerHTML = entries()
    .filter((r) => r.id !== record.id)
    .map((r) => `<option value="${esc(r.id)}"${(record.links || []).includes(r.id) ? " selected" : ""}>${esc(r.title)} (${types[r.type]})</option>`)
    .join("");
  renderLinkChips();
  toggleLinkPop(false);
  setSaveStatus("");
  const generated = ["assistant", "simulation"].includes(record.origin?.by);
  $("#assistant-mark").hidden = !generated;
  syncPrivate(record);
  const cls = record.classification,
    line = $("#record-class");
  line.hidden = !cls || record.type === "inbox";
  if (cls) line.textContent = cls.corrected ? tx("Type set by you. Spark remembers the correction.") : cls.alternatives.length ? tx("Typed by the assistant as {type} ({p}); also {others}. Change the type above to correct it.", { type: types[cls.type], p: percent(cls.p), others: cls.alternatives.map((a) => `${types[a.type]} ${percent(a.p)}`).join(", ") }) : tx("Typed by the assistant as {type} ({p}). Change the type above to correct it.", { type: types[cls.type], p: percent(cls.p) });
  if (generated) {
    const sim = record.origin.by === "simulation",
      review = needsReview(record);
    $("#assistant-mark-label").className = sim ? "by-simulation" : "by-assistant";
    $("#assistant-mark-label").textContent = sim ? tx("Simulated") : tx("by assistant");
    $("#assistant-mark-note").textContent = review
      ? tx("Not reviewed yet, so it stays out of lists, search and model context. Evidence fields stay empty until you accept it.")
      : tx("Accepted. Check it before relying on it.");
    for (const b of [$("#assistant-accept"), $("#assistant-discard")]) {
      b.hidden = !review;
      b.dataset.id = record.id;
    }
  }
  renderFields();
  for (const wrap of $$("#record-form .rd-wrap")) refreshRead(wrap);
  editorSnapshot = JSON.stringify(formRecord());
  setBack(record.type);
  $("#breadcrumb").textContent = tx("Workspace / {type}", { type: labels[record.type] });
  document.title = (record.title || tx("Untitled")) + " · Spark";
  window.voiceOpen(record.id);
  applyIntent();
  await loadAttachments(record.id);
}
async function loadAttachments(id) {
  const files = await api(
    `/api/attachments?recordId=${encodeURIComponent(id)}`,
  );
  if ($("#record-id").value !== id) return;
  window.voiceFiles(files);
}
function currentSessionForm() {
  const form = $("#session-form");
  if (!form) return null;
  const prior = state.sessions.find((s) => s.id === form.dataset.id);
  return {
    ...prior,
    title: $("#session-title").value.trim() || tx("Untitled discussion"),
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
  if (!s) throw Error(tx("Choose a discussion first."));
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
    name: tx("Explorer"),
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
      title: source ? (source.exactTitle ? source.title : tx("{title} — new discussion", { title: source.title })) : tx("New discussion"),
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
  if (activeRun) throw Error(tx("Wait for the current run or stop it first."));
  const prompt = $("#prompt")?.value || "",
    target = $("#send-to")?.value || "";
  if (action === "run" && !prompt.trim()) throw Error(tx("Write a message first."));
  const s = await saveSession(),
    data = { sessionId: s.id, action };
  if (action === "run") {
    data.prompt = prompt;
    if (target) data.agentId = target;
  }
  if (action === "retry") data.messageId = messageId;
  if (action === "synthesize") {
    data.moderator = s.agents.find((a) => a.id === $("#moderator").value);
    if (!data.moderator) throw Error(tx("Choose a moderator."));
  }
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw Error(error.error ? tx(error.error) : tx("Could not start discussion."));
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
      if (event.event === "error") toast(tx(event.error));
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
      toast(tx("Connection ended. Check saved response status before retrying."));
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
        tp("Connected. {n} model listed. {list}|Connected. {n} models listed. {list}", result.models.length, { list: `${result.models
          .slice(0, 6)
          .map((m) => m.id)
          .join(", ")}${result.models.length > 6 ? "…" : ""}` });
    if (!quiet)
      toast(
      tp("{n} model ID loaded. Choose a text model supported by this provider.|{n} model IDs loaded. Choose a text model supported by this provider.", result.models.length),
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
    toast(tx(error.message)),
  );
  await localModelsRequest;
  const first = modelLists.local?.[0]?.id;
  if (first)
    for (const element of $$(".participant").filter(isEmptyLocalParticipant))
      element.querySelector('[data-agent-field="model"]').value = first;
}
async function migrateLegacy() {
  const legacy = legacyEntries();
  if (!legacy.length) return toast(tx("No personal entries found."));
  if (
    !confirm(
      tx("Import {n} personal entries? Untouched examples are excluded; the browser copy will remain.", { n: legacy.length }),
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
  toast(tx("Personal entries imported. The old browser copy is unchanged."));
}
function closeDialog(id) {
  $("#" + id).close();
}
const usd = (v) => (v === null || v === undefined ? tx("unknown") : v > 0 && v < 0.01 ? "<" + fmt.money(0.01, "USD") : fmt.money(v, "USD"));
const localTrusted = () => state.providers?.find((p) => p.provider === "local")?.trusted !== false;
const isCloudModel = (a) => !!a && (a.provider !== "local" || !localTrusted() || /[:-]cloud$/i.test(a.model || ""));
const priceName = (m) => String(m || "").trim().toLowerCase().replace(/[:-]cloud$/, "");
const isUnpriced = (a) => !!state.cost && !!a?.model && isCloudModel(a) && !state.cost?.settings.prices[`${a.provider}:${priceName(a.model)}`] && !state.cost?.settings.prices[priceName(a.model)];
const cloudMark = (a) => (isCloudModel(a) ? '<span class="cloud-mark" title="' + tx("Cloud model: prompts leave this computer") + '">' + tx("cloud") + "</span>" : "") + (isUnpriced(a) ? ' <span class="cloud-mark warn" title="' + tx("No price set: Spark uses a local model instead") + '">' + tx("no price") + "</span>" : "");
const lockIcon = '<svg class="lock-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
function runCostText(id) {
  const c = state.cost?.byRun?.[id];
  if (!c) return "";
  return tx("{n} tokens · {cost}", { n: fmt.num(c.tokensIn + c.tokensOut, 0), cost: c.cloudCalls ? (c.unknown ? tx("cost unknown") : usd(c.costUsd)) : tx("local, $0") });
}
const startsAt = (iso) => fmt.weekdayTime(iso);
const jobNote = (j) => (j.status === "queued" && j.scheduledFor && Date.parse(j.scheduledFor) > Date.now() ? " · " + tx("waits for off-peak, starts {when}", { when: startsAt(j.scheduledFor) }) : "");
const jobCost = (j) => (runCostText(j.id) ? " · " + runCostText(j.id) : "");
const estimates = {};
async function loadEstimate(id, kind) {
  const box = $(`#cost-estimate-${kind}`);
  if (!box) return;
  const key = id + kind;
  try {
    estimates[key] ||= await api(`/api/ideas/${encodeURIComponent(id)}/estimate?kind=${kind}`);
  } catch {
    return;
  }
  const e = estimates[key],
    when = $(`#job-when-${kind}`);
  if (e.private) box.innerHTML = `${lockIcon} ${tx("Private: nothing about this entry leaves this computer.")}`;
  else if (e.costNowUsd === null) box.textContent = tx("Estimate unavailable: a cloud model has no price. Add one in Settings. About {tin} tokens in, {tout} out.", { tin: fmt.num(e.tokensIn, 0), tout: fmt.num(e.tokensOut, 0) });
  else box.textContent = tx("≈ {off} (off-peak) / {now} now · {basis}", { off: usd(e.costOffPeakUsd), now: usd(e.costNowUsd), basis: tx(e.basis) }) + (e.offPeakNow ? " · " + tx("it is off-peak now") : "");
  if (when) when.querySelector('option[value="offpeak"]').textContent = e.offPeakNow || e.private ? tx("Wait for off-peak (cheaper)") : tx("Wait for off-peak (cheaper), starts {when}", { when: startsAt(e.nextOffPeak) });
}
const STAGE_LABELS = { grill: tx("Grill"), board: tx("Board"), competitors: tx("Competitors"), panel: tx("Panel"), pricing: tx("Pricing"), cfo: tx("Unit economics"), marketing: tx("Marketing"), brand: tx("Brand"), experiment: tx("Experiment"), frame: tx("Frame"), search: tx("Search"), screen: tx("Screen"), map: tx("Map"), differ: tx("Differ"), next: tx("Next step"), summary: tx("Summary") };
const STAGE_STATUS = { pending: tx("Not started"), running: tx("Running"), waiting_user: tx("Waiting for you"), done: tx("Done"), failed: tx("Did not finish") };
const JOB_STATUS = { queued: tx("Queued"), running: tx("Running"), waiting_user: tx("Waiting for you"), stopped: tx("Stopped"), done: tx("Finished"), failed: tx("Failed"), cancelled: tx("Cancelled") };
const jobActive = (j) => ["queued", "running", "waiting_user"].includes(j.status);
const jobsFor = (ideaId) => (state.jobs || []).filter((j) => j.ideaId === ideaId && j.kind !== "research_pipeline");
const questionCount = (text) => (String(text).match(/^[^\w\n]{0,8}Q\d+\b/gm) || []).length;
const seconds = (ms) => (ms ? fmt.num(ms / 1000, ms < 10000 ? 1 : 0) + " s" : "");
const recordTitle = (id) => state.records.find((r) => r.id === id && !r.deleted)?.title;
function jobStageRow(j, st) {
  const here = j.stage === st.name && jobActive(j),
    stopped = j.gate?.stage === st.name,
    label = stopped ? (j.gate.kind === "cap" ? tx("Paused at call limit") : tx("Stopped at gate")) : st.status === "done" ? (st.stale ? tx("Done, outdated") : st.output?.incomplete ? tx("Done, incomplete") : st.cached ? tx("Done (reused)") : tx("Done")) : STAGE_STATUS[st.status] || st.status,
    cls = stopped || st.status === "failed" ? "bad" : st.status === "done" ? "ok" : st.status === "waiting_user" || here ? "now" : "";
  const outputs = (st.output?.recordIds || []).map((id) => (recordTitle(id) ? `<button type="button" class="text-button" data-edit="${esc(id)}">${esc(recordTitle(id))}</button>` : "")).join(" ");
  const meta = [st.usage?.calls ? tp("{n} call|{n} calls", st.usage.calls) : "", seconds(st.usage?.ms)].filter(Boolean).join(" · ");
  return `<li class="${cls}"><span class="vt-name">${esc(STAGE_LABELS[st.name] || st.name)}</span><span class="vt-state">${esc(label)}</span><span class="vt-meta">${esc(meta)}</span>${st.output?.summary ? `<span class="vt-out">${esc(tx(st.output.summary))}</span>` : ""}${outputs ? `<span class="vt-out">${outputs}</span>` : ""}${stopped ? `<span class="vt-gate">${esc(tx(j.gate.reason))}</span>` : ""}${retryNote(j, stageProblem(j, st))}</li>`;
}
function jobWaiting(j, compact) {
  const w = j.waiting;
  if (j.status !== "waiting_user" || !w) return "";
  if (j.kind === "research_pipeline") return researchWaiting(j, compact);
  if (w.kind === "grill") {
    const n = questionCount(w.text);
    return `<div class="job-ask"><p><strong>${n ? tp("Spark has {n} question about {title}|Spark has {n} questions about {title}", n, { title: esc(j.ideaTitle) }) : tx("Spark has some questions about {title}", { title: esc(j.ideaTitle) })}</strong> <small>${tx("round {round}", { round: esc(w.round) })}</small></p><pre class="grill-text">${esc(w.text)}</pre>${w.fatal ? `<p class="gate">${tx("Possible dealbreaker: {reason}", { reason: esc(w.fatal) })}</p>` : ""}<textarea class="job-answer" data-job="${esc(j.id)}" rows="5" maxlength="6000" placeholder="${tx("Answer by number. Write yes to accept a recommended answer.")}" aria-label="${tx("Your answers")}"></textarea><div class="config-actions"><button type="button" class="button primary" data-job-answer="${esc(j.id)}">${tx("Send answers")}</button><button type="button" class="button secondary" data-job-enough="${esc(j.id)}">${tx("Enough questions — continue")}</button>${w.fatal ? `<button type="button" class="button secondary" data-job-park="${esc(j.id)}">${tx("Park this idea")}</button>` : ""}${w.threadId ? `<a class="button secondary" href="#chat/${esc(w.threadId)}">${tx("Open thread")}</a>` : ""}</div></div>`;
  }
  if (w.kind === "approve_profile")
    return `<div class="job-ask"><p><strong>${tx("Check the customer profile for {title}", { title: esc(j.ideaTitle) })}</strong></p><p>${tx("The panel plays buyers dealt from this simulated profile. Edit the note if it is wrong, then approve it.")}${w.message ? " " + esc(tx(w.message)) : ""}</p><div class="config-actions"><button type="button" class="button secondary" data-edit="${esc(w.noteId)}">${tx("Open profile")}</button><button type="button" class="button primary" data-job-approve="${esc(j.id)}">${tx("Approve profile")}</button></div></div>`;
  if (w.kind === "need_price")
    return `<div class="job-ask"><p><strong>${tx("What price should the buyers see for {title}?", { title: esc(j.ideaTitle) })}</strong></p><p>${esc(tx(w.message))}</p><label>${tx("Price to pitch {currency}", { currency: esc(w.currency || "") })}<input type="number" min="0" step="any" class="job-price" data-job="${esc(j.id)}" aria-label="${tx("Price to pitch")}"></label><div class="config-actions"><button type="button" class="button primary" data-job-price="${esc(j.id)}">${tx("Pitch at this price")}</button><button type="button" class="button secondary" data-job-suggest="${esc(j.id)}">${tx("Let buyers suggest")}</button></div></div>`;
  return `<div class="job-ask"><p><strong>${esc(j.ideaTitle)}</strong></p><p>${esc(w.message ? tx(w.message) : tx("Spark needs something from you."))}</p><div class="config-actions"><button type="button" class="button secondary" data-edit="${esc(j.ideaId)}">${tx("Open idea")}</button><button type="button" class="button primary" data-job-continue="${esc(j.id)}">${tx("Continue")}</button></div></div>`;
}
function jobControls(j) {
  const out = [];
  if (j.status === "stopped" && j.gate?.kind === "gate") out.push(`<button type="button" class="button secondary" data-job-resume="${esc(j.id)}" data-override="1">${tx("Override and continue")}</button>`);
  else if (j.status === "stopped" && j.gate?.kind === "cap") out.push(`<button type="button" class="button secondary" data-job-resume="${esc(j.id)}">${tx("Allow {n} more calls and resume", { n: esc(j.caps.step || 25) })}</button>`);
  else if (["stopped", "failed"].includes(j.status)) out.push(`<button type="button" class="button secondary" data-job-resume="${esc(j.id)}">${tx("Resume")}</button>`);
  if (["queued", "running", "waiting_user", "stopped"].includes(j.status)) out.push(`<button type="button" class="button secondary" data-job-cancel="${esc(j.id)}">${tx("Cancel")}</button>`);
  return out.length ? `<div class="config-actions">${out.join("")}</div>` : "";
}
const SIM = '<span class="by-simulation">' + tx("Simulated") + "</span>";
function priceChart(j) {
  const o = j?.stages?.find((st) => st.name === "pricing")?.output;
  if (!o || !Number.isFinite(o.range?.[0]) || !Number.isFinite(o.range?.[1])) return "";
  const range = [Math.min(...o.range), Math.max(...o.range)],
    cur = (fieldDraft.currency || "").trim(),
    money = (n) => `${cur ? esc(cur) + " " : ""}${fmt.num(Number(n), 2)}`,
    own = String(fieldDraft.price ?? "").trim() === "" ? NaN : Number(fieldDraft.price),
    marks = [{ v: range[0], t: tx("Cheap edge"), k: "edge" }, { v: range[1], t: tx("Expensive edge"), k: "edge" }];
  if (Number.isFinite(o.points?.OPP)) marks.push({ v: o.points.OPP, t: tx("Best price"), k: "best" });
  if (Number.isFinite(o.points?.IPP)) marks.push({ v: o.points.IPP, t: tx("Indifference"), k: "ipp" });
  for (const c of (o.competitorPrices || []).slice(0, 4)) marks.push({ v: c, t: tx("Competitor"), k: "comp" });
  if (Number.isFinite(own)) marks.push({ v: own, t: tx("Your price"), k: "own" });
  marks.sort((a, b) => a.v - b.v);
  let lo = marks[0].v,
    hi = marks.at(-1).v;
  const pad = (hi - lo || hi || 1) * 0.12;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const at = (v) => ((v - lo) / (hi - lo)) * 100,
    last = [-99, -99, -99, -99];
  for (const m of marks) {
    const x = at(m.v);
    m.lane = [0, 1, 2, 3].find((l) => x - last[l] > 34) ?? last.indexOf(Math.min(...last));
    last[m.lane] = x;
  }
  const pos = Number.isFinite(own) ? (own - range[0]) / ((range[1] - range[0]) || 1) : null,
    spot = pos === null ? "" : own < range[0] ? tx("is below that range") : own > range[1] ? tx("is above that range") : pos < 0.34 ? tx("sits near the low end") : pos > 0.66 ? tx("sits near the high end") : tx("sits in the middle"),
    verdict = `<p class="vw-verdict">${pos === null ? (Number.isFinite(o.points?.OPP) ? tx("Buyers accept {lo} to {hi}; the best price is about {best}.", { lo: money(range[0]), hi: money(range[1]), best: money(o.points.OPP) }) : tx("Buyers accept {lo} to {hi}.", { lo: money(range[0]), hi: money(range[1]) })) : tx("Buyers accept {lo} to {hi}; your {own} {spot}.", { lo: money(range[0]), hi: money(range[1]), own: money(own), spot })}</p>`;
  return `<figure class="chart"><figcaption><h3>${tx("What price feels right")}</h3><p class="hint">${tx("The range simulated buyers accept, from their four price answers.")}${o.rangeReversed ? " " + tx("The range was weak, so its edges were swapped.") : ""}</p></figcaption><div class="vw" role="img" aria-label="${Number.isFinite(o.points?.OPP) ? tx("Acceptable price range {lo} to {hi}, best price {best}", { lo: money(range[0]), hi: money(range[1]), best: money(o.points.OPP) }) : tx("Acceptable price range {lo} to {hi}", { lo: money(range[0]), hi: money(range[1]) })}"><div class="vw-track"><i class="vw-range" data-css="left:${at(range[0])}%;width:${at(range[1]) - at(range[0])}%"></i></div>${marks.map((m) => `<span class="vw-mk k-${m.k} lane-${m.lane}${at(m.v) < 16 ? " at-start" : at(m.v) > 84 ? " at-end" : ""}" data-css="left:${at(m.v)}%"><em>${m.t} <strong>${money(m.v)}</strong></em></span>`).join("")}</div>${verdict}</figure>`;
}
function rsMap(j, v) {
  const papers = v?.papers || [],
    map = j?.stages?.find((st) => st.name === "map")?.output;
  if (!papers.length && !map) return "";
  const chart = rsYears(papers),
    byId = new Map(papers.map((p) => [p.id, p])),
    cite = (ids) => ids.map((id) => byId.get(id)).filter(Boolean).slice(0, 4).map((p) => {
      const t = p.title.length > 64 ? p.title.slice(0, 62) + "…" : p.title;
      return safeHref(p.url) ? `<a href="${esc(safeHref(p.url))}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : esc(t);
    }).join(" · "),
    themes = map?.themes?.length ? `<h4>${tx("Themes")} ${SIM}</h4><ul class="themes">${map.themes.map((t) => `<li><strong>${esc(t.name)}</strong> <small>${tp("{n} paper|{n} papers", t.paperIds.length)}</small><p class="hint">${cite(t.paperIds)}</p></li>`).join("")}</ul>` : "",
    gaps = map?.gaps?.length ? `<h4>${tx("Gaps the model sees")} ${SIM}</h4><ul class="rs-diffs">${map.gaps.map((g) => `<li><p>${esc(g.text)}</p><p class="hint">${tp("Backed by {n} paper|Backed by {n} papers", g.paperIds.length)}</p></li>`).join("")}</ul>` : "";
  return `<div class="litmap">${chart}${themes}${gaps}</div>`;
}
function validationCard(idea) {
  const jobs = jobsFor(idea.id),
    j = jobs[0],
    ready = !!(state.assistant.planner?.model && state.assistant.writer?.model),
    models = j ? [j.models.planner, j.models.writer, j.models.simulation] : [];
  return `${
    j
      ? `<div class="vt-head"><span>${esc(JOB_STATUS[j.status] || j.status)}${j.stage && jobActive(j) ? " · " + esc(STAGE_LABELS[j.stage] || j.stage) : ""}${esc(jobNote(j))}</span><span class="vt-count">${tx("{used} of {cap} model calls", { used: esc(j.usage.calls), cap: esc(j.caps.calls) })}${esc(jobCost(j))}</span></div><div class="vt-bar" role="progressbar" aria-label="${tx("Test progress")}" aria-valuemin="0" aria-valuemax="${j.stages.length}" aria-valuenow="${j.stages.filter((st) => st.status === "done").length}">${j.stages.map((st) => `<i class="${j.gate?.stage === st.name || st.status === "failed" ? "bad" : st.status === "done" ? "ok" : st.status === "waiting_user" || (j.stage === st.name && jobActive(j)) ? "now" : ""}"></i>`).join("")}</div><ol class="vt">${j.stages.map((st) => jobStageRow(j, st)).join("")}</ol>${jobProblem(j) ? `<p class="gate">${esc(jobProblem(j))}</p>` : ""}${jobWaiting(j)}${jobControls(j)}<p class="hint">${tx("Grill method adapted from Matt Pocock's grilling skill (MIT). Models: {models}{kind}", { models: esc(models.map((m) => m.model).filter((m, i, a) => a.indexOf(m) === i).join(", ")), kind: models.some((m) => m.provider !== "local") ? " (" + tx("cloud") + ")" : " (" + tx("local") + ")" })}</p>`
      : ""
  }<h3 class="run-head">${tx("Run a test")} ${SIM}</h3>${
    ready
      ? `<div class="config-actions"><label class="inline-field">${tx("Panel")}<select id="job-panel-size"><option value="20">${tx("20 buyers")}</option><option value="100">${tx("100 buyers (slower)")}</option></select></label><label class="inline-field">${tx("When")}<select id="job-when-test"><option value="now">${tx("Run now")}</option><option value="offpeak">${tx("Wait for off-peak (cheaper)")}</option></select></label><button type="button" class="button primary" id="test-idea"${jobs.some(jobActive) ? " disabled" : ""}>${tx("Test this idea")}</button></div><p class="hint" id="cost-estimate-test">${tx("Estimating cost…")}</p>`
      : `<p class="hint">${tx("Choose planner and writer models under Settings first.")}</p>`
  }<details class="bridge"><summary>${tx("Run it in Claude Code instead")}</summary><p class="hint">${tx("Writes this idea to a folder on this computer. You run the commands yourself; Spark never starts Claude Code.")}</p><div class="config-actions"><button type="button" class="button secondary" id="founder-export">${tx("Export to folder")}</button><button type="button" class="button secondary" id="founder-import">${tx("Import results")}</button></div><div id="founder-out"></div></details>`;
}
function renderValidation() {
  const panel = $("#validation-panel"),
    id = $("#record-id").value,
    idea = id && $("#record-type").value === "idea" ? state.records.find((r) => r.id === id) : null;
  panel.hidden = !idea;
  renderGlance();
  if (!idea) return;
  const typed = $("#validation-panel .job-answer")?.value || "",
    open = $("#validation-panel .bridge")?.open,
    size = $("#job-panel-size")?.value,
    when = $("#job-when-test")?.value,
    out = $("#founder-out")?.innerHTML || "";
  panel.innerHTML = validationCard(idea);
  paintCharts(panel);
  if (typed && $("#validation-panel .job-answer")) $("#validation-panel .job-answer").value = typed;
  if (open) $("#validation-panel .bridge").open = true;
  if (size && $("#job-panel-size")) $("#job-panel-size").value = size;
  if (when && $("#job-when-test")) $("#job-when-test").value = when;
  loadEstimate(id, "test");
  if (out) $("#founder-out").innerHTML = out;
}
const RS_FILTERS = { all: tx("All"), maybe: tx("Undecided"), include: tx("Included"), exclude: tx("Excluded"), suggested: tx("Model rated 2+") };
let rs = { forId: "", view: null, error: "", filter: "all", q: "", verified: false, sel: new Set(), claim: "", cite: null, busy: "", frameDraft: null, queryDraft: null };
const researchJob = (ideaId) => (state.jobs || []).filter((j) => j.ideaId === ideaId && j.kind === "research_pipeline")[0];
function researchWaiting(j, compact) {
  const w = j.waiting,
    id = esc(j.id),
    open = `<button type="button" class="button secondary" data-rs-open="${esc(j.ideaId)}">${tx("Open research")}</button>`;
  if (compact) {
    if (w.kind === "screening") {
      const n = w.counts?.maybe;
      return `<div class="job-ask"><p><strong>${tx("{title}: waiting for your screening", { title: esc(j.ideaTitle) })}</strong></p><p>${n === undefined ? tx("Papers are waiting for your include or exclude decision.") : tp("{n} paper is waiting for your include or exclude decision.|{n} papers are waiting for your include or exclude decision.", n)}</p><div class="config-actions">${open}</div></div>`;
    }
    return `<div class="job-ask"><p><strong>${tx("{title}: research is waiting for you", { title: esc(j.ideaTitle) })}</strong></p><p>${esc({ frame: tx("Check the research frame."), frame_followup: tx("Spark has a follow-up question."), queries: tx("Check the search queries."), need_input: w.message ? tx(w.message) : tx("Choose papers first.") }[w.kind] || tx("Spark needs something from you."))}</p><div class="config-actions">${open}</div></div>`;
  }
  if (w.kind === "frame") {
    const d = w.draft || {},
      f = (key, label) => `<label>${label}<textarea data-rs-frame="${key}" rows="2" maxlength="${key === "known" ? 2000 : 500}">${esc(rs.frameDraft?.[key] ?? d[key] ?? "")}</textarea></label>`;
    return `<div class="job-ask"><p><strong>${tx("Frame the research")}</strong> <small>${tx("The model drafted this from your idea. Edit it, it is your frame.")}</small></p>${f("question", tx("Research question"))}${f("contribution", tx("Intended contribution"))}${f("method", tx("Method or approach"))}${f("population", tx("Population, system or dataset"))}${f("known", tx("Papers you already know (DOIs or links, optional)"))}<div class="config-actions"><button type="button" class="button primary" data-rs-frame-send="${id}">${tx("Save frame and continue")}</button><button type="button" class="button secondary" data-job-cancel="${id}">${tx("Cancel")}</button></div></div>`;
  }
  if (w.kind === "frame_followup")
    return `<div class="job-ask"><p><strong>${tx("One more question")}</strong></p><pre class="grill-text">${esc(w.text)}</pre><textarea class="job-answer" data-rs-follow rows="3" maxlength="3000" aria-label="${tx("Your answer")}"></textarea><div class="config-actions"><button type="button" class="button primary" data-rs-follow-send="${id}">${tx("Send answer")}</button><button type="button" class="button secondary" data-rs-follow-skip="${id}">${tx("Skip")}</button></div></div>`;
  if (w.kind === "queries") {
    const qs = rs.queryDraft || w.queries || [];
    return `<div class="job-ask"><p><strong>${tx("Search queries")}</strong> <small>${tx("Broad to narrow. Edit, remove or add up to 5. They are sent to OpenAlex, Crossref and arXiv.")}</small></p><div class="rs-queries">${qs.map((q, i) => `<div class="rs-query"><input data-rs-query="${i}" value="${esc(q)}" maxlength="200" aria-label="${tx("Query {n}", { n: i + 1 })}"><button type="button" class="button secondary" data-rs-query-del="${i}" aria-label="${tx("Remove query {n}", { n: i + 1 })}">${tx("Remove")}</button></div>`).join("")}</div><div class="config-actions">${qs.length < 5 ? `<button type="button" class="button secondary" data-rs-query-add="1">${tx("Add query")}</button>` : ""}<button type="button" class="button primary" data-rs-queries-send="${id}">${tx("Search")}</button></div></div>`;
  }
  if (w.kind === "screening")
    return `<div class="job-ask"><p><strong>${tx("Screen the papers")}</strong></p><p>${tx("Include what is relevant and exclude the rest in the table below. Model ratings are suggestions only. Press Done screening when you are finished.")}</p><div class="config-actions"><button type="button" class="button primary" data-rs-done="${id}">${tx("Done screening")}</button></div></div>`;
  return `<div class="job-ask"><p>${esc(w.message ? tx(w.message) : tx("Spark needs something from you."))}</p><div class="config-actions"><button type="button" class="button primary" data-job-continue="${id}">${tx("Continue")}</button></div></div>`;
}
function rsMatches(p) {
  if (rs.filter === "suggested" ? !(p.suggestion?.score >= 2) : rs.filter !== "all" && p.decision !== rs.filter) return false;
  if (rs.verified && !p.verified) return false;
  const q = rs.q.trim().toLowerCase();
  return !q || [p.title, (p.authors || []).join(" "), p.venue, p.year].join(" ").toLowerCase().includes(q);
}
function rsRow(p) {
  const href = safeHref(p.url),
    sg = p.suggestion,
    src = p.via === "snowball" ? tx("Snowball") : (p.sources || []).join(", ");
  return `<li class="rs-row" data-decision="${esc(p.decision)}"><label class="rs-pick"><input type="checkbox" data-rs-pick="${esc(p.id)}"${rs.sel.has(p.id) ? " checked" : ""} aria-label="${tx("Select {title}", { title: esc(p.title) })}"></label><div class="rs-main"><strong>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>` : esc(p.title)}</strong><p class="hint">${p.verified ? `<span class="stage">${esc(p.verified.by === "crossref" ? tx("DOI verified") : tx("arXiv verified"))}</span> ` : ""}${esc((p.authors || []).slice(0, 3).join(", ") || tx("Unknown authors"))} · ${esc(p.year || tx("year unknown"))}${p.venue ? " · " + esc(p.venue) : ""}${src ? " · " + esc(src) : ""}</p>${sg ? `<p class="rs-suggest"><span class="by-simulation">${tx("Model {score} of 3", { score: esc(sg.score) })}</span> ${esc(sg.reason)}${sg.probs ? ` <span class="hint">${tx("Probabilities {list}", { list: sg.probs.map((x) => fmt.pct(x, 0)).join(" / ") })}</span>` : ""}${typeof sg.cosine === "number" ? ` <span class="hint">${tx("Similarity {n}", { n: fmt.num(sg.cosine, 2) })}</span>` : ""}</p>` : ""}${p.reason ? `<p class="hint">${tx("Your note: {note}", { note: esc(p.reason) })}</p>` : ""}<details><summary>${p.abstract ? tx("Abstract") : tx("No abstract stored")}</summary>${p.abstract ? `<p class="rs-abstract">${esc(p.abstract)}</p>` : ""}</details></div><div class="rs-decide" role="group" aria-label="${tx("Decision")}">${["include", "exclude", "maybe"].map((d) => `<button type="button" class="button ${p.decision === d ? "primary" : "secondary"}" data-rs-decide="${d}" data-id="${esc(p.id)}" aria-pressed="${p.decision === d}">${{ include: tx("Include"), exclude: tx("Exclude"), maybe: tx("Undecided") }[d]}</button>`).join("")}</div></li>`;
}
function rsTable(v) {
  if (!v?.papers?.length) return "";
  const rows = v.papers.filter(rsMatches),
    c = v.counts,
    off = rs.sel.size ? "" : " disabled",
    page = limited("papers", rows, rsRow);
  return `<h4>${tx("Screening")}</h4><p class="hint rs-counts">${tx("{inc} included · {exc} excluded · {may} undecided · {n} candidates", { inc: esc(c.include), exc: esc(c.exclude), may: esc(c.maybe), n: esc(v.papers.length) })}</p><div class="rs-tools"><label class="inline-field">${tx("Show")}<select id="rs-filter">${Object.entries(RS_FILTERS).map(([k, l]) => option(k, l, rs.filter)).join("")}</select></label><input id="rs-q" type="search" placeholder="${tx("Filter by title, author or year")}" value="${esc(rs.q)}" aria-label="${tx("Filter papers")}"><label class="inline-field"><input type="checkbox" id="rs-verified"${rs.verified ? " checked" : ""}> ${tx("Verified only")}</label></div><div class="rs-bulk"><label class="inline-field"><input type="checkbox" id="rs-all"> ${tx("Select shown ({n})", { n: rows.length })}</label><button type="button" class="button secondary" data-rs-bulk="include"${off}>${tx("Include selected")}</button><button type="button" class="button secondary" data-rs-bulk="exclude"${off}>${tx("Exclude selected")}</button><button type="button" class="button secondary" data-rs-bulk="maybe"${off}>${tx("Reset selected")}</button></div><ul class="rs-list">${page.html || `<li class="hint">${tx("No papers match this filter.")}</li>`}</ul>${page.controls}`;
}
function rsDiffer(j) {
  const diffs = j?.stages?.find((s) => s.name === "differ")?.output?.differences;
  if (!diffs?.length) return "";
  const link = (h) => (safeHref(h.url) ? `<a href="${esc(safeHref(h.url))}" target="_blank" rel="noopener noreferrer">${esc(h.title)}</a>` : esc(h.title));
  return `<h4>${tx("Where yours may differ")} ${SIM}</h4><ul class="rs-diffs">${limited("diffs", diffs, (d) => `<li><p>${esc(d.text)}</p><p class="hint">${tx("Follow-up query: {query}", { query: esc(d.query) })}</p>${(d.hits || []).length ? `<ul>${d.hits.map((h) => `<li>${h.flagged ? `<span class="stage">${tx("May undercut novelty")}</span> ` : ""}${link(h)}${h.why ? ` <span class="hint">${esc(h.why)}</span>` : ""}</li>`).join("")}</ul>` : ""}</li>`, 5, 5).html}</ul>${limited("diffs", diffs, () => "", 5, 5).controls}`;
}
function rsCite(v) {
  if (!v?.counts?.include) return "";
  const c = rs.cite,
    item = (r) => `<li><strong>${safeHref(r.url) ? `<a href="${esc(safeHref(r.url))}" target="_blank" rel="noopener noreferrer">${esc(r.short || r.title)}</a>` : esc(r.title)}</strong> <span class="stage">${tx("from {level}", { level: esc(tx(r.level)) })}</span>${r.quote ? `<blockquote>${esc(r.quote)}</blockquote>` : `<p class="hint">${esc(tx(r.note))}</p>`}</li>`,
    none = `<li class="hint">${tx("None found in the abstracts.")}</li>`;
  return `<h4>${tx("Cite check")}</h4><p class="hint">${tx("Type a claim. A model sorts your included papers by abstract, and every quote is checked against the stored abstract.")}</p><label>${tx("Claim")}<textarea id="rs-claim" rows="2" maxlength="600">${esc(rs.claim)}</textarea></label><div class="config-actions"><button type="button" class="button secondary" id="rs-cite"${rs.busy === "cite" ? " disabled" : ""}>${rs.busy === "cite" ? tx("Checking…") : tx("Check claim")}</button><a class="button secondary" href="/api/ideas/${encodeURIComponent(rs.forId)}/research/bibtex" download="references.bib">${tx("Download BibTeX ({n})", { n: esc(v.counts.include) })}</a></div>${c ? `<div class="rs-cite">${c.unchecked ? `<div class="retry-note incomplete"><p>${tp("{n} paper could not be checked this time.|{n} papers could not be checked this time.", c.unchecked)}</p><button type="button" class="button secondary" id="rs-cite">${tx("Retry this step")}</button></div>` : ""}<h5>${tx("Supporting ({n})", { n: c.supporting.length })}</h5><ul>${c.supporting.map(item).join("") || none}</ul><h5>${tx("Challenging ({n})", { n: c.challenging.length })}</h5><ul>${c.challenging.map(item).join("") || none}</ul><p class="hint">${esc(tx(c.note))} ${c.noAbstract ? tx("Checked {n} abstracts, {m} included papers have no abstract.", { n: esc(c.checked), m: esc(c.noAbstract) }) : tx("Checked {n} abstracts.", { n: esc(c.checked) })}</p></div>` : ""}`;
}
function renderResearchRun() {
  const panel = $("#research-run-panel");
  if (!panel) return;
  const id = $("#record-id").value,
    idea = id && $("#record-type").value === "idea" ? state.records.find((r) => r.id === id) : null;
  panel.hidden = !idea;
  const j = idea && researchJob(idea.id);
  renderGlance();
  if (!idea) return;
  const focus = document.activeElement?.id,
    when = $("#job-when-research")?.value,
    ready = !!(state.assistant.planner?.model && state.assistant.writer?.model),
    v = rs.view;
  panel.innerHTML = `<h3>${tx("Research this")} ${SIM}</h3><p class="hint">${tx("Spark frames the question with you, searches OpenAlex, Crossref and arXiv, and lists only papers it could verify. You decide what is included.")}</p>${
    ready
      ? `<div class="config-actions"><label class="inline-field">${tx("When")}<select id="job-when-research"><option value="now">${tx("Run now")}</option><option value="offpeak">${tx("Wait for off-peak (cheaper)")}</option></select></label><button type="button" class="button primary" id="research-start"${j && jobActive(j) ? " disabled" : ""}>${j ? tx("Research again") : tx("Research this")}</button></div><p class="hint" id="cost-estimate-research">${tx("Estimating cost…")}</p>`
      : `<p class="hint">${tx("Choose planner and writer models under Settings first.")}</p>`
  }${
    j
      ? `<div class="vt-head"><span>${esc(JOB_STATUS[j.status] || j.status)}${j.stage && jobActive(j) ? " · " + esc(STAGE_LABELS[j.stage] || j.stage) : ""}${esc(jobNote(j))}</span><span class="vt-count">${tx("{used} of {cap} model calls", { used: esc(j.usage.calls), cap: esc(j.caps.calls) })}${esc(jobCost(j))}</span></div><div class="vt-bar" role="progressbar" aria-label="${tx("Research progress")}" aria-valuemin="0" aria-valuemax="${j.stages.length}" aria-valuenow="${j.stages.filter((st) => st.status === "done").length}">${j.stages.map((st) => `<i class="${j.gate?.stage === st.name || st.status === "failed" ? "bad" : st.status === "done" ? "ok" : st.status === "waiting_user" || (j.stage === st.name && jobActive(j)) ? "now" : ""}"></i>`).join("")}</div><ol class="vt">${j.stages.map((st) => jobStageRow(j, st)).join("")}</ol>${jobProblem(j) ? `<p class="gate">${esc(jobProblem(j))}</p>` : ""}${jobWaiting(j)}${jobControls(j)}`
      : ""
  }${rs.error ? `<p class="gate">${esc(tx(rs.error))}</p>` : ""}${j ? j.stages.map((st) => retryNote(j, stageProblem(j, st), true)).join("") : ""}${rsMap(j, v)}${rsTable(v)}${rsDiffer(j)}${rsCite(v)}`;
  paintCharts(panel);
  if (when && $("#job-when-research")) $("#job-when-research").value = when;
  loadEstimate(id, "research");
  const el = focus && $("#" + focus);
  if (el && ["rs-q", "rs-claim", "rs-filter"].includes(focus)) {
    el.focus();
    if (el.type === "search") el.setSelectionRange(el.value.length, el.value.length);
  }
}
async function loadResearch(force) {
  const id = $("#record-id").value;
  if (!id || $("#record-type").value !== "idea") return renderResearchRun();
  if (rs.forId !== id) rs = { ...rs, forId: id, view: null, error: "", filter: "all", q: "", verified: false, sel: new Set(), claim: "", cite: null, busy: "", frameDraft: null, queryDraft: null };
  else if (!force && rs.view) return renderResearchRun();
  try {
    const view = await api(`/api/ideas/${encodeURIComponent(id)}/research`);
    if (rs.forId === id) {
      rs.view = view;
      rs.error = "";
    }
  } catch (e) {
    rs.error = e.message;
  }
  renderResearchRun();
}
async function rsDecide(ids, decision) {
  try {
    await api(`/api/ideas/${encodeURIComponent(rs.forId)}/research/decisions`, { method: "POST", data: { paperIds: ids, decision } });
    rs.sel = new Set();
    await loadResearch(true);
  } catch (e) {
    toast(tx(e.message));
  }
}
async function handleResearchClick(b) {
  const jobUrl = (jid, action) => "/api/jobs/" + encodeURIComponent(jid) + "/" + action;
  const after = async (jid, data) => {
    await jobAction(jobUrl(jid, "answer"), data);
    rs.frameDraft = rs.queryDraft = null;
    await loadResearch(true);
  };
  if (b.id === "research-start") {
    const id = $("#record-id").value;
    if (!(await settle(tx("Spark researches the saved version of this idea, without your unsaved changes. Continue?")))) return true;
    b.disabled = true;
    rs.view = null;
    await jobAction("/api/ideas/" + encodeURIComponent(id) + "/research", { when: $("#job-when-research").value }, tx("Research started. You can leave this page; it keeps running."));
    await loadResearch(true);
    return true;
  }
  if (b.dataset.rsOpen) {
    if (!state.records.some((r) => r.id === b.dataset.rsOpen)) return true;
    goEntry(b.dataset.rsOpen, { open: "research" });
    return true;
  }
  if (b.dataset.rsFrameSend) {
    const frame = {};
    for (const el of $$("[data-rs-frame]")) frame[el.dataset.rsFrame] = el.value;
    await after(b.dataset.rsFrameSend, { frame });
    return true;
  }
  if (b.dataset.rsFollowSend || b.dataset.rsFollowSkip) {
    await after(b.dataset.rsFollowSend || b.dataset.rsFollowSkip, b.dataset.rsFollowSkip ? { skip: true } : { text: $("[data-rs-follow]")?.value || "" });
    return true;
  }
  if (b.dataset.rsQueriesSend) {
    await after(b.dataset.rsQueriesSend, { queries: $$("[data-rs-query]").map((el) => el.value).filter((q) => q.trim()) });
    return true;
  }
  if (b.dataset.rsQueryAdd !== undefined || b.dataset.rsQueryDel !== undefined) {
    rs.queryDraft = $$("[data-rs-query]").map((el) => el.value);
    if (b.dataset.rsQueryDel !== undefined) rs.queryDraft.splice(Number(b.dataset.rsQueryDel), 1);
    else rs.queryDraft.push("");
    renderResearchRun();
    return true;
  }
  if (b.dataset.rsDone) {
    await after(b.dataset.rsDone, { done: true });
    return true;
  }
  if (b.dataset.rsDecide) {
    await rsDecide([b.dataset.id], b.dataset.rsDecide);
    return true;
  }
  if (b.dataset.rsBulk) {
    if (rs.sel.size) await rsDecide([...rs.sel], b.dataset.rsBulk);
    return true;
  }
  if (b.id === "rs-cite") {
    rs.claim = $("#rs-claim").value;
    rs.busy = "cite";
    rs.error = "";
    renderResearchRun();
    try {
      rs.cite = await api(`/api/ideas/${encodeURIComponent(rs.forId)}/research/cite`, { method: "POST", data: { claim: rs.claim } });
    } catch (e) {
      rs.error = _a3FriendlyRaw(e.message) ? tx(e.message) : tx("The claim could not be checked this time.");
    }
    rs.busy = "";
    renderResearchRun();
    return true;
  }
  return false;
}
document.addEventListener("input", (event) => {
  const t = event.target;
  if (t.id === "rs-q") {
    rs.q = t.value;
    delete dash.lim.papers;
    renderResearchRun();
  } else if (t.id === "rs-claim") rs.claim = t.value;
  else if (t.dataset?.rsFrame) (rs.frameDraft ||= {})[t.dataset.rsFrame] = t.value;
});
document.addEventListener("change", (event) => {
  const t = event.target;
  if (t.id === "rs-filter") (rs.filter = t.value), delete dash.lim.papers;
  else if (t.id === "rs-verified") (rs.verified = t.checked), delete dash.lim.papers;
  else if (t.dataset?.rsPick) {
    if (t.checked) rs.sel.add(t.dataset.rsPick);
    else rs.sel.delete(t.dataset.rsPick);
  } else if (t.id === "rs-all") {
    for (const p of rs.view?.papers || []) if (rsMatches(p)) t.checked ? rs.sel.add(p.id) : rs.sel.delete(p.id);
  } else return;
  renderResearchRun();
});

function jobAsks() {
  const waiting = (state.jobs || []).filter((j) => j.status === "waiting_user" && j.waiting);
  return waiting.length ? `<div class="section-heading"><h2>${tx("Spark is waiting for you")}</h2><span>${waiting.length}</span></div>${waiting.map((j) => `<div class="job-card">${jobWaiting(j, true)}</div>`).join("")}` : "";
}
function renderAsks() {
  const asks = $("#job-asks");
  if (!asks) return;
  const typed = $("#job-asks .job-answer")?.value || "";
  asks.innerHTML = jobAsks();
  asks.hidden = !asks.innerHTML;
  if (typed && $("#job-asks .job-answer")) $("#job-asks .job-answer").value = typed;
}
const jobSignature = () => JSON.stringify((state.jobs || []).map((j) => [j.id, j.status, j.stage, j.usage.calls, j.waiting?.round, j.waiting?.kind, j.summary?.at, j.stages.map((s) => s.status + (s.cached ? "c" : "")).join(",")]));
async function pollJobs() {
  if (!(state.jobs || []).some((j) => ["queued", "running"].includes(j.status))) return;
  try {
    const before = jobSignature();
    state = await api("/api/state");
    if (jobSignature() === before) return;
    if (entryVisible()) {
      renderValidation();
      loadSummary();
      if (!$(".job-answer:focus, #rs-claim:focus, #rs-q:focus, [data-rs-frame]:focus, [data-rs-query]:focus")) loadResearch(true);
    }
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
    if (entryVisible()) renderValidation(), loadResearch(true);
    renderAsks();
    if (message) toast(message);
  } catch (e) {
    toast(e.message);
  }
}
async function handleJobClick(b) {
  if (b.dataset.retry) {
    await retryStage(b.dataset.retry, b.dataset.retryStage);
    return true;
  }
  if (b.dataset.useNumbers) {
    await useNumbers();
    return true;
  }
  if (await handleResearchClick(b)) return true;
  const jobUrl = (id, action) => "/api/jobs/" + encodeURIComponent(id) + "/" + action;
  if (b.id === "test-idea") {
    const id = $("#record-id").value;
    b.disabled = true;
    b.textContent = tx("Starting…");
    if (!(await settle(tx("Spark tests the saved version of this idea, without your unsaved changes. Continue?")))) return true;
    await jobAction("/api/ideas/" + encodeURIComponent(id) + "/test", { panelN: Number($("#job-panel-size").value), when: $("#job-when-test").value }, tx("Testing started. You can leave this page; it keeps running."));
    renderValidation();
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
  if (b.dataset.jobPrice) {
    await jobAction(jobUrl(b.dataset.jobPrice, "answer"), { price: b.closest(".job-ask")?.querySelector(".job-price")?.value || "" });
    return true;
  }
  if (b.dataset.jobSuggest) {
    await jobAction(jobUrl(b.dataset.jobSuggest, "answer"), { suggest: true });
    return true;
  }
  if (b.dataset.jobApprove) {
    await jobAction(jobUrl(b.dataset.jobApprove, "answer"), { approve: true });
    return true;
  }
  if (b.dataset.jobPark) {
    if (confirm(tx("Move this idea to Parked and stop the test? You can override later."))) await jobAction(jobUrl(b.dataset.jobPark, "park"), {}, tx("Idea parked."));
    return true;
  }
  if (b.dataset.jobResume) {
    await jobAction(jobUrl(b.dataset.jobResume, "resume"), b.dataset.override ? { override: true } : {});
    return true;
  }
  if (b.dataset.jobCancel) {
    await jobAction(jobUrl(b.dataset.jobCancel, "cancel"), {}, tx("Test cancelled."));
    return true;
  }
  if (b.id === "founder-export" || b.id === "founder-import") {
    const id = $("#record-id").value,
      exporting = b.id === "founder-export",
      out = $("#founder-out");
    try {
      const r = await api("/api/ideas/" + encodeURIComponent(id) + "/founder-" + (exporting ? "export" : "import"), { method: "POST", data: {} });
      out.innerHTML = exporting
        ? `<p class="hint">${esc(tx(r.note))}</p><pre class="grill-text">${esc(r.commands.join("\n"))}</pre><p class="hint">${r.customer ? tx("Folder: {folder}", { folder: esc(r.folder) }) : tx("Folder: {folder}. No approved customer profile yet, so no customer.json was written; /founder-consumer will ask.", { folder: esc(r.folder) })}</p>`
        : `<p class="hint">${r.skipped.length ? tx("{n} imported under To review, {skipped} skipped.", { n: r.created.length, skipped: r.skipped.length }) : tx("{n} imported under To review.", { n: r.created.length })}</p>${r.created.map((x) => `<p class="hint">${esc(x.title)}</p>`).join("")}`;
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
  if (b.dataset.classPick) {
    await setType(b.dataset.classPick, b.dataset.type);
    return;
  }
  if (b.id === "add-link") {
    toggleLinkPop($("#link-pop").hidden);
    return;
  }
  if (b.dataset.linkAdd) {
    toggleLinkPop(false);
    setLink(b.dataset.linkAdd, true);
    return;
  }
  if (b.dataset.unlink) {
    setLink(b.dataset.unlink, false);
    return;
  }
  if (b.id === "quick-mic") {
    await quickRecord();
    return;
  }
  if (b.id === "add-competitor" || b.dataset.addCompetitor || b.dataset.researchEdit) {
    if (!(await settle(tx("Discard unsaved changes before opening a competitor?")))) return;
    if (b.dataset.researchEdit) goEntry(b.dataset.researchEdit);
    else await createEntry("competitor", { title: tx("New competitor"), links: [$("#record-id").value] }, { edit: "title" });
    return;
  }
  if (b.id === "founder-review") {
    if (!(await settle(tx("Start the review without your unsaved changes?")))) return;
    const idea = state.records.find((r) => r.id === $("#record-id").value);
    if (!idea) return;
    const latest = state.sessions.filter((s) => !s.deleted && s.agents[0]).sort((x, y) => (y.updated || "").localeCompare(x.updated || ""))[0]?.agents[0];
    const linkedIds = entries().filter((r) => r.id !== idea.id && ((r.links || []).includes(idea.id) || (idea.links || []).includes(r.id))).map((r) => r.id);
    const agents = ["boardOffer", "boardMonopoly", "boardProduct", "cfo", "launchLead"].map((role) => ({ ...newAgent(), name: roles[role], role, ...(latest ? { provider: latest.provider, model: latest.model } : {}) }));
    await newSession({ exactTitle: true, title: tx("{title} — founder review", { title: idea.title }), mode: "parallel", rounds: 1, localOnly: agents.every((x) => x.provider === "local"), agents, contextIds: [idea.id, ...linkedIds].slice(0, 50) });
    return;
  }
  if (b.dataset.close) {
    closeDialog(b.dataset.close);
    return;
  }
  if (b.hasAttribute("data-clear-search")) {
    query = "";
    $("#search").value = "";
    render();
    return;
  }
  if (b.dataset.new) {
    goCapture();
    return;
  }
  if (b.dataset.edit) {
    if (entryVisible() && b.dataset.edit !== $("#record-id").value && !(await settle(tx("Discard unsaved changes before opening this entry?")))) return;
    goEntry(b.dataset.edit);
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
  if (b.id === "private-toggle") {
    const id = $("#record-id").value,
      current = state.records.find((r) => r.id === id);
    if (!current) return;
    try {
      await api("/api/records/" + encodeURIComponent(id), { method: "PATCH", data: { private: !current.private } });
      await refresh(false);
      syncPrivate(state.records.find((r) => r.id === id));
      renderValidation();
      toast(current.private ? tx("No longer private.") : tx("Private: nothing about this entry leaves this computer."));
    } catch (e) {
      toast(e.message);
    }
    return;
  }
  if (b.id === "brief-button") {
    const ideaId = $("#record-id").value;
    if (!ideaId) return;
    if (!(await settle(tx("Discard unsaved changes before opening the brief?")))) return;
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
    $("#text-heading").textContent = tx("Selected workspace context");
    $("#text-content").textContent = result.text || tx("No entries selected.");
    $("#text-dialog").showModal();
    return;
  }
  if (b.dataset.messageContext) {
    const result = await api("/api/message-context", {
      method: "POST",
      data: { id: b.dataset.messageContext },
    });
    $("#text-heading").textContent = tx("Exact messages sent to the provider");
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
  if (b.dataset.scroll) {
    $(b.dataset.scroll)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    return;
  }
  if (b.dataset.scrollReview !== undefined) {
    $("#to-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (b.dataset.review || b.dataset.reviewAll || b.id === "assistant-accept" || b.id === "assistant-discard") {
    const action = b.id === "assistant-discard" ? "discard" : b.dataset.reviewAll || b.dataset.review || "accept",
      ids = b.dataset.ids ? b.dataset.ids.split(",") : [b.dataset.id],
      rows = b.id.startsWith("assistant-") ? [] : [...(b.dataset.reviewAll ? b.closest(".review-group")?.querySelectorAll(".review-row") || [b.closest(".review-row")] : [b.closest(".review-row")])].filter(Boolean),
      mark = (on) => rows.forEach((r) => { r.classList.toggle("leaving", on); r.classList.toggle(action, on); });
    mark(true);
    let result;
    try {
      if (b.id === "assistant-accept") await saveRecord().catch(() => {});
      [result] = await Promise.all([api("/api/assistant/review", { method: "POST", data: { action, ids } }), sleep(reducedMotion() ? 0 : 190)]);
    } catch (error) {
      mark(false);
      throw error;
    }
    const onPage = b.id.startsWith("assistant-");
    if (b.id === "assistant-discard") {
      clearTimeout(saveTimer);
      $("#record-id").value = "";
    }
    await refresh(!onPage);
    if (b.id === "assistant-accept") await loadEntry(state.records.find((r) => r.id === ids[0]));
    if (b.id === "assistant-discard") location.hash = $("#entry-back").getAttribute("href");
    toast(action === "accept" ? tp("{n} entry accepted.|{n} entries accepted.", result.changed) : tp("{n} entry moved to Trash.|{n} entries moved to Trash.", result.changed));
    return;
  }
  if (b.dataset.assistantStop) {
    await api("/api/runs/" + encodeURIComponent(b.dataset.assistantStop) + "/cancel", { method: "POST", data: {} });
    toast(tx("Stop requested. Entries already created are kept; Undo removes them."));
    return;
  }
  if (b.dataset.assistantUndo) {
    const run = await api("/api/assistant/runs/" + encodeURIComponent(b.dataset.assistantUndo) + "/undo", { method: "POST", data: {} });
    await refresh();
    const n = run.steps.at(-1).result.trashed;
    toast(tp("Run undone. {n} entry moved to Trash.|Run undone. {n} entries moved to Trash.", n));
    return;
  }
  if (b.id === "stop-run") {
    const id = b.dataset.run;
    if (id && id !== "starting") {
      await api("/api/runs/" + encodeURIComponent(id) + "/cancel", {
        method: "POST",
        data: {},
      });
      toast(tx("Stop requested. Partial replies will be preserved."));
      if (!activeRun) await refresh();
    }
    return;
  }
  if (b.dataset.trashRecord) {
    await api("/api/records/" + encodeURIComponent(b.dataset.trashRecord), { method: "DELETE" });
    await refresh();
    toast(tx("Moved to trash. You can restore it from Trash."));
    return;
  }
  if (b.id === "record-trash") {
    clearTimeout(saveTimer);
    await saving;
    const id = $("#record-id").value;
    $("#record-id").value = "";
    try {
      await api("/api/records/" + encodeURIComponent(id), { method: "DELETE" });
    } catch (error) {
      $("#record-id").value = id;
      throw error;
    }
    await refresh(false);
    location.hash = $("#entry-back").getAttribute("href");
    toast(tx("Moved to trash. You can restore it."));
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
            `<div class="backup-row"><span>${esc(name)}</span><button class="text-button" data-backup="${esc(name)}">${tx("Restore")}</button></div>`,
        )
        .join("") ||
      `<p class="muted">${tx("A backup is created after your first saved change.")}</p>`;
    return;
  }
  if (b.dataset.backup) {
    if (
      !confirm(
        tx("Restore this snapshot? Current entries are retained in trash and a recovery backup is created."),
      )
    )
      return;
    await api("/api/backups/restore", {
      method: "POST",
      data: { name: b.dataset.backup },
    });
    await refresh();
    toast(tx("Snapshot restored."));
  }
}
document.addEventListener("click", (event) => {
  handleClick(event).catch((error) => toast(error.message));
});
document.addEventListener("input", (event) => {
  if (event.target.matches("[data-field=researchQueries], #record-title")) updateResearchSearch();
  if (event.target.closest("[data-field]") && event.target.closest("#record-form")) renderMath();
});
document.addEventListener("submit", (event) => {
  event.preventDefault();
  (async () => {
    const form = event.target;
    if (form.id === "quick-form") {
      const title = $("#quick-title").value.trim();
      if (!title) return;
      const withAssistant = !quickBypass && assistantWanted(),
        add = $("#quick-add");
      quickBypass = false;
      add.disabled = true;
      add.textContent = tx("Adding…");
      let capture;
      try {
        capture = await api("/api/records", {
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
      } catch (error) {
        add.disabled = false;
        add.textContent = tx("Add to inbox");
        throw error;
      }
      quickAssist = null;
      justAdded = capture.id;
      setTimeout(() => (justAdded = ""), 1600);
      await refresh();
      if (withAssistant) runAssistant(capture.id).catch((error) => toast(error.message));
      else classifyQuiet(capture.id);
      return;
    }
    if (form.id === "session-form") {
      await saveSession(true);
      toast(tx("Configuration saved."));
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
          decision: { mode: f.decisionMode.value, model: f.decisionModel.value, threshold: Number(f.decisionThreshold.value) },
        },
      });
      render();
      toast(tx("Assistant settings saved."));
      return;
    }
    if (form.id === "cost-settings-form") {
      const prices = {};
      for (const tr of form.querySelectorAll("tr[data-price]")) {
        const v = (n) => tr.querySelector(`[name="${n}"]`).value;
        if (v("input") === "" && v("output") === "") continue;
        const p = { input: Number(v("input")), cached: Number(v("cached")), output: Number(v("output")) };
        if (v("off-input") !== "" || v("off-output") !== "") p.off = { input: Number(v("off-input")), cached: 0, output: Number(v("off-output")) };
        prices[tr.dataset.price] = p;
      }
      state.cost = await api("/api/cost/settings", { method: "POST", data: { budget: Number(form.elements.budget.value), prices } });
      render();
      toast(tx("Cost settings saved."));
      return;
    }
    if (form.id === "voice-settings-form") {
      const f = form.elements,
        data = { target: f.target.value, localBase: f.localBase.value, localModel: f.localModel.value, groqModel: f.groqModel.value, openaiModel: f.openaiModel.value, groqConsent: f.groqConsent.checked, openaiConsent: f.openaiConsent.checked, fallback: f.fallback.checked, fallbackTarget: f.fallbackTarget.value };
      if (f.groqKey.value) data.groqKey = f.groqKey.value;
      state.voice = await api("/api/voice/settings", { method: "POST", data });
      render();
      toast(tx("Transcription settings saved."));
      return;
    }
    if (form.classList.contains("provider-form")) {
      const provider = form.dataset.provider,
        key = form.elements.key.value,
        remove = form.elements.clear.checked,
        data = { provider };
      if (key || remove) data.key = remove ? "" : key;
      if (provider === "local") {
        data.base = form.elements.base.value;
        data.trusted = form.elements.trusted.checked;
      }
      const saved = await api("/api/providers", { method: "POST", data });
      if (provider === "openalex") state.openAlex = saved;
      else if (provider === "websearch") state.webSearch = saved;
      else state.providers = saved;
      form.elements.key.value = "";
      if (provider === "local") localModelsRequest = null;
      render();
      toast(tx("Provider settings saved."));
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
    if (input.name === "theme" && input.checked) window.sparkTheme?.set(input.value);
    if (input.name === "lang" && input.checked && input.value !== I18N.lang) {
      I18N.remember(input.value);
      api("/api/language", { method: "POST", data: { language: input.value } }).then(() => location.reload(), (e) => toast(e.message));
    }
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
    if (input.dataset.classSelect) {
      await setType(input.dataset.classSelect, input.value);
      return;
    }
    if (input.dataset.saveResponse) {
      const message = state.messages.find(
          (m) => m.id === input.dataset.saveResponse,
        ),
        type = input.value;
      if (type && message)
        await createEntry(type, {
          title: "",
          body:
            tx("{text}\n\nSource: {name} / {provider} / {model}\nModel suggestion — review before treating as evidence.", { text: message.text, name: message.agent.name, provider: message.agent.provider, model: message.agent.model }),
        });
      input.value = "";
    }
    if (input.id === "attachment-file") {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024)
        throw Error(tx("Maximum file size is 5 MB."));
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
      toast(tx("File attached."));
    }
    if (input.id === "import-file") {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 34000000) throw Error(tx("Use a backup smaller than 34 MB."));
      const archive = JSON.parse(await file.text()),
        mode = $("#import-mode").value;
      if (
        !confirm(
          mode === "merge" ? tx("Merge this backup? Matching IDs will be replaced. A recovery snapshot is created first.") : tx("Restore this backup? Matching IDs will be replaced. A recovery snapshot is created first."),
        )
      ) {
        input.value = "";
        return;
      }
      await api("/api/import", { method: "POST", data: { archive, mode } });
      await refresh();
      toast(tx("Backup imported."));
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
  if (query && route().view === "entry") {
    keepQuery = true;
    location.hash = $("#entry-back").getAttribute("href");
  } else render();
});
let keepQuery = false;
window.addEventListener("hashchange", async (event) => {
  let prev = "";
  try {
    prev = new URL(event.oldURL).hash;
  } catch {}
  const now = route(),
    wasEntry = prev.startsWith("#entry/"),
    id = $("#record-id").value;
  if (!wasEntry) backTo = prev || "#home";
  if (id && !(now.view === "entry" && now.id === id)) {
    await saveRecord().catch(() => {});
    if ($("#record-id").value === id && isDirty() && !confirm(tx("Some changes could not be saved (an entry needs a title). Leave anyway and lose them?"))) {
      location.hash = prev;
      return;
    }
  }
  if (now.view !== "entry" && !keepQuery && !(wasEntry && location.hash === backTo)) {
    query = "";
    $("#search").value = "";
  }
  keepQuery = false;
  stageFilter = "";
  render();
  window.scrollTo(0, 0);
});
$("#entry-back").addEventListener("click", () => {
  keepQuery = true;
});
$("#record-form").addEventListener("click", (event) => {
  const btn = event.target.closest(".rd-btn");
  if (btn) startEdit(btn.closest(".rd-wrap"));
});
$("#record-form").addEventListener("focusout", (event) => {
  const wrap = event.target.closest?.(".rd-wrap.editing");
  if (wrap && !wrap.contains(event.relatedTarget)) endEdit(wrap);
});
$("#record-form").addEventListener("input", (event) => {
  if (event.target.id === "record-body" || event.target.id === "record-title") growBody();
  const wrap = event.target.closest?.(".rd-wrap");
  if (wrap) refreshRead(wrap);
  scheduleSave();
});
$("#record-form").addEventListener("change", scheduleSave);
window.addEventListener("beforeunload", (event) => {
  if ($("#record-id").value && isDirty()) event.preventDefault();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && $("#record-id").value) saveRecord().catch(() => {});
});
document.addEventListener("input", (event) => {
  const m = event.target.id?.match(/^assistant-(planner|writer|simulation)-(model|provider)$/);
  if (!m) return;
  const mark = $(`#assistant-${m[1]}-cloud`);
  if (mark) mark.innerHTML = cloudMark({ provider: $(`#assistant-${m[1]}-provider`).value, model: $(`#assistant-${m[1]}-model`).value });
});
document.addEventListener("click", (event) => {
  for (const d of $$("details.menu[open]")) if (!d.contains(event.target) || event.target.closest(".menu-list button, .menu-list a")) d.open = false;
  if (!event.target.closest(".links-row") && !$("#link-pop").hidden) toggleLinkPop(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#link-pop").hidden) {
    event.preventDefault();
    toggleLinkPop(false);
    $("#add-link").focus();
    return;
  }
  if (event.key === "Enter" && event.target.id === "link-search") {
    event.preventDefault();
    $("#link-results [data-link-add]")?.click();
    return;
  }
  const editing = event.target.closest?.(".rd-wrap.editing");
  if (editing && (event.key === "Escape" || (event.key === "Enter" && (event.target.tagName !== "TEXTAREA" || event.target.id === "record-title")))) {
    event.preventDefault();
    endEdit(editing, true);
    return;
  }
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
    tx("Cannot connect to Spark."),
    tx("{message} Start the local server, then refresh this page.", { message: error.message }),
  );
  $("#footer").textContent = tx("Disconnected — changes have not been saved.");
});
