"use strict";
// Idea dashboard: the business model canvas, "Work on this idea" chat and the branch comparison.
// Loaded before app.js; everything here reads app.js globals (state, api, esc, fill, ideaJobs...) only when it runs.
const im = {
  forId: "",
  sig: "",
  canvas: { data: null, busy: false, error: "", editing: "", draft: "" },
  chat: { session: null, messages: [], private: false, busy: false, error: "", last: null, runId: "", loading: false, accepted: new Set(), plan: null, planError: "", draft: "" },
  tree: { data: null, error: "", loading: false },
};
const IM_PROMPTS = [
  ["Why did buyers pass?", "Why did the simulated buyers who said no pass? Group the reasons by segment and tell me which ones I could fix."],
  ["What if it were free?", "What if this were free, or close to it? What changes for the buyers, the numbers and the plan?"],
  ["Give me 3 pivots", "Give me 3 pivots: three different versions of this idea that are worth testing separately. Return each one as a branch proposal."],
  ["Branch this idea", "Suggest the single best branch of this idea to test next, as a branch proposal, and say plainly what is different."],
];
const imMoney = (n, cur) => (Number.isFinite(n) ? `${cur ? esc(cur) + " " : ""}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—");
const imParas = (t) => String(t || "").split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
const imIdea = () => {
  const id = $("#record-id")?.value;
  return id && $("#record-type")?.value === "idea" ? state.records.find((r) => r.id === id) : null;
};
const imReason = (m) => (friendlyError(m) === m ? m : "The model could not answer this time.");

function imSync(idea) {
  const sig = ideaJobs(idea.id).map((j) => [j.id, j.status, j.updated, j.canvasError || ""].join("|")).join(";") + "#" + state.records.filter((r) => r.branch?.of === idea.id || r.id === idea.branch?.of).map((r) => r.id + r.updated).join(",");
  if (im.forId !== idea.id) {
    im.forId = idea.id;
    im.sig = sig;
    Object.assign(im.canvas, { data: null, busy: false, error: "", editing: "", draft: "" });
    Object.assign(im.chat, { session: null, messages: [], private: false, busy: false, error: "", last: null, runId: "", accepted: new Set(), plan: null, planError: "" });
    Object.assign(im.tree, { data: null, error: "" });
    imLoadCanvas();
    imLoadTree();
    imOpenChat();
  } else if (im.sig !== sig) {
    im.sig = sig;
    imLoadCanvas();
    imLoadTree();
  }
}
async function imLoadCanvas() {
  const id = im.forId;
  try {
    const d = await api(`/api/ideas/${encodeURIComponent(id)}/canvas`);
    if (im.forId === id) Object.assign(im.canvas, { data: d, error: "" });
  } catch (e) {
    if (im.forId === id) im.canvas.error = imReason(e.message);
  }
  imRender();
}
async function imLoadTree() {
  const id = im.forId;
  try {
    const d = await api(`/api/ideas/${encodeURIComponent(id)}/branches`);
    if (im.forId === id) Object.assign(im.tree, { data: d, error: "" });
  } catch (e) {
    if (im.forId === id) im.tree.error = imReason(e.message);
  }
  imRender();
}
async function imOpenChat() {
  const id = im.forId,
    c = im.chat;
  c.loading = true;
  try {
    const d = await api(`/api/ideas/${encodeURIComponent(id)}/chat`);
    if (im.forId !== id) return;
    Object.assign(c, { session: d.session, messages: d.messages, private: d.private, error: "" });
  } catch (e) {
    if (im.forId === id) c.error = imReason(e.message);
  } finally {
    c.loading = false;
  }
  imRender();
}

function imRender() {
  const idea = imIdea();
  if (!idea || idea.id !== im.forId) return;
  if (!im.canvas.editing) fill("card-canvas", canvasCard(idea));
  fill("card-chat", chatShell(idea));
  fill("card-branches", treeCard(idea));
  paintChat();
}

function verdictHtml(v, idea) {
  const job = ideaJobs(idea.id)[0],
    tone = v.label === "Profitable" ? "good" : v.label === "Not yet" ? "bad" : "neutral",
    lead = { Profitable: "Profitable on these numbers", "Not yet": "Not yet", Incomplete: "Incomplete" }[v.label],
    sub = v.label === "Not yet" ? `${v.failing.length} of ${v.checks.length} checks fail.` : v.label === "Incomplete" ? "Some numbers are missing, so there is no verdict yet." : "Every check passes.",
    checks = v.checks.map((c) => `<li class="${c.ok ? "pass" : "fail"}"><span class="vmark" aria-hidden="true">${c.ok ? "✓" : "✕"}</span><span><span class="sr-only">${c.ok ? "Passes: " : "Fails: "}</span>${esc(c.text)}</span></li>`).join(""),
    fixes = [...new Set(v.failing.map((c) => c.fix))].map((f) => `<li>${esc(f)}</li>`).join(""),
    missing = v.missing
      .map((x) => {
        const stopped = /^The test stopped/.test(x.action),
          act = !job || stopped ? `<button type="button" class="button secondary" data-drawer="test">${job ? "Open test run" : "Test this idea"}</button>` : `<button type="button" class="button secondary" data-retry="${esc(job.id)}" data-retry-stage="${esc(x.stage)}">Retry this step</button>`;
        return `<li class="miss"><span><b>${esc(x.what)}.</b> ${esc(x.action)}</span>${act}</li>`;
      })
      .join("");
  return `<div class="verdict ${tone}" role="group" aria-label="Verdict"><p class="verdict-h"><strong>${esc(lead)}</strong><span>${esc(sub)}</span></p>${checks || missing ? `<ul class="vchecks">${checks}${missing}</ul>` : ""}${fixes ? `<p class="seg-h">What to change</p><ul class="vfix">${fixes}</ul>` : ""}<p class="hint">Computed from the unit economics and the simulated buyer panel (the bar is ${Math.round(v.minBuyRate * 100)}% yes). A model did not write it. Real customers and real quotes confirm it.</p></div>`;
}

function bmBullets(bullets, tags) {
  return bullets.map((b) => `<span class="bm-b"><span class="bm-t">${esc(b.text)}</span>${b.by === "owner" ? '<span class="src own">You</span>' : ""}${(b.tags || []).map((t) => `<span class="src">${esc(tags[t] || t)}</span>`).join("")}</span>`).join("");
}
function bmBlock(key, label, block, tags) {
  const editing = im.canvas.editing === key,
    bullets = block?.bullets || [];
  let body;
  if (editing)
    body = `<div class="bm-edit"><label class="sr-only" for="bm-t-${key}">${esc(label)}, one bullet per line</label><textarea id="bm-t-${key}" rows="6" maxlength="2000" data-bm-text>${esc(im.canvas.draft)}</textarea><p class="hint">One bullet per line, up to 6. Your words are kept when the canvas is regenerated.</p><div class="bm-actions"><button type="button" class="button primary" data-bm-save="${key}">Save</button><button type="button" class="button secondary" data-bm-cancel="1">Cancel</button></div></div>`;
  else
    body = `<button type="button" class="bm-read" data-bm-edit="${key}"><span class="sr-only">Edit ${esc(label)}: </span>${bullets.length ? bmBullets(bullets, tags) : '<span class="bm-empty">Nothing in the test results backs this yet. Click to write your own.</span>'}</button>`;
  const prop = block?.proposed
    ? `<div class="bm-prop" role="group" aria-label="New wording for ${esc(label)}"><p class="hint">Spark suggests new wording. Yours stays until you choose.</p><span class="bm-bs">${bmBullets(block.proposed.bullets, tags)}</span><div class="bm-actions"><button type="button" class="button secondary" data-bm-use="${key}">Use this</button><button type="button" class="button secondary" data-bm-dismiss="${key}">Keep mine</button></div></div>`
    : "";
  return `<section class="bm-block bm-${key}${block?.owned ? " owned" : ""}" aria-labelledby="bm-h-${key}"><h3 id="bm-h-${key}">${esc(label)}${block?.owned ? ' <span class="src own">Yours</span>' : ""}</h3>${body}${prop}</section>`;
}
function canvasCard(idea) {
  const c = im.canvas,
    d = c.data,
    job = ideaJobs(idea.id)[0],
    working = ideaJobs(idea.id).find((j) => ["queued", "running"].includes(j.status)),
    failed = job?.canvasError && !d?.canvas ? job.canvasError : "",
    ready = !!(state.assistant.writer?.model),
    head = (tools) => `<header class="card-h"><h2>Business model</h2><span class="by-simulation">Simulated</span><span class="card-tools">${tools}</span></header>`;
  if (!d && !c.error) return head("") + '<p class="skeleton-line">Loading the business model…</p>';
  if (!d) return head("") + `<div class="retry-note failed"><p>${esc(c.error)}</p><button type="button" class="button secondary" data-canvas="load">Retry</button></div>`;
  const exportLink = `<a class="button secondary" href="/api/ideas/${encodeURIComponent(idea.id)}/canvas.md" download>Download one-page summary</a>`,
    verdict = verdictHtml(d.verdict, idea),
    busy = c.busy || (working && working.stage === "canvas");
  let body;
  if (busy) body = '<p class="working" role="status"><span class="dots" aria-hidden="true"></span>Writing the canvas from the test results…</p>';
  else if (!d.ready) body = `<p class="lead muted">Nothing tested yet.</p><p class="hint">Run the idea test and Spark fills in the nine blocks from what the pipelines found. Every line says which stage it came from.</p><div class="config-actions"><button type="button" class="button primary" data-drawer="test">${ready ? "Test this idea" : "Open test run"}</button></div>`;
  else if (!d.canvas) body = `<p class="lead muted">No canvas yet.</p><p class="hint">${failed ? esc("The canvas did not get written. " + plainReason(failed)) : "The pipelines have results. Write the canvas from them."}</p><div class="config-actions"><button type="button" class="button primary" data-canvas="force"${ready ? "" : " disabled"}>${failed ? "Retry this step" : "Write the canvas"}</button></div>`;
  else {
    const cv = d.canvas,
      when = cv.at ? new Date(cv.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "",
      props = d.blocks.filter((b) => cv.blocks[b.key]?.proposed).length;
    body = `${props ? `<p class="bm-note" role="status">Regenerating found new wording for ${props} of your edited ${props === 1 ? "block" : "blocks"}. Your words are untouched until you choose.</p>` : ""}<div class="bm-wrap"><div class="bm-grid">${d.blocks.map((b) => bmBlock(b.key, b.label, cv.blocks[b.key], d.tags)).join("")}</div></div><p class="card-meta">${esc(cv.model)}${cv.localOnly ? " · local only" : ""}${when ? " · " + esc(when) : ""}${!d.current ? ' · <span class="stale">idea or results changed since</span>' : ""} · Tags show the stage each line came from. A model wrote the lines without a "You" tag.</p>`;
  }
  const regen = d.ready ? `<button type="button" class="button secondary" data-canvas="force"${busy || working ? " disabled" : ""}>${busy ? "Writing…" : "Regenerate"}</button>` : "";
  return `${head(regen + exportLink)}${verdict}${c.error ? `<div class="retry-note failed" role="alert"><p>${esc(c.error)}</p><button type="button" class="button secondary" data-canvas="force">Retry</button></div>` : ""}${body}`;
}

async function imCanvasWrite(force) {
  const c = im.canvas,
    id = im.forId;
  if (c.busy) return;
  c.busy = true;
  c.error = "";
  imRender();
  try {
    const d = await api(`/api/ideas/${encodeURIComponent(id)}/canvas`, { method: "POST", data: { force } });
    if (im.forId === id) c.data = d;
    await refresh(false);
  } catch (e) {
    c.error = (friendlyError(e.message) === e.message ? e.message : "The canvas did not get written this time.");
  } finally {
    c.busy = false;
    imRender();
  }
}
async function imCanvasCall(path, method, data) {
  const id = im.forId;
  try {
    const d = await api(`/api/ideas/${encodeURIComponent(id)}/canvas${path}`, { method, data });
    if (im.forId === id) Object.assign(im.canvas, { data: d, error: "" });
  } catch (e) {
    im.canvas.error = friendlyError(e.message) === e.message ? e.message : "That change did not save. Try again.";
  }
  imRender();
}
function imEdit(key) {
  const block = im.canvas.data?.canvas?.blocks?.[key];
  if (!block) return;
  im.canvas.editing = key;
  im.canvas.draft = block.bullets.map((b) => b.text).join("\n");
  fill("card-canvas", canvasCard(imIdea()));
  $(`#bm-t-${key}`)?.focus();
}
function imStopEdit(returnFocus) {
  const key = im.canvas.editing;
  im.canvas.editing = "";
  imRender();
  if (returnFocus) $(`[data-bm-edit="${key}"]`)?.focus();
}
async function imSave(key) {
  const lines = im.canvas.draft.split("\n").map((l) => l.trim()).filter(Boolean);
  im.canvas.editing = "";
  await imCanvasCall("", "PATCH", { block: key, lines });
  $(`[data-bm-edit="${key}"]`)?.focus();
}

