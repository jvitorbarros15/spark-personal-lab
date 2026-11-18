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
    activeRuns: [],
  },
  query = "",
  stageFilter = "",
  activeRun = null,
  streamingSession = null,
  recordDraft = null,
  fieldDraft = {},
  editorSnapshot = "",
  toastTimer;
const modelLists = {},
  promptDrafts = new Map();
const route = () => {
  const [view = "home", id = ""] = location.hash.slice(1).split("/");
  return { view: labels[view] ? view : "home", id };
};
const entries = () => state.records.filter((r) => !r.deleted);
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
  if (renderNow) render();
}
function empty(title, description, action = "") {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
}
function entryRow(r) {
  return `<button class="entry-row" data-edit="${esc(r.id)}"><span class="entry-type">${types[r.type]}</span><span class="entry-title">${esc(r.title)}${r.fields?.nextStep ? `<small>${esc(r.fields.nextStep)}</small>` : ""}</span><span class="stage">${esc(r.stage)}</span><time>${date(r.updated)}</time></button>`;
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
function home() {
  const all = entries(),
    inbox = all.filter((r) => r.type === "inbox"),
    progress = all.filter((r) =>
      ["exploring", "validating", "building"].includes(r.stage),
    ),
    actions = all.filter(
      (r) => r.fields?.nextStep && !["done", "parked"].includes(r.stage),
    );
  return `<div class="page-heading"><div><h1>Workspace</h1><p>What you are thinking about, and what comes next.</p></div></div><form id="quick-form" class="capture"><input id="quick-title" aria-label="Capture a thought" placeholder="Write a thought, a question, or something you noticed" maxlength="300" required><button class="button primary">Add to inbox</button></form>${legacyEntries().length ? `<div class="notice">${legacyEntries().length} personal entries found in the previous browser workspace. <button class="text-button" data-migrate>Import them into SQLite</button><small>Only your entries and edited examples are included. The old copy stays intact.</small></div>` : ""}${!all.length ? empty("An empty workspace, ready for your work.", "Start with one observation. You can organize it later.") : ""}<div class="home-grid"><section><div class="section-heading"><h2>Inbox</h2><a href="#inbox">${inbox.length} entries →</a></div>${recordList(inbox.slice(-5).reverse(), "Your inbox is clear.")}</section><section><div class="section-heading"><h2>In progress</h2><span>${progress.length}</span></div>${recordList(progress.slice(-5).reverse(), "No active work yet.")}</section><section><div class="section-heading"><h2>Next actions</h2></div>${recordList(actions.slice(0, 6), "No next actions yet.")}</section><section><div class="section-heading"><h2>Recently edited</h2></div>${recordList([...all].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6), "No recent entries.")}</section></div>`;
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
  return `<div class="page-heading"><div><h1>Settings</h1><p>Providers, local data, and recovery.</p></div></div><section class="settings-section"><h2>Model providers</h2><p class="muted">Keys stay in the local server’s ignored secrets file, never in browser storage or exports. They are stored as plain text on this computer. Environment variables take precedence.</p><div class="provider-grid">${state.providers.map((p) => `<form class="provider-form" data-provider="${p.provider}"><h3>${providers[p.provider]}</h3><p class="hint">${p.provider === "local" ? "Local endpoint; connection not yet verified" : p.configured ? "Key configured (" + esc(p.source) + ")" : "No API key configured"}</p>${p.provider === "local" ? `<label>OpenAI-compatible base URL<input name="base" value="${esc(p.base)}" required><small>Ollama: http://127.0.0.1:11434/v1 · LM Studio commonly uses port 1234.</small></label>` : ""}<label>${p.provider === "local" ? "API key (if required)" : "API key"}<input name="key" type="password" autocomplete="new-password" placeholder="Leave blank to keep the current key"></label><label class="checkbox"><input name="clear" type="checkbox"> Remove saved key</label><div class="config-actions"><button class="button secondary">Save</button><button type="button" class="text-button" data-settings-models="${p.provider}">Check connection / models</button></div><p class="hint model-result" id="provider-result-${p.provider}"></p></form>`).join("")}</div></section><section class="settings-section"><h2>Workspace data</h2><p class="muted">SQLite and attachments live in the project’s data folder. They are excluded from Git. Automatic backups keep the latest 20 snapshots, including conversations and files, without API keys.</p><div class="data-actions"><a class="button secondary" href="/api/export" download="spark-workspace.json">Export workspace</a><label class="file-label button secondary">Import backup<input type="file" id="import-file" accept=".json,application/json" hidden></label><label>Import behavior<select id="import-mode"><option value="merge">Merge by ID</option><option value="replace">Replace active workspace (old entries go to trash)</option></select></label><button class="button secondary" id="load-backups">Show recovery backups</button></div><div id="backup-list"></div>${legacyEntries().length ? `<button class="text-button" data-migrate>Import ${legacyEntries().length} personal entries from the old browser workspace</button>` : ""}<p class="hint">Imports are validated before changes. Merge overwrites matching IDs. Replacing retains old entries in trash. Attachments: 5 MB per file, 20 MB per workspace including trashed files. Images and PDFs are download-only; model chat currently supports text.</p></section>`;
}
function render() {
  const { view } = route();
  $("#breadcrumb").textContent = `Workspace / ${labels[view]}`;
  $("#nav").innerHTML = Object.entries(labels)
    .map(
      ([key, label]) =>
        `<a href="#${key}" ${view === key ? 'aria-current="page"' : ""}>${label}${types[key] ? `<span>${state.records.filter((r) => !r.deleted && r.type === key).length}</span>` : ""}</a>`,
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
            : collection(view);
  $("#footer").textContent =
    "Saved in SQLite on this computer · backups exclude API keys";
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
        `<label>${label}${key === "deadline" ? `<input type="date" data-field="${key}" value="${esc(fieldDraft[key] || "")}">` : key === "decision" ? `<select data-field="${key}">${option("", "Not decided", fieldDraft[key])}${["continue", "change direction", "stop"].map((v) => option(v, v, fieldDraft[key])).join("")}</select>` : `<textarea data-field="${key}" rows="2">${esc(fieldDraft[key] || "")}</textarea>`}</label>`,
    )
    .join("");
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
  $("#attachments-section").hidden = !record;
  renderFields();
  editorSnapshot = JSON.stringify(formRecord());
  $("#record-dialog").showModal();
  $("#record-title").focus();
  if (record) await loadAttachments(record.id);
}
async function loadAttachments(id) {
  const files = await api(
    `/api/attachments?recordId=${encodeURIComponent(id)}`,
  );
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
      title: source ? source.title + " — new discussion" : "New discussion",
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
async function discoverModels(provider, resultId) {
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
    toast(
      `${result.models.length} model IDs loaded. Choose a text model supported by this provider.`,
    );
  } finally {
    if (button) button.disabled = false;
  }
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
async function handleClick(event) {
  const b = event.target.closest("button,a");
  if (!b) return;
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
document.addEventListener("submit", (event) => {
  event.preventDefault();
  (async () => {
    const form = event.target;
    if (form.id === "quick-form") {
      const title = $("#quick-title").value.trim();
      if (!title) return;
      await api("/api/records", {
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
    if (form.classList.contains("provider-form")) {
      const provider = form.dataset.provider,
        key = form.elements.key.value,
        remove = form.elements.clear.checked,
        data = { provider };
      if (key || remove) data.key = remove ? "" : key;
      if (provider === "local") data.base = form.elements.base.value;
      state.providers = await api("/api/providers", { method: "POST", data });
      form.elements.key.value = "";
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
  if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey) && !$("dialog[open]")) {
    event.preventDefault();
    openRecord(null, "inbox").catch((error) => toast(error.message));
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
refresh().catch((error) => {
  $("#content").innerHTML = empty(
    "Cannot connect to Spark.",
    error.message + " Start the local server, then refresh this page.",
  );
  $("#footer").textContent = "Disconnected — changes have not been saved.";
});
