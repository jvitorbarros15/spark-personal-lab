"use strict";
// One compact control on the idea page: how the idea makes money, with a one-line explanation.
// Loaded before app.js; it reads app.js globals (state, api, esc, fill, fieldDraft, saveRecord...) only when it runs.
// The model table (labels, one-line explanations, inputs) comes from the server in /api/state.
const revModels = () => (typeof state !== "undefined" && state.revenueModels) || {};
const revState = { forId: "", targets: new Set(), plan: null, error: "", busy: false };
const revOpts = (current, blank) => `<option value=""${current ? "" : " selected"}>${blank}</option>${Object.entries(revModels()).map(([k, v]) => `<option value="${k}"${k === current ? " selected" : ""}>${esc(v.label)}</option>`).join("")}`;

function revStreams(cfo) {
  const r = cfo?.revenue;
  if (!r || !r.streams || r.streams.length < 2) return "";
  const cur = (fieldDraft.currency || "").trim();
  return `<h3 class="grp">Income streams</h3><table class="mtab"><thead><tr><th scope="col">Stream</th><th scope="col">Year 1</th><th scope="col">Share</th></tr></thead><tbody>${r.streams.map((s) => `<tr><th scope="row">${esc(revModels()[s.model]?.label || s.model)}<small> ${esc(s.formula || "")}</small></th><td>${fmtMoney(s.year1, cur)}</td><td>${s.share === null || s.share === undefined ? "—" : Math.round(s.share * 100) + "%"}</td></tr>`).join("")}<tr><th scope="row">Combined year 1 operating profit</th><td>${fmtMoney(r.year1Profit, cur)}</td><td></td></tr></tbody></table>`;
}

function revNumbersCard(cfo, issue, job) {
  const r = cfo.revenue,
    cur = (fieldDraft.currency || "").trim(),
    assumed = new Set(cfo.assumed || []),
    labelOf = (k) => {
      for (const m of [r.model, r.secondary]) for (const { key, label } of revModels()[m]?.inputs || []) if (key === k) return label;
      return k === "fixedCosts" ? "Fixed costs per month" : k === "price" ? "Paid plan price per month" : k;
    },
    rows = Object.keys(cfo.source || {}).map((k) => `<div class="inp"><dt>${esc(labelOf(k))}</dt><dd>${fmtMoney(cfo.inputs?.[k], "")} ${cfo.source[k] === "yours" ? '<span class="tag yours">Yours</span>' : `<span class="tag assumed">ASSUMPTION</span>${cfo.check ? ' <span class="tag check">Check this</span>' : ""}`}${cfo.assumptions?.[k]?.why ? `<small>${esc(cfo.assumptions[k].why)}</small>` : ""}</dd></div>`).join(""),
    startup = cfo.assumptions?.startup,
    tone = cfo.check ? "bad" : r.label === "Profitable" || r.label === "Funded by grants" ? "good" : "bad";
  const table = `<table class="mtab"><thead><tr><th scope="col">Stream</th><th scope="col">Per month</th><th scope="col">Year 1</th><th scope="col">Share</th></tr></thead><tbody>${r.streams.map((s) => `<tr><th scope="row">${esc(revModels()[s.model]?.label || s.model)}<small> ${esc(s.formula || "")}</small></th><td>${fmtMoney(s.monthly, cur)}</td><td>${fmtMoney(s.year1, cur)}</td><td>${s.share === null || s.share === undefined ? "—" : Math.round(s.share * 100) + "%"}</td></tr>`).join("")}<tr><th scope="row">Running costs</th><td>${fmtMoney(r.fixedCostsMonthly, cur)}</td><td>${fmtMoney(r.year1Costs, cur)}</td><td></td></tr><tr><th scope="row">Operating result</th><td></td><td>${fmtMoney(r.year1Profit, cur)}</td><td></td></tr></tbody></table>`;
  return `<header class="card-h"><h2>Numbers</h2><span class="by-simulation">Simulated</span></header>${issue}<p class="lead rev-verdict ${tone}"><b>${esc(r.label)}.</b> ${esc(r.verdict)}</p><div class="num-grid"><div>${table}<p class="hint">Cash needed before it pays for itself: ${fmtMoney(r.cashNeeded, cur)}. Startup spend ${fmtMoney(r.startup, cur)}${startup?.why ? " (assumed: " + esc(startup.why) + ")" : ""}. Year 1 uses a slow ramp-up.</p></div></div><h3 class="grp">Inputs</h3><dl class="inputs">${rows}</dl>${assumed.size ? '<p class="hint">Inputs marked ASSUMPTION are estimates by the CFO model. They are not saved on your idea; enter your own in the box under Details.</p>' : ""}${cfo.check ? `<ul class="notes bad">${cfo.check.problems.map((x) => `<li><span class="tag check">Check this</span> ${esc(x)}</li>`).join("")}</ul>` : ""}`;
}

