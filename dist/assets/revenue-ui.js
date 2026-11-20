"use strict";
// One compact control on the idea page: how the idea makes money, with a one-line explanation.
// Loaded before app.js; it reads app.js globals (state, api, esc, fill, fieldDraft, saveRecord...) only when it runs.
const REV_MODELS = {
  subscription: { label: "Subscription", explain: "Customers pay a fixed amount every month or year.", inputs: [] },
  one_time: { label: "One-time sale", explain: "Customers pay once for each item.", inputs: [] },
  freemium: { label: "Freemium", explain: "Free for most people; a share of them pay to upgrade.", inputs: [["revFreeUsers", "Free users"], ["revConversion", "Upgrade rate (%)"]], needsPrice: true },
  ads: { label: "Ads", explain: "Free to use; money comes from ads shown to visitors.", inputs: [["revUsers", "Visitors per month"], ["revPageviews", "Pageviews per visitor per month"], ["revRpm", "Ad RPM (per 1,000 pageviews)"]] },
  marketplace_commission: { label: "Marketplace commission", explain: "You take a cut of each sale between buyers and sellers.", inputs: [["revGmv", "Sales through it per month"], ["revTakeRate", "Take rate (%)"]] },
  usage_based: { label: "Pay per use", explain: "Customers pay for what they use, per unit.", inputs: [["revUnits", "Units used per month"], ["revUnitPrice", "Price per unit"]] },
  licensing: { label: "Licensing", explain: "Others pay a fee to use your technology or content.", inputs: [["revDeals", "Deals per year"], ["revFee", "Fee per deal"]] },
  services: { label: "Services", explain: "You sell your time or projects to clients.", inputs: [["revHours", "Billable hours per month"], ["revRate", "Rate per hour"]] },
  b2b_contract: { label: "Business contracts", explain: "Companies sign contracts for a larger recurring or custom deal.", inputs: [["revContracts", "Contracts per year"], ["revContractValue", "Value per contract"]] },
  donations: { label: "Donations", explain: "People give what they choose, with no fixed price.", inputs: [["revDonors", "Gifts per month"], ["revAvgGift", "Average gift"]] },
  grants_research: { label: "Grants and research funding", explain: "Research paid for by grants and partners, not by customers.", inputs: [["revGrantSize", "Grant size"], ["revGrantsPerYear", "Grants won per year"]] },
  not_monetized_yet: { label: "Not monetized yet", explain: "No plan to earn money yet, so it is not a business until that changes.", inputs: [] },
};
const revState = { forId: "", targets: new Set(), plan: null, error: "", busy: false };
const revOpts = (current, blank) => `<option value=""${current ? "" : " selected"}>${blank}</option>${Object.entries(REV_MODELS).map(([k, v]) => `<option value="${k}"${k === current ? " selected" : ""}>${esc(v.label)}</option>`).join("")}`;

function revStreams(cfo) {
  const r = cfo?.revenue;
  if (!r || !r.streams || r.streams.length < 2) return "";
  const cur = (fieldDraft.currency || "").trim();
  return `<h3 class="grp">Income streams</h3><table class="mtab"><thead><tr><th scope="col">Stream</th><th scope="col">Year 1</th><th scope="col">Share</th></tr></thead><tbody>${r.streams.map((s) => `<tr><th scope="row">${esc(REV_MODELS[s.model]?.label || s.model)}<small> ${esc(s.formula || "")}</small></th><td>${fmtMoney(s.year1, cur)}</td><td>${s.share === null || s.share === undefined ? "—" : Math.round(s.share * 100) + "%"}</td></tr>`).join("")}</tbody></table>`;
}

