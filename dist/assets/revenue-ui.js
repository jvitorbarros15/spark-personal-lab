"use strict";
// One compact control on the idea page: how the idea makes money, with a one-line explanation.
// Loaded before app.js; it reads app.js globals (state, api, esc, fill, fieldDraft, saveRecord...) only when it runs.
// The model table (labels, one-line explanations, inputs) comes from the server in /api/state.
const revModels = () => (typeof state !== "undefined" && state.revenueModels) || {};
const revState = { forId: "", targets: new Set(), plan: null, error: "", busy: false };
const revLabel = (m) => tx(revModels()[m]?.label || m);
const revOpts = (current, blank) => `<option value=""${current ? "" : " selected"}>${blank}</option>${Object.entries(revModels()).map(([k, v]) => `<option value="${k}"${k === current ? " selected" : ""}>${esc(tx(v.label))}</option>`).join("")}`;

function revStreams(cfo) {
  const r = cfo?.revenue;
  if (!r || !r.streams || r.streams.length < 2) return "";
  const cur = (fieldDraft.currency || "").trim();
  return `<h3 class="grp">${tx("Income streams")}</h3><table class="mtab"><thead><tr><th scope="col">${tx("Stream")}</th><th scope="col">${tx("Year 1")}</th><th scope="col">${tx("Share")}</th></tr></thead><tbody>${r.streams.map((s) => `<tr><th scope="row">${esc(revLabel(s.model))}<small> ${esc(tx(s.formula || ""))}</small></th><td>${fmtMoney(s.year1, cur)}</td><td>${s.share === null || s.share === undefined ? "—" : fmt.pct(s.share, 0)}</td></tr>`).join("")}<tr><th scope="row">${tx("Combined year 1 operating profit")}</th><td>${fmtMoney(r.year1Profit, cur)}</td><td></td></tr></tbody></table>`;
}

function revNumbersCard(cfo, issue) {
  const r = cfo.revenue,
    cur = (fieldDraft.currency || "").trim(),
    assumed = new Set(cfo.assumed || []),
    labelOf = (k) => {
      for (const m of [r.model, r.secondary]) for (const { key, label } of revModels()[m]?.inputs || []) if (key === k) return tx(label);
      return k === "fixedCosts" ? tx("Fixed costs per month") : k === "price" ? tx("Paid plan price per month") : k;
    },
    rows = Object.keys(cfo.source || {}).map((k) => `<div class="inp"><dt>${esc(labelOf(k))}</dt><dd>${fmtMoney(cfo.inputs?.[k], "")} ${cfo.source[k] === "yours" ? `<span class="tag yours">${tx("Yours")}</span>` : `<span class="tag assumed">${tx("ASSUMPTION")}</span>${cfo.check ? ` <span class="tag check">${tx("Check this")}</span>` : ""}`}${cfo.assumptions?.[k]?.why ? `<small>${esc(cfo.assumptions[k].why)}</small>` : ""}</dd></div>`).join(""),
    startup = cfo.assumptions?.startup,
    tone = cfo.check ? "bad" : r.label === "Profitable" || r.label === "Funded by grants" ? "good" : "bad";
  const table = `<table class="mtab"><thead><tr><th scope="col">${tx("Stream")}</th><th scope="col">${tx("Per month")}</th><th scope="col">${tx("Year 1")}</th><th scope="col">${tx("Share")}</th></tr></thead><tbody>${r.streams.map((s) => `<tr><th scope="row">${esc(revLabel(s.model))}<small> ${esc(tx(s.formula || ""))}</small></th><td>${fmtMoney(s.monthly, cur)}</td><td>${fmtMoney(s.year1, cur)}</td><td>${s.share === null || s.share === undefined ? "—" : fmt.pct(s.share, 0)}</td></tr>`).join("")}<tr><th scope="row">${tx("Running costs")}</th><td>${fmtMoney(r.fixedCostsMonthly, cur)}</td><td>${fmtMoney(r.year1Costs, cur)}</td><td></td></tr><tr><th scope="row">${tx("Operating result")}</th><td></td><td>${fmtMoney(r.year1Profit, cur)}</td><td></td></tr></tbody></table>`;
  return `<header class="card-h"><h2>${tx("Numbers")}</h2><span class="by-simulation">${tx("Simulated")}</span></header>${issue}<p class="lead rev-verdict ${tone}"><b>${esc(tx(r.label))}.</b> ${esc(tx(r.verdict))}</p><div class="num-grid"><div>${table}${r.breakEven ? `<p class="hint">${r.breakEven.value === null ? tx("Break-even: never with these numbers ({unit} would not cover running costs).", { unit: esc(tx(r.breakEven.unit)) }) : tx("Break-even: {value} {unit} to cover running costs.", { value: fmt.num(r.breakEven.value), unit: esc(tx(r.breakEven.unit)) })}</p>` : ""}<p class="hint">${tx("Cash needed before it pays for itself: {cash}. Startup spend {startup}{assumed}. Year 1 uses a slow ramp-up.", { cash: fmtMoney(r.cashNeeded, cur), startup: fmtMoney(r.startup, cur), assumed: startup?.why ? tx(" (assumed: {why})", { why: esc(startup.why) }) : "" })}</p></div></div><h3 class="grp">${tx("Inputs")}</h3><dl class="inputs">${rows}</dl>${assumed.size ? `<p class="hint">${tx("Inputs marked ASSUMPTION are estimates by the CFO model. They are not saved on your idea; enter your own in the box under Details.")}</p>` : ""}${cfo.check ? `<ul class="notes bad">${cfo.check.problems.map((x) => `<li><span class="tag check">${tx("Check this")}</span> ${esc(tx(x))}</li>`).join("")}</ul>` : ""}`;
}