function chatShell(idea) {
  const c = im.chat;
  return `<header class="card-h"><h2>Work on this idea</h2>${c.private ? '<span class="by-simulation">Private: stays on this computer</span>' : ""}</header><p class="hint">Think out loud with the idea and everything Spark found. Suggested changes wait here until you accept or reject each one.</p><div id="im-log" class="im-log" role="log" aria-live="polite" aria-label="Conversation about this idea" tabindex="0"></div><div id="im-rerun"></div><div class="im-quick" role="group" aria-label="Starting points">${IM_PROMPTS.map(([l], i) => `<button type="button" class="chip-button" data-im-prompt="${i}">${esc(l)}</button>`).join("")}</div><form id="im-form" class="im-form"><label class="sr-only" for="im-input">Message about this idea</label><textarea id="im-input" rows="2" maxlength="4000" placeholder="Ask a question, or try a change. For example: what if it were free?"></textarea><div class="im-send"><button type="submit" class="button primary" id="im-send">Send</button><button type="button" class="button secondary" id="im-stop" hidden>Stop</button></div></form><div id="im-error"></div>`;
}
function imDiff(c) {
  return `<div class="chip-diff"><span class="cd-from"><span class="sr-only">Now: </span>${c.from ? esc(c.from) : "(empty)"}</span><span class="cd-arrow" aria-hidden="true">→</span><span class="cd-to"><span class="sr-only">Proposed: </span>${esc(c.to)}</span></div>`;
}
function imProposals(m) {
  const p = m.proposals;
  if (!p) return "";
  const ups = (p.updates || [])
    .map((u) => {
      const done = u.status === "accepted" ? '<span class="status-pill ok">Accepted</span>' : u.status === "rejected" ? '<span class="status-pill">Rejected</span>' : "",
        act = u.status === "pending" ? `<div class="chip-actions"><button type="button" class="button primary" data-im-act="accept" data-m="${esc(m.id)}" data-p="${esc(u.id)}" aria-label="Accept change to ${esc(u.label)}">Accept</button><button type="button" class="button secondary" data-im-act="reject" data-m="${esc(m.id)}" data-p="${esc(u.id)}" aria-label="Reject change to ${esc(u.label)}">Reject</button>${u.target.startsWith("canvas:") ? "" : `<button type="button" class="text-button" data-im-act="branch-one" data-m="${esc(m.id)}" data-p="${esc(u.id)}" aria-label="Put the change to ${esc(u.label)} in a branch instead">Branch instead</button>`}</div>` : "";
      return `<li class="chip ${esc(u.status)}"><p class="chip-h"><b>${esc(u.label)}</b>${done}</p>${imDiff(u)}${u.why ? `<p class="hint">${esc(u.why)}</p>` : ""}${act}</li>`;
    })
    .join("");
  const brs = (p.branches || [])
    .map((b) => {
      const state = b.status === "created" ? `<span class="status-pill ok">Created</span> <a href="#entry/${esc(b.childId)}">Open the branch</a>` : b.status === "rejected" ? '<span class="status-pill">Not now</span>' : "",
        act = b.status === "pending" ? `<div class="chip-actions"><button type="button" class="button primary" data-im-act="branch" data-m="${esc(m.id)}" data-p="${esc(b.id)}" aria-label="Create the branch ${esc(b.title)}">Create this branch</button><button type="button" class="button secondary" data-im-act="branch-no" data-m="${esc(m.id)}" data-p="${esc(b.id)}" aria-label="Not now: ${esc(b.title)}">Not now</button></div>` : "";
      return `<li class="chip branch ${esc(b.status)}"><p class="chip-h"><b>Branch: ${esc(b.title)}</b>${state}</p><p><span class="seg-h">What's different</span> ${esc(b.note)}</p><ul class="chip-list">${b.changes.map((c) => `<li><span class="chip-h">${esc(c.label)}</span>${imDiff(c)}</li>`).join("")}</ul>${act}</li>`;
    })
    .join("");
  return ups || brs ? `<ul class="im-props">${ups}${brs}</ul>` : "";
}
function imMessage(m) {
  if (m.role === "user") return `<div class="im-msg you"><b class="im-who">You</b>${imParas(m.text)}</div>`;
  const running = m.status === "running",
    bad = m.status === "failed" || m.status === "cancelled";
  return `<div class="im-msg bot"><b class="im-who">Idea partner</b>${m.text ? imParas(m.text) : running ? '<p class="working"><span class="dots" aria-hidden="true"></span>Thinking…</p>' : ""}${bad ? `<div class="retry-note failed"><p>${m.status === "cancelled" ? "Stopped before it finished." : esc(imReason(m.error))}</p><button type="button" class="button secondary" data-im-retry="${esc(m.id)}">Retry</button></div>` : ""}${m.status === "complete" ? imProposals(m) : ""}</div>`;
}
function paintChat() {
  const log = $("#im-log");
  if (!log) return;
  const c = im.chat,
    near = log.scrollHeight - log.scrollTop - log.clientHeight < 60,
    msgs = c.messages.filter((m) => m.role === "user" || m.role === "assistant").sort((a, b) => a.created.localeCompare(b.created));
  const html = c.loading && !msgs.length ? '<p class="skeleton-line">Opening the conversation…</p>' : msgs.length ? msgs.map(imMessage).join("") : '<p class="im-empty">Nothing said yet. Ask why buyers said no, what happens if the price changes, or for three pivots.</p>';
  if (log._html !== html) {
    log._html = html;
    log.innerHTML = html;
    if (near) log.scrollTop = log.scrollHeight;
  }
  $("#im-send").disabled = c.busy || !c.session;
  $("#im-stop").hidden = !c.busy;
  for (const b of $$("[data-im-prompt]")) b.disabled = c.busy || !c.session;
  $("#im-error").innerHTML = c.error ? `<div class="retry-note failed" role="alert"><p>${esc(c.error)}</p>${c.session && c.last ? '<button type="button" class="button secondary" data-im-resend="1">Retry</button>' : '<button type="button" class="button secondary" data-im-reopen="1">Retry</button>'}${/Settings/.test(c.error) ? '<a class="button secondary" href="#settings">Open Settings</a>' : ""}</div>` : "";
  paintRerun();
}
function paintRerun() {
  const box = $("#im-rerun"),
    c = im.chat;
  if (!box) return;
  if (!c.accepted.size) return void (box.innerHTML = "");
  const names = (s) => s.map((n) => STAGE_LABELS[n] || n).join(", "),
    changed = [...c.accepted].map((t) => (t === "title" ? "Title" : t.startsWith("canvas:") ? "the canvas" : fieldLabels.idea?.[t] || t)).join(", "),
    p = c.plan;
  let inner;
  if (c.planError) inner = `<p>${esc(c.planError)}</p><button type="button" class="button secondary" data-im-plan="1">Retry</button>`;
  else if (!p) inner = `<p>Accepted: ${esc(changed)}. Nothing in the tests depends on it, so there is nothing to rerun.</p><button type="button" class="button secondary" data-im-dismiss-plan="1">Done</button>`;
  else if (p.needsTest) inner = `<p>Accepted: ${esc(changed)}. This idea has no finished test yet, so run one to see how the change plays out.</p><button type="button" class="button primary" data-drawer="test">Test this idea</button>`;
  else if (p.busy) inner = `<p>Accepted: ${esc(changed)}. A test is running. Rerun the affected steps when it finishes.</p><button type="button" class="button secondary" data-im-plan="1">Check again</button>`;
  else inner = `<p>Accepted: ${esc(changed)}. The tests that depended on it are out of date: ${esc(names(p.stages))}.</p><button type="button" class="button primary" data-im-rerun="1">Rerun affected steps</button>`;
  box.innerHTML = `<div class="bm-note" role="status">${inner}</div>`;
}
async function imPlan() {
  const c = im.chat,
    id = im.forId;
  c.planError = "";
  try {
    const r = await api(`/api/ideas/${encodeURIComponent(id)}/rerun-plan`, { method: "POST", data: { targets: [...c.accepted].filter((t) => !t.startsWith("canvas:")) } });
    if (im.forId === id) c.plan = r.plan;
  } catch (e) {
    c.planError = "Spark could not work out which steps to rerun. Try again.";
  }
  paintRerun();
}
async function imRerun() {
  const p = im.chat.plan;
  if (!p?.jobId) return;
  try {
    await api(`/api/jobs/${encodeURIComponent(p.jobId)}/retry`, { method: "POST", data: { stage: p.stage, rerunLater: true, with: p.with } });
    im.chat.accepted = new Set();
    im.chat.plan = null;
    await refresh(false);
    toast("Rerunning the affected steps. You can leave this page; it keeps running.");
    imRender();
    if (typeof renderAsks === "function") renderAsks();
  } catch (e) {
    im.chat.planError = friendlyError(e.message) === e.message ? e.message : "The rerun did not start. Try again.";
    paintRerun();
  }
}