function revSync(idea) {
  if (revState.forId !== idea.id) Object.assign(revState, { forId: idea.id, targets: new Set(), plan: null, error: "", busy: false });
  const f = fieldDraft,
    main = revModels()[f.revenueModel] ? f.revenueModel : "",
    second = revModels()[f.revenueSecondary] ? f.revenueSecondary : "",
    guess = stageOut(idea.id, "panel")?.out?.revenue,
    guessed = !main && guess?.source === "guess" ? guess : null,
    shown = [main, second].filter(Boolean),
    inputs = shown.flatMap((m) => revModels()[m].inputs.map(({ key: k, label }) => `<label class="rev-in">${esc(label)}<input type="number" min="0" step="any" data-rev="${k}" value="${esc(f[k] ?? "")}"></label>`)),
    explain = main ? esc(revModels()[main].explain) + (second ? " Plus: " + esc(revModels()[second].label) + "." : "") : guessed ? "" : "Not set. Spark will guess from the idea when you test it, and show the guess here.",
    plan = revState.plan,
    names = (plan?.stages || []).map((n) => STAGE_LABELS[n] || n).join(", ");
  const note = revState.error ? `<p class="gate">${esc(revState.error)}</p>` : plan?.jobId && revState.targets.size ? `<div class="retry-note stale"><p>The tests that used the old answer are out of date: ${esc(names)}.</p><button type="button" class="button secondary" data-rev-retry="1"${revState.busy ? " disabled" : ""}>${revState.busy ? "Working…" : "Retry these steps"}</button></div>` : plan?.busy ? '<p class="hint">A test is running. Retry the affected steps when it finishes.</p>' : "";
  const html = `<div class="rev-box"><label class="fld-label" for="rev-main">How it makes money</label><select id="rev-main" data-rev="revenueModel">${revOpts(main, guessed ? "Not set" : "Not set (Spark guesses)")}</select>${explain ? `<p class="hint rev-explain">${explain}</p>` : ""}${guessed ? `<p class="hint rev-guess">Spark guessed: <b>${esc(revModels()[guessed.model]?.label || guessed.model)}</b>${guessed.secondary ? " plus " + esc(revModels()[guessed.secondary]?.label || guessed.secondary) : ""}${guessed.why ? " (" + esc(guessed.why) + ")" : ""}. Change it above, or <button type="button" class="text-button" data-rev-use="1">keep this</button>.</p>` : ""}<details class="more" data-key="rev-more"><summary>Numbers and a second income stream</summary><label class="rev-in">Second income stream<select data-rev="revenueSecondary"${main ? "" : " disabled"}>${revOpts(second, "None")}</select></label>${inputs.join("")}<label class="rev-in">Notes<input type="text" maxlength="500" data-rev="revenueNotes" value="${esc(f.revenueNotes ?? "")}"></label>${revModels()[main]?.needsPrice || revModels()[second]?.needsPrice ? '<p class="hint">The paid plan price is the Price per sale under Numbers.</p>' : ""}</details>${note}</div>`;
  fill("revenue-model", html);
}

async function revPlan() {
  const id = $("#record-id").value;
  try {
    const r = await api(`/api/ideas/${encodeURIComponent(id)}/rerun-plan`, { method: "POST", data: { targets: [...revState.targets] } });
    revState.plan = r.plan;
    if (!r.plan?.jobId) revState.targets = new Set();
  } catch {
    revState.plan = null;
  }
}

if (typeof document !== "undefined") {
document.addEventListener("change", async (event) => {
  const el = event.target.closest?.("[data-rev]");
  if (!el) return;
  const key = el.dataset.rev;
  fieldDraft[key] = el.value.trim();
  if (key === "revenueModel" && !fieldDraft.revenueModel) fieldDraft.revenueSecondary = "";
  if (key === "revenueModel" && fieldDraft.revenueSecondary === fieldDraft.revenueModel) fieldDraft.revenueSecondary = "";
  revState.error = "";
  try {
    await saveRecord();
    revState.targets.add(key);
    await revPlan();
  } catch (e) {
    revState.error = e.message;
    const saved = state.records.find((r) => r.id === revState.forId);
    if (saved) fieldDraft[key] = saved.fields?.[key] ?? "";
  }
  const idea = state.records.find((r) => r.id === revState.forId);
  if (idea) revSync(idea);
});

document.addEventListener("click", async (event) => {
  const use = event.target.closest?.("[data-rev-use]"),
    go = event.target.closest?.("[data-rev-retry]");
  if (use) {
    const g = stageOut($("#record-id").value, "panel")?.out?.revenue;
    if (!g) return;
    fieldDraft.revenueModel = g.model;
    if (g.secondary) fieldDraft.revenueSecondary = g.secondary;
    try {
      await saveRecord();
    } catch (e) {
      revState.error = e.message;
    }
    const idea = state.records.find((r) => r.id === revState.forId);
    if (idea) revSync(idea);
  } else if (go && revState.plan?.jobId) {
    const p = revState.plan;
    revState.busy = true;
    revSync(state.records.find((r) => r.id === revState.forId));
    try {
      await api(`/api/jobs/${encodeURIComponent(p.jobId)}/retry`, { method: "POST", data: { stage: p.stage, rerunLater: true, with: p.with, redraftProfile: p.redraftProfile === true, reaskPanel: p.reaskPanel === true } });
      revState.targets = new Set();
      revState.plan = null;
      await refresh(false);
      toast("Rerunning the affected steps. You can leave this page; it keeps running.");
    } catch (e) {
      revState.error = e.message;
    }
    revState.busy = false;
    const idea = state.records.find((r) => r.id === revState.forId);
    if (idea) revSync(idea);
  }
});
}