function revSync(idea) {
  if (revState.forId !== idea.id) Object.assign(revState, { forId: idea.id, targets: new Set(), plan: null, error: "", busy: false });
  const f = fieldDraft,
    main = revModels()[f.revenueModel] ? f.revenueModel : "",
    second = revModels()[f.revenueSecondary] ? f.revenueSecondary : "",
    guess = stageOut(idea.id, "panel")?.out?.revenue,
    guessed = !main && guess?.source === "guess" ? guess : null,
    shown = [main, second].filter(Boolean),
    inputs = shown.flatMap((m) => revModels()[m].inputs.map(({ key: k, label }) => `<label class="rev-in">${esc(tx(label))}<input type="number" min="0" step="any" data-rev="${k}" value="${esc(f[k] ?? "")}"></label>`)),
    explain = main ? esc(tx(revModels()[main].explain)) + (second ? " " + tx("Plus: {name}.", { name: esc(revLabel(second)) }) : "") : guessed ? "" : tx("Not set. Spark will guess from the idea when you test it, and show the guess here."),
    plan = revState.plan,
    names = (plan?.stages || []).map((n) => STAGE_LABELS[n] || n).join(", ");
  const note = revState.error ? `<p class="gate">${esc(revState.error)}</p>` : plan?.jobId && revState.targets.size ? `<div class="retry-note stale"><p>${tx("The tests that used the old answer are out of date: {names}.", { names: esc(names) })}</p><button type="button" class="button secondary" data-rev-retry="1"${revState.busy ? " disabled" : ""}>${revState.busy ? tx("Working…") : tx("Retry these steps")}</button></div>` : plan?.busy ? `<p class="hint">${tx("A test is running. Retry the affected steps when it finishes.")}</p>` : "";
  const html = `<div class="rev-box"><label class="fld-label" for="rev-main">${tx("How it makes money")}</label><select id="rev-main" data-rev="revenueModel">${revOpts(main, guessed ? tx("Not set") : tx("Not set (Spark guesses)"))}</select>${explain ? `<p class="hint rev-explain">${explain}</p>` : ""}${guessed ? `<p class="hint rev-guess">${tx("Spark guessed: <b>{name}</b>{plus}{why}. Change it above, or <button type=\"button\" class=\"text-button\" data-rev-use=\"1\">keep this</button>.", { name: esc(revLabel(guessed.model)), plus: guessed.secondary ? tx(" plus {name}", { name: esc(revLabel(guessed.secondary)) }) : "", why: guessed.why ? " (" + esc(guessed.why) + ")" : "" })}</p>` : ""}<details class="more" data-key="rev-more"><summary>${tx("Numbers and a second income stream")}</summary><label class="rev-in">${tx("Second income stream")}<select data-rev="revenueSecondary"${main ? "" : " disabled"}>${revOpts(second, tx("None"))}</select></label>${inputs.join("")}<label class="rev-in">${tx("Notes")}<input type="text" maxlength="500" data-rev="revenueNotes" value="${esc(f.revenueNotes ?? "")}"></label>${revModels()[main]?.needsPrice || revModels()[second]?.needsPrice ? `<p class="hint">${tx("The paid plan price is the Price per sale under Numbers.")}</p>` : ""}</details>${note}</div>`;
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
    revState.error = tx(String(e.message));
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
      revState.error = tx(String(e.message));
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
      toast(tx("Rerunning the affected steps. You can leave this page; it keeps running."));
    } catch (e) {
      revState.error = tx(String(e.message));
    }
    revState.busy = false;
    const idea = state.records.find((r) => r.id === revState.forId);
    if (idea) revSync(idea);
  }
});
}