function imUpsert(m) {
  const list = im.chat.messages,
    i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) list[i] = { ...list[i], ...m };
  else list.push(m);
}
async function imSend(prompt, action = "run", messageId = "") {
  const c = im.chat;
  if (c.busy || !c.session) return;
  c.busy = true;
  c.error = "";
  c.last = { prompt, action, messageId };
  paintChat();
  try {
    const data = { sessionId: c.session.id, action };
    if (action === "run") data.prompt = prompt;
    else data.messageId = messageId;
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) throw Error((await res.json().catch(() => ({}))).error || "Could not start.");
    if (action === "run" && $("#im-input")) $("#im-input").value = "";
    const reader = res.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    const consume = (e) => {
      if (e.event === "start") {
        c.runId = e.runId;
        $("#im-stop") && ($("#im-stop").dataset.run = e.runId);
      } else if (e.event === "message_start" || e.event === "message_done") imUpsert(e.message);
      else if (e.event === "delta") {
        const m = c.messages.find((x) => x.id === e.id);
        if (m) m.text += e.text;
      } else if (e.event === "error") c.error = imReason(e.error);
      paintChat();
    };
    for (;;) {
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
  } catch (e) {
    c.error = imReason(e.message);
  } finally {
    c.busy = false;
    c.runId = "";
    try {
      const d = await api(`/api/ideas/${encodeURIComponent(im.forId)}/chat`);
      c.messages = d.messages;
    } catch {}
    paintChat();
    refresh(false).catch(() => {});
  }
}