function revNumbersCard(cfo, issue, job) {
  const r = cfo.revenue,
    cur = (fieldDraft.currency || "").trim(),
    assumed = new Set(cfo.assumed || []),
    labelOf = (k) => {
      for (const m of [r.model, r.secondary]) for (const [key, label] of REV_MODELS[m]?.inputs || []) if (key === k) return label;
      return k === "fixedCosts" ? "Fixed costs per month" : k === "price" ? "Paid plan price per month" : k;
    },
    rows = Object.keys(cfo.source || {}).map((k) => `<div class="inp"><dt>${esc(labelOf(k))}</dt><dd>${fmtMoney(cfo.inputs?.[k], "")} ${cfo.source[k] === "yours" ? '<span class="tag yours">Yours</span>' : `<span class="tag assumed">ASSUMPTION</span>${cfo.check ? ' <span class="tag check">Check this</span>' : ""}`}${cfo.assumptions?.[k]?.why ? `<small>${esc(cfo.assumptions[k].why)}</small>` : ""}</dd></div>`).join(""),
    startup = cfo.assumptions?.startup,
    tone = cfo.check ? "bad" : r.label === "Profitable" || r.label === "Funded by grants" ? "good" : "bad";
  const table = `<table class="mtab"><thead><tr><th scope="col">Stream</th><th scope="col">Per month</th><th scope="col">Year 1</th><th scope="col">Share</th></tr></thead><tbody>${r.streams.map((s) => `<tr><th scope="row">${esc(REV_MODELS[s.model]?.label || s.model)}<small> ${esc(s.formula || "")}</small></th><td>${fmtMoney(s.monthly, cur)}</td><td>${fmtMoney(s.year1, cur)}</td><td>${s.share === null || s.share === undefined ? "—" : Math.round(s.share * 100) + "%"}</td></tr>`).join("")}<tr><th scope="row">Running costs</th><td>${fmtMoney(r.fixedCostsMonthly, cur)}</td><td>${fmtMoney(r.year1Costs, cur)}</td><td></td></tr><tr><th scope="row">Operating result</th><td></td><td>${fmtMoney(r.year1Profit, cur)}</td><td></td></tr></tbody></table>`;
  return `<header class="card-h"><h2>Numbers</h2><span class="by-simulation">Simulated</span></header>${issue}<p class="lead rev-verdict ${tone}"><b>${esc(r.label)}.</b> ${esc(r.verdict)}</p><div class="num-grid"><div>${table}<p class="hint">Cash needed before it pays for itself: ${fmtMoney(r.cashNeeded, cur)}. Startup spend ${fmtMoney(r.startup, cur)}${startup?.why ? " (assumed: " + esc(startup.why) + ")" : ""}. Year 1 uses a slow ramp-up.</p></div></div><h3 class="grp">Inputs</h3><dl class="inputs">${rows}</dl>${assumed.size ? '<p class="hint">Inputs marked ASSUMPTION are estimates by the CFO model. They are not saved on your idea; enter your own in the box under Details.</p>' : ""}${cfo.check ? `<ul class="notes bad">${cfo.check.problems.map((x) => `<li><span class="tag check">Check this</span> ${esc(x)}</li>`).join("")}</ul>` : ""}`;
}

function revSync(idea) {
  if (revState.forId !== idea.id) Object.assign(revState, { forId: idea.id, targets: new Set(), plan: null, error: "", busy: false });
  const f = fieldDraft,
    main = REV_MODELS[f.revenueModel] ? f.revenueModel : "",
    second = REV_MODELS[f.revenueSecondary] ? f.revenueSecondary : "",
    guess = stageOut(idea.id, "panel")?.out?.revenue,
    guessed = !main && guess?.source === "guess" ? guess : null,
    shown = [main, second].filter(Boolean),
    inputs = shown.flatMap((m) => REV_MODELS[m].inputs.map(([k, label]) => `<label class="rev-in">${esc(label)}<input type="number" min="0" step="any" data-rev="${k}" value="${esc(f[k] ?? "")}"></label>`)),
    explain = main ? esc(REV_MODELS[main].explain) + (second ? " Plus: " + esc(REV_MODELS[second].label) + "." : "") : guessed ? "" : "Not set. Spark will guess from the idea when you test it, and show the guess here.",
    plan = revState.plan,
    names = (plan?.stages || []).map((n) => STAGE_LABELS[n] || n).join(", ");
  const note = revState.error ? `<p class="gate">${esc(revState.error)}</p>` : plan?.jobId && revState.targets.size ? `<div class="retry-note stale"><p>The tests that used the old answer are out of date: ${esc(names)}.</p><button type="button" class="button secondary" data-rev-retry="1"${revState.busy ? " disabled" : ""}>${revState.busy ? "Working…" : "Retry these steps"}</button></div>` : plan?.busy ? '<p class="hint">A test is running. Retry the affected steps when it finishes.</p>' : "";
  const html = `<div class="rev-box"><label class="fld-label" for="rev-main">How it makes money</label><select id="rev-main" data-rev="revenueModel">${revOpts(main, guessed ? "Not set" : "Not set (Spark guesses)")}</select>${explain ? `<p class="hint rev-explain">${explain}</p>` : ""}${guessed ? `<p class="hint rev-guess">Spark guessed: <b>${esc(REV_MODELS[guessed.model]?.label || guessed.model)}</b>${guessed.secondary ? " plus " + esc(REV_MODELS[guessed.secondary]?.label || guessed.secondary) : ""}${guessed.why ? " (" + esc(guessed.why) + ")" : ""}. Change it above, or <button type="button" class="text-button" data-rev-use="1">keep this</button>.</p>` : ""}<details class="more" data-key="rev-more"><summary>Numbers and a second income stream</summary><label class="rev-in">Second income stream<select data-rev="revenueSecondary"${main ? "" : " disabled"}>${revOpts(second, "None")}</select></label>${inputs.join("")}<label class="rev-in">Notes<input type="text" maxlength="500" data-rev="revenueNotes" value="${esc(f.revenueNotes ?? "")}"></label>${REV_MODELS[main]?.needsPrice || REV_MODELS[second]?.needsPrice ? '<p class="hint">The paid plan price is the Price per sale under Numbers.</p>' : ""}</details>${note}</div>`;
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

if (typeof module !== "undefined") module.exports = { REV_MODELS };