async function imAct(btn) {
  const c = im.chat,
    id = im.forId,
    act = btn.dataset.imAct,
    m = c.messages.find((x) => x.id === btn.dataset.m),
    p = [...(m?.proposals?.updates || []), ...(m?.proposals?.branches || [])].find((x) => x.id === btn.dataset.p);
  if (!m || !p) return;
  btn.disabled = true;
  try {
    if (act === "accept" || act === "reject") {
      const r = await api(`/api/ideas/${encodeURIComponent(id)}/proposals`, { method: "POST", data: { messageId: m.id, proposalId: p.id, action: act } });
      p.status = r.proposal.status;
      if (act === "accept") {
        c.accepted.add(p.target);
        await refresh(false);
        const rec = state.records.find((x) => x.id === id);
        if (rec && typeof isDirty === "function" && !isDirty()) await loadEntry(rec);
        await imPlan();
        imLoadCanvas();
        imLoadTree();
      }
    } else if (act === "branch-no") {
      await api(`/api/ideas/${encodeURIComponent(id)}/proposals`, { method: "POST", data: { kind: "branch", messageId: m.id, proposalId: p.id } });
      p.status = "rejected";
    } else {
      const one = act === "branch-one",
        child = await api(`/api/ideas/${encodeURIComponent(id)}/branch`, {
          method: "POST",
          data: one ? { title: p.label + ": " + p.to.slice(0, 40), note: p.why || `Changes ${p.label.toLowerCase()}.`, changes: [{ target: p.target, to: p.to }], messageId: m.id, proposalId: p.id } : { title: p.title, note: p.note, changes: p.changes, messageId: m.id, proposalId: p.id },
        });
      if (!one) p.status = "created", (p.childId = child.id);
      await refresh(false);
      toast(`Branch created. Open it from the branch comparison.`);
      imLoadTree();
    }
  } catch (e) {
    c.error = friendlyError(e.message) === e.message ? e.message : "That did not work this time. Try again.";
  }
  paintChat();
}

function imVersion(r, d, idea) {
  const best = d.best === r.id,
    cur = r.currency,
    isParent = r.id === d.parent.id,
    tone = r.verdict === "Profitable" ? "good" : r.verdict === "Not yet" ? "bad" : "neutral",
    row = (l, v) => `<div><dt>${l}</dt><dd>${v}</dd></div>`;
  return `<article class="ver${best ? " best" : ""}${r.id === d.focus ? " here" : ""}" aria-label="${esc(r.title)}"><header><p class="ver-kind">${isParent ? "Original" : "Branch"}${best ? ' <span class="status-pill ok">Strongest so far</span>' : ""}${r.id === d.focus ? ' <span class="status-pill">You are here</span>' : ""}</p><h3>${r.id === d.focus ? esc(r.title) : `<a href="#entry/${esc(r.id)}">${esc(r.title)}</a>`}</h3>${r.branch?.note ? `<p class="hint"><b>What's different:</b> ${esc(r.branch.note)}</p>` : ""}</header>${r.tested ? `<dl class="ver-rows">${row("Buy rate", r.buyRate === null ? "—" : `${Math.round(r.buyRate * 100)}% yes${r.segment ? ` <small>${esc(r.segment)}</small>` : ""}`)}${row("Test price", imMoney(r.testPrice, cur))}${row("Margin", r.marginText ? esc(r.marginText) : "—")}${row("Board score", r.board ? `${r.board.avg} of 10 <small>${r.board.funds} of ${r.board.of} fund</small>` : "—")}${row("Verdict", `<span class="vtag ${tone}">${esc(r.verdict)}</span>`)}</dl>${r.failing.length ? `<ul class="ver-fail">${r.failing.slice(0, 2).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : r.missing.length ? `<p class="hint">Missing: ${esc(r.missing[0])}.</p>` : ""}` : `<p class="hint">Not tested yet.</p>`}${r.id !== d.focus && !r.tested ? `<a class="button secondary" href="#entry/${esc(r.id)}">Open and run its test</a>` : ""}</article>`;
}
function treeCard(idea) {
  const t = im.tree,
    d = t.data,
    head = '<header class="card-h"><h2>Branches</h2></header>';
  if (!d && !t.error) return head + '<p class="skeleton-line">Loading the comparison…</p>';
  if (!d) return head + `<div class="retry-note failed" role="alert"><p>${esc(t.error)}</p><button type="button" class="button secondary" data-tree-load="1">Retry</button></div>`;
  const rows = [d.parent, ...d.branches],
    intro = idea.branch ? `<p class="hint">This idea is a branch of <a href="#entry/${esc(d.parent.id)}">${esc(d.parent.title)}</a>, linked with a "branch of" connection.</p>` : "";
  if (!d.branches.length)
    return `${head}${intro}<p class="lead muted">No branches yet.</p><p class="hint">A branch is a copy of this idea with a few changes, so you can test two versions side by side. Ask for three pivots, or branch from any suggested change in the conversation.</p><div class="config-actions"><button type="button" class="button primary" data-im-prompt="2">Give me 3 pivots</button></div>`;
  return `${head}${intro}<p class="hint">Each version runs its own test. Compare them here${d.best ? "; the outlined one passes the most checks" : " once at least two are tested"}.</p><div class="vers">${rows.map((r) => imVersion(r, d, idea)).join("")}</div>`;
}

document.addEventListener("click", (event) => {
  const t = event.target.closest?.("[data-bm-edit],[data-bm-save],[data-bm-cancel],[data-bm-use],[data-bm-dismiss],[data-canvas],[data-im-prompt],[data-im-act],[data-im-retry],[data-im-resend],[data-im-reopen],[data-im-rerun],[data-im-plan],[data-im-dismiss-plan],[data-tree-load],#im-stop");
  if (!t) return;
  const d = t.dataset;
  if (d.bmEdit) return imEdit(d.bmEdit);
  if (d.bmSave) return void imSave(d.bmSave);
  if (d.bmCancel) return imStopEdit(true);
  if (d.bmUse) return void imCanvasCall("/proposed", "POST", { block: d.bmUse, action: "use" });
  if (d.bmDismiss) return void imCanvasCall("/proposed", "POST", { block: d.bmDismiss, action: "dismiss" });
  if (d.canvas) return d.canvas === "load" ? void imLoadCanvas() : void imCanvasWrite(d.canvas === "force");
  if (d.imPrompt !== undefined) return void imSend(IM_PROMPTS[Number(d.imPrompt)][1]);
  if (d.imAct) return void imAct(t);
  if (d.imRetry) return void imSend("", "retry", d.imRetry);
  if (d.imResend) return void imSend(im.chat.last.prompt, im.chat.last.action, im.chat.last.messageId);
  if (d.imReopen) return void imOpenChat();
  if (d.imRerun) return void imRerun();
  if (d.imPlan) return void imPlan();
  if (d.imDismissPlan) return (im.chat.accepted = new Set()), paintRerun();
  if (d.treeLoad) return void imLoadTree();
  if (t.id === "im-stop" && t.dataset.run) api(`/api/runs/${encodeURIComponent(t.dataset.run)}/cancel`, { method: "POST", data: {} }).catch(() => toast("Could not stop the answer."));
});
document.addEventListener("submit", (event) => {
  if (event.target.id !== "im-form") return;
  event.preventDefault();
  const v = $("#im-input").value.trim();
  if (v) imSend(v);
});
document.addEventListener("input", (event) => {
  if (event.target.matches?.("[data-bm-text]")) im.canvas.draft = event.target.value;
});
document.addEventListener("keydown", (event) => {
  const el = event.target;
  if (el.matches?.("[data-bm-text]")) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      imStopEdit(true);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      imSave(im.canvas.editing);
    }
  } else if (el.id === "im-input" && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    $("#im-form").requestSubmit();
  }
});
