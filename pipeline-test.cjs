"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { openStore, validateRecord } = require("./store.cjs");
const { createAssistant } = require("./assistant.cjs");
const { createPipeline } = require("./pipeline.cjs");
const { createServer } = require("./server.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "spark-pipeline-"));
const PROFILE = {
  business: "Scope",
  target: "Research astronomers",
  age: [28, 55],
  segments: [{ name: "Postdocs", share: 0.6, income: [50000, 80000] }, { name: "Staff", share: 0.4, income: [80000, 120000] }],
  behaviours: [{ name: "Early adopter", share: 0.5, how: "Tries tools fast." }, { name: "Cautious", share: 0.5, how: "Waits for peers." }],
  objections: ["No budget", "Another tool to learn"],
  habits: ["you queue jobs overnight"],
};
const SUMMARY_TEXT = [
  "Verdict: The simulated board is split, with two funding votes and one conditional, and the simulated panel says most buyers would try it, so this looks worth a small real test.",
  "Strongest signal: Sixty percent of the simulated buyers said yes, led by the postdoc segment, though that is an upper bound from one model rather than demand.",
  "Biggest risk: Buyers pass over budget and the cost of learning another tool, and AstroSoft already sells classical pipelines to the same people.",
  "The numbers: At the simulated price the contribution per sale is positive and break-even sits well inside the capacity your hours allow, but every input is your own estimate.",
  "Competitors to watch: AstroSoft is the direct rival, and spreadsheets are the free substitute; the open gap is quantum processing that neither offers.",
  "Next step: Pre-sell to ten astronomers at the suggested price and treat five paid orders as the success line.",
].join("\n");
const CFO_VALUES = { price: 8, variableCost: 3, fixedCosts: 400, hoursPerCustomer: 2, availableHours: 120 };
const wait = async (pipeline, id, statuses, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const j = pipeline.get(id);
    if (statuses.includes(j.status)) return j;
    if (Date.now() > end) throw Error(`timeout waiting for ${statuses}, now ${j.status} at ${j.stage}: ${j.error}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

function setup(opts = {}) {
  const directory = tmp(),
    store = openStore(directory),
    log = [],
    asked = new Set(),
    counters = {},
    behaviour = { buy: 0.6, fatalRound: 0, rounds: 2, votes: ["FUND", "FUND IF (pilot)", "FUND"], prices: [5, 8, 12, 20], noMoreAfter: 1, ...opts.behaviour };
  const providers = {
    config: () => ({ key: "k", base: "" }),
    openAlexKey: () => "",
    webSearchKey: () => opts.webKey || "",
    generate: async (agent, messages, signal, onDelta, options = {}, meta = {}) => {
      const system = messages[0].content,
        user = messages[messages.length - 1].content;
      log.push({ agent, system: system.slice(0, 40), options, meta, user });
      if (signal.aborted) throw signal.reason;
      if (opts.gate) await opts.gate(system, signal);
      const fl = behaviour.flaky;
      if (fl && agent.name === fl.name && (counters[fl.name] = (counters[fl.name] || 0) + 1) <= fl.times) throw Error(fl.message);
      let text = "";
      if (system.startsWith("Grill the owner")) {
        const round = Number(user.match(/round (\d+) of/)[1]);
        text = round > behaviour.noMoreAfter ? "NO MORE QUESTIONS" : `Q1 - Who pays: Who pays?\nRecommended: the lab\n\nQ2 - Why now: Why now?\nRecommended: new instruments${round === behaviour.fatalRound ? "\nfatal: Nobody can pay for it." : ""}`;
      } else if (system.includes("chair of a three-member board")) text = "Chair summary.";
      else if (system.includes("Offers lens")) text = messages.length > 2 ? (behaviour.boardFix === false ? "No verdict." : "Score: 6/10 | Vote: FUND") : behaviour.boardFirst || `Memo.\nScore: 6/10 | Vote: ${behaviour.votes[0]}`;
      else if (system.includes("Monopoly lens")) text = `Memo.\nScore: 5/10 | Vote: ${behaviour.votes[1]}`;
      else if (system.includes("Product lens")) text = `Memo.\nScore: 7/10 | Vote: ${behaviour.votes[2]}`;
      else if (system.includes("summary card at the top")) {
        if (behaviour.summaryThrow) throw Error("summary model down");
        const calls = log.filter((c) => c.system.startsWith("You write the summary")).length;
        text = behaviour.summaryBadFirst && calls === 1 ? "Verdict: fine." : SUMMARY_TEXT;
      } else if (system.includes("competitive landscape"))
        text = JSON.stringify({ competitors: [{ name: "AstroSoft", kind: "direct", sells: "Pipeline software", positioning: "Classical pipelines", complaint: "Slow", gap: "No quantum", lookup: "Their pricing page", x: 12, y: 3, pricing: "$50", sources: "https://x.test", website: "https://x.test" }, { name: "Spreadsheets", kind: "substitute", positioning: "Free", complaint: "Manual", gap: "No scale", x: "n/a", y: 5 }], axes: { x: { label: "Price", low: "free", high: "costly" }, y: { label: "Convenience", low: "manual", high: "automatic" } }, gap: "Quantum for telescopes", copycat: "A big cloud" });
      else if (system.includes("plan web searches")) text = JSON.stringify({ queries: ["astronomy pipeline software", "astrosoft reviews complaints", "telescope data tool price"] });
      else if (system.includes("choose which web pages")) text = JSON.stringify({ pick: ["S1", "S2", "S99"] });
      else if (system.includes("sourced competitor map"))
        text = JSON.stringify({
          competitors: [
            { name: "AstroSoft", kind: "direct", own_source: "S1", sells: "Pipelines for telescope data", sells_source: "S1", price: "$49 per month", price_source: "S1", positioning: "Classical pipelines for telescopes", positioning_source: "S1", complaint: "far too slow for large surveys", complaint_source: "S2", gap: "No quantum" },
            { name: "Ghost Co", kind: "indirect", own_source: "S2", sells: "", sells_source: "", price: "$4", price_source: "S1", positioning: "", positioning_source: "", complaint: "an invented quote nobody wrote", complaint_source: "S2", gap: "" },
          ],
          gap: "Nobody shows quantum speedups",
          copycat: "A big cloud",
          map: { xAxis: "price", yAxis: "speed", placements: [{ name: "AstroSoft", position: "mid price, slow" }] },
        });
      else if (system.includes("brand designer")) text = "Name candidates: ...\nPromise: ...";
      else if (system.startsWith("You are the CFO")) {
        if (behaviour.cfoThrow) throw Error(behaviour.cfoThrow);
        const need = (user.match(/MISSING INPUTS \(estimate these\): (.*)/)?.[1] || "").split(", ").filter((k) => k in CFO_VALUES);
        text = JSON.stringify({ estimates: Object.fromEntries(need.map((k) => [k, { value: CFO_VALUES[k], why: "Because " + k }])), startup: { value: 300, why: "Launch spend" }, ramp: { shares: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.9, 0.9], why: "Slow start" } });
        if (behaviour.cfoReply) text = behaviour.cfoReply(log.filter((c) => c.agent.name === "CFO").length, text);
      } else if (system.includes("customer profile for a simulated")) text = JSON.stringify(PROFILE);
      else if (system.startsWith("You play simulated buyers")) {
        const all = [...user.matchAll(/\[(P\d+)\]/g)].map((m) => m[1]);
        const seenBefore = new Set(asked);
        all.forEach((id) => asked.add(id));
        const ids = behaviour.dropMost ? all.filter((id, i) => i === 0 && !seenBefore.has(id)) : behaviour.dropHalf ? all.slice(0, Math.ceil(all.length / 2)) : all;
        text = JSON.stringify(
          ids.map((id, i) => ({ id, buys: i / ids.length < behaviour.buy ? "yes" : "no", confidence: (i % 5) + 1, reason: "Because " + id, wouldFlipIf: "Lower price", prices: behaviour.zeroPrices ? { tooCheap: 0, bargain: 0, expensive: 0, tooExpensive: 0 } : { tooCheap: behaviour.prices[0] + (i % 3), bargain: behaviour.prices[1] + (i % 3), expensive: behaviour.prices[2] + (i % 3), tooExpensive: behaviour.prices[3] + (i % 3) } })),
        );
      } else if (system.includes("marketing director")) text = "Positioning: ...\nCheapest real test: pre-sale at the suggested price.";
      else if (system.includes("write one experiment")) text = JSON.stringify({ hypothesis: "If we pre-sell, then 5 sign up", plan: "Landing page", success: "5 pre-orders", results: "we won", decision: "go" });
      else throw Error("unexpected prompt: " + system.slice(0, 60));
      return { text, usage: { input: 10, output: 5 } };
    },
  };
  const assistant = createAssistant({ directory, store, providers });
  assistant.update({ planner: { provider: "local", model: "plan-m" }, writer: { provider: "local", model: "write-m" }, simulation: { provider: "local", model: "sim-m" } });
  const pipeline = createPipeline({ directory, store, providers, assistant, webFetch: opts.webFetch, retryDelays: [0, 0] });
  const fields = { solution: "Quantum filters", audience: "Astronomers", price: "9", variableCost: "2", fixedCosts: "100", hoursPerCustomer: "2", availableHours: "100", currency: "$", ...opts.fields };
  const idea = store.put("records", validateRecord({ type: "idea", stage: "draft", title: "Quantum algorithms for telescope data processing", body: "", fields, private: !!opts.private }));
  return { directory, store, providers, assistant, pipeline, idea, log, behaviourSet: (patch) => Object.assign(behaviour, patch) };
}
const live = (store) => store.list("records").filter((r) => !r.deleted);
const EVIDENCE = { problem: ["evidence"], experiment: ["results", "decision"], competitor: ["pricing", "sources"], technology: ["source"], idea: ["price", "variableCost", "fixedCosts", "hoursPerCustomer", "availableHours"] };

async function runToDone(t, statuses = ["done"]) {
  const job = t.pipeline.start(t.idea.id);
  await wait(t.pipeline, job.id, ["waiting_user"]);
  t.pipeline.answer(job.id, { approve: true });
  return wait(t.pipeline, job.id, [...new Set([...statuses, "failed", "stopped"])]);
}
async function toPanel(t, id) {
  let j = await wait(t.pipeline, id, ["waiting_user"]);
  assert.equal(j.waiting.kind, "grill");
  t.pipeline.answer(id, { text: "1. the lab 2. new instruments" });
  j = await wait(t.pipeline, id, ["waiting_user"]);
  assert.equal(j.waiting.kind, "approve_profile");
  return j;
}

async function main() {
  {
    const t = setup();
    const job = t.pipeline.start(t.idea.id);
    assert.equal(job.caps.calls, 40);
    let j = await toPanel(t, job.id);
    assert.equal(j.stages[0].status, "done");
    const thread = t.store.list("messages").filter((m) => m.runId === job.id);
    assert.deepEqual(thread.map((m) => m.role), ["assistant", "user"]);
    assert.ok(t.store.get("sessions", t.store.get("jobs", job.id).work.grill.threadId).contextIds.includes(t.idea.id));
    const draft = live(t.store).find((r) => r.title === "Customer profile (simulated draft)");
    assert.equal(draft.origin.by, "simulation");
    assert.equal(draft.reviewed, null);
    t.pipeline.answer(job.id, { approve: true });
    j = await wait(t.pipeline, job.id, ["done", "stopped", "failed"]);
    assert.equal(j.status, "done", j.error);
    assert.deepEqual(j.stages.map((s) => s.status + (s.error ? ":" + s.error : "")), Array(9).fill("done"));
    assert.ok(j.usage.calls <= 40 && j.usage.calls === j.stages.reduce((n, s) => n + s.usage.calls, 0));
    assert.equal(j.usage.calls, 2 + 4 + 1 + 1 + 5 + 1 + 1 + 1 + 1 + 0, "the summary call is not counted against the job call cap");
    assert.ok(j.stages[3].output.answered === 20);
    const made = live(t.store).filter((r) => r.origin.runId === job.id);
    assert.deepEqual([...new Set(made.map((r) => r.origin.by))].sort(), ["assistant", "simulation"]);
    for (const r of made) {
      assert.equal(r.reviewed === null || r.title.startsWith("Customer profile"), true);
      assert.deepEqual(r.links, [t.idea.id]);
      for (const k of EVIDENCE[r.type] || []) assert.equal(r.fields[k] ?? "", "", `${r.title}.${k}`);
    }
    const exp = made.find((r) => r.type === "experiment");
    assert.equal(exp.origin.by, "assistant");
    assert.deepEqual(Object.keys(exp.fields).sort(), ["hypothesis", "plan", "success"]);
    const comps = made.filter((r) => r.type === "competitor");
    assert.equal(comps.length, 2);
    const astro = comps.find((r) => r.title.startsWith("AstroSoft"));
    assert.equal(astro.fields.facts, "Kind: direct.\nSells (hypothesis): Pipeline software\nPositioning (hypothesis): Classical pipelines\nLikely buyer complaint (hypothesis): Slow\nWhere to check (price and source): Their pricing page");
    assert.equal(astro.fields.gaps, "No quantum");
    assert.doesNotMatch(comps.map((r) => r.fields.facts).join(" "), /\$50|x\.test/);
    const cout = j.stages[1].output;
    assert.deepEqual(cout.axes, { x: { label: "Price", low: "free", high: "costly" }, y: { label: "Convenience", low: "manual", high: "automatic" } });
    assert.deepEqual(cout.items.map((x) => [x.name, x.kind, x.x, x.y, x.recordId === comps.find((r) => r.title.startsWith(x.name)).id]), [["AstroSoft", "direct", 10, 3, true], ["Spreadsheets", "substitute", null, 5, true]]);

    const sum = t.store.get("jobs", job.id).summary;
    assert.deepEqual(Object.keys(sum.sections), ["verdict", "signal", "risk", "numbers", "competitors", "next"]);
    assert.match(sum.sections.next, /^Pre-sell/);
    assert.ok(sum.words >= 100 && sum.words <= 230, "words " + sum.words);
    assert.equal(sum.origin, "assistant");
    assert.equal(sum.localOnly, true);
    assert.equal(sum.model, "write-m");
    const call = t.log.filter((c) => c.system.startsWith("You write the summary"));
    assert.equal(call.length, 1);
    assert.equal(call[0].agent.model, "write-m");
    assert.equal(call[0].meta.stage, "summary:idea");
    assert.equal(call[0].meta.private, false);
    assert.match(call[0].user, /AstroSoft/);
    assert.match(call[0].user, /Chair summary/);
    assert.match(call[0].user, /Quantum for telescopes/);
    assert.match(call[0].user, /"targetSegment"/);
    assert.doesNotMatch(call[0].user, /Quantum filters/, "only pipeline outputs, not the idea fields");
    assert.ok(!made.some((r) => /summary/i.test(r.title)), "the summary is stored on the job, never as an entry");
    const view = t.pipeline.summaryView(t.idea.id);
    assert.equal(view.ready && view.current, true);
    assert.ok(comps.every((r) => r.title.endsWith("(unconfirmed)") && !r.fields.sources && !r.fields.pricing && !r.fields.website && /no web search key/.test(r.body)));
    assert.equal(j.stages[1].output.mode, "memory");
    assert.ok(made.find((r) => r.title === "Brand (simulated)").body.includes("Spark ran none of them"));
    assert.equal(j.stages[7].name, "brand");
    const pricing = made.find((r) => r.title === "Pricing (simulated)").body;
    assert.match(pricing, /Suggested test price, from simulated buyers' answers/);
    assert.match(pricing, /Your own price, from your business math \(\$9\)/);
    assert.equal(j.stages[3].output.meanConfidence > 1 && j.stages[3].output.lowConfidenceShare > 0, true);
    assert.match(made.find((r) => r.title === "Customer panel (simulated)").body, /Yes-rate: \d+%/);
    assert.match(made.find((r) => r.title === "Customer panel (simulated)").body, /Mean confidence [\d.]+ of 5; \d+% of answers were low-confidence/);
    assert.match(made.find((r) => r.title === "Customer panel (simulated)").body, /Upper bound, not evidence/);
    assert.ok(t.log.filter((c) => c.agent.name === "Panel").every((c) => c.agent.model === "sim-m" && c.options.noThink));
    assert.ok(t.log.filter((c) => c.agent.name === "Grill").every((c) => c.agent.model === "write-m"));
    assert.equal(t.store.get("records", t.idea.id).stage, "draft");
    assert.equal(t.store.get("records", t.idea.id).fields.price, "9");

    assert.throws(() => validateRecord({ type: "competitor", stage: "draft", title: "x", fields: { sources: "made up" }, origin: { by: "simulation", runId: job.id }, reviewed: null }), /evidence field/);
    assert.throws(() => validateRecord({ type: "experiment", stage: "draft", title: "x", fields: { results: "made up" }, origin: { by: "assistant", runId: job.id }, reviewed: null }), /evidence field/);

    const before = t.log.length;
    const again = t.pipeline.start(t.idea.id);
    const j2 = await wait(t.pipeline, again.id, ["done", "failed", "stopped"]);
    assert.equal(j2.status, "done", j2.error);
    assert.equal(t.log.length, before, "identical inputs: no stage call and no new summary call");
    assert.ok(j2.stages.every((s) => s.cached));
    assert.equal(t.pipeline.summaryView(t.idea.id).current, true);
    assert.equal((await t.pipeline.summarize(t.idea.id)).cached, true);
    assert.equal(t.log.length, before);
    const forced = await t.pipeline.summarize(t.idea.id, { force: true });
    assert.equal(forced.cached, false);
    assert.equal(t.log.length, before + 1);
    assert.equal(t.pipeline.summaryView(t.idea.id).summary.at, forced.summary.at);
    assert.equal(j2.usage.calls, 0);
    assert.match(t.store.get("jobs", j2.id).stages[0].output.qa, /Owner's answers/);
    assert.equal(t.pipeline.list().length, 2);

    const edited = t.store.get("records", t.idea.id);
    t.store.put("records", { ...edited, fields: { ...edited.fields, audience: "Radio astronomers" } });
    const third = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, third.id, ["waiting_user"]);
    assert.ok(t.log.length > before);
    t.pipeline.cancel(third.id);
    assert.equal(t.pipeline.get(third.id).status, "cancelled");
    assert.throws(() => t.pipeline.resume(third.id), /not paused/);

    const archive = t.store.archive();
    assert.equal(archive.jobs.length, 3);
    const other = openStore(tmp());
    assert.equal(other.importArchive(archive).jobs, 3);
    assert.equal(other.get("jobs", job.id).status, "done");
    assert.throws(() => other.importArchive({ ...archive, jobs: [{ id: "x", kind: "nope", status: "done", stages: [] }] }), /Invalid job/);
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0, summaryBadFirst: true } });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    const j = await wait(t.pipeline, job.id, ["done", "failed"]);
    assert.equal(j.status, "done", j.error);
    assert.equal(j.summary.usage.calls, 2, "one retry when lines are missing");
    assert.ok(j.summary.sections);
    t.store.put("records", { ...t.store.get("records", t.idea.id), title: "Renamed idea" });
    assert.equal(t.pipeline.summaryView(t.idea.id).current, true, "idea edits outside the pipeline outputs do not stale it");
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0 } });
    t.assistant.update({ writer: { provider: "local", model: "write-m:cloud" } });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    const j = await wait(t.pipeline, job.id, ["done", "failed"]);
    assert.equal(j.summary.model, "write-m:cloud");
    assert.equal(j.summary.localOnly, false, "a cloud model served through the local endpoint is not local only");
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0, summaryThrow: true } });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    const j = await wait(t.pipeline, job.id, ["done", "failed"]);
    assert.equal(j.status, "done", "a failed summary never fails the test");
    assert.match(j.summaryError, /did not finish/);
    assert.equal(j.summary, undefined);
    assert.equal(t.pipeline.summaryView(t.idea.id).summary, null);
    assert.equal(t.pipeline.summaryView(t.idea.id).current, false);
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0 } });
    await assert.rejects(() => t.pipeline.summarize(t.idea.id), /Run an idea test or research first/);
    assert.equal(t.pipeline.summaryView(t.idea.id).ready, false);
    t.store.put("records", { ...t.store.get("records", t.idea.id), private: true });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    await wait(t.pipeline, job.id, ["done"]);
    const sum = t.log.filter((c) => c.system.startsWith("You write the summary"));
    assert.equal(sum.length, 1);
    assert.equal(sum[0].meta.private, true, "private ideas tell the cost layer to stay local");
    assert.equal(t.store.get("jobs", job.id).summary.private, true);
    assert.equal(t.pipeline.summaryView(t.idea.id).current, true);
    assert.ok(t.store.list("records").filter((r) => r.origin.runId === job.id).every((r) => r.private), "everything the run wrote stays private");
  }

  {
    const t = setup({ behaviour: { fatalRound: 1 } });
    const job = t.pipeline.start(t.idea.id);
    let j = await wait(t.pipeline, job.id, ["waiting_user"]);
    assert.equal(j.waiting.fatal, "Nobody can pay for it.");
    t.pipeline.park(job.id);
    j = t.pipeline.get(job.id);
    assert.equal(j.status, "stopped");
    assert.equal(j.gate.kind, "gate");
    assert.equal(t.store.get("records", t.idea.id).stage, "parked");
    assert.throws(() => t.pipeline.resume(job.id), /Override/);
    t.pipeline.resume(job.id, { override: true });
    assert.equal(t.store.get("records", t.idea.id).stage, "draft");
    j = await wait(t.pipeline, job.id, ["waiting_user", "failed"]);
    assert.equal(j.stage, "panel", j.error);
    assert.equal(j.stages[1].status, "done");
  }

  {
    const t = setup({ behaviour: { votes: ["PASS", "PASS", "PASS"], noMoreAfter: 0 } });
    const job = t.pipeline.start(t.idea.id);
    let j = await wait(t.pipeline, job.id, ["stopped"]);
    assert.equal(j.gate.stage, "board");
    assert.match(j.gate.reason, /PASS/);
    assert.equal(j.stages[3].status, "pending");
    t.pipeline.resume(job.id, { override: true });
    j = await wait(t.pipeline, job.id, ["waiting_user"]);
    assert.equal(j.waiting.kind, "approve_profile");
    assert.equal(Object.keys(t.store.get("jobs", job.id).overrides).length, 1);
    t.pipeline.cancel(job.id);
    const calls = t.log.length;
    const rerun = t.pipeline.start(t.idea.id);
    j = await wait(t.pipeline, rerun.id, ["waiting_user", "stopped"]);
    assert.equal(j.status, "waiting_user", "identical hash does not re-stop");
    assert.ok(j.stages[2].cached && j.stages[2].gate);
    assert.equal(t.log.length - calls, 1, "only the profile draft ran");
    t.pipeline.cancel(rerun.id);
    const idea = t.store.get("records", t.idea.id);
    t.store.put("records", { ...idea, fields: { ...idea.fields, audience: "Everyone" } });
    const changed = t.pipeline.start(t.idea.id);
    j = await wait(t.pipeline, changed.id, ["stopped", "waiting_user"]);
    assert.equal(j.status, "stopped", "changed hash re-evaluates the gate");
    assert.equal(j.gate.stage, "board");
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 9 } });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    assert.equal(t.pipeline.get(job.id).waiting.kind, "grill");
    t.pipeline.answer(job.id, { text: "good enough", done: true });
    const j = await wait(t.pipeline, job.id, ["waiting_user"]);
    assert.equal(j.waiting.kind, "approve_profile");
    assert.equal(j.stages[0].output.rounds, 1);
    assert.equal(t.log.filter((c) => c.agent.name === "Grill").length, 1);
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 9 } });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    assert.throws(() => t.pipeline.answer(job.id, { text: "" }), /Write your answers/);
    t.pipeline.answer(job.id, { done: true });
    assert.equal((await wait(t.pipeline, job.id, ["waiting_user"])).stages[0].status, "done");
  }

  {
    const t = setup({ behaviour: { buy: -1, noMoreAfter: 0 } });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    const j = await wait(t.pipeline, job.id, ["stopped", "done", "failed"]);
    assert.equal(j.gate?.stage, "panel", j.error);
    assert.match(j.gate.reason, /below 20%/);
    assert.ok(j.summary && j.summary.sections, "a stopped test still gets a summary so the verdict is readable");
    assert.ok(j.stages[3].output.bySegment.every((x) => x.yes + x.no === x.buyers && Array.isArray(x.reasons)));
    assert.equal(j.stage, "panel");
    assert.equal(j.stages[4].status, "pending");
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0 }, fields: { price: "9", variableCost: "12" } });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    const j = await wait(t.pipeline, job.id, ["stopped", "done", "failed"]);
    assert.equal(j.gate?.stage, "pricing", j.error);
    assert.match(j.gate.reason, /loses money|variable cost/);
    t.pipeline.resume(job.id, { override: true });
    assert.equal((await wait(t.pipeline, job.id, ["done", "failed"])).status, "done");
  }

  {
    const t = setup({ fields: { audience: "" }, behaviour: { noMoreAfter: 0 } });
    const job = t.pipeline.start(t.idea.id);
    let j = await wait(t.pipeline, job.id, ["waiting_user"]);
    assert.equal(j.waiting.kind, "need_input");
    const idea = t.store.get("records", t.idea.id);
    t.store.put("records", { ...idea, fields: { ...idea.fields, audience: "Astronomers" } });
    t.pipeline.answer(job.id, {});
    j = await wait(t.pipeline, job.id, ["waiting_user"]);
    assert.equal(j.waiting.kind, "approve_profile");
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0 } });
    t.store.put("records", validateRecord({ type: "note", stage: "draft", title: "Customer profile", body: JSON.stringify(PROFILE), links: [t.idea.id] }));
    const job = t.pipeline.start(t.idea.id);
    const j = await wait(t.pipeline, job.id, ["done", "failed", "waiting_user"]);
    assert.equal(j.status, "done", j.error);
    assert.ok(!live(t.store).some((r) => r.title.includes("simulated draft")));
    const priced = live(t.store).find((r) => r.title === "Customer panel (simulated)");
    assert.ok(priced);
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0 } });
    const comp = t.store.put("records", validateRecord({ type: "competitor", stage: "draft", title: "Real Co", fields: { pricing: "$7 a month", sources: "https://real.test" }, links: [t.idea.id] }));
    const unconfirmed = t.store.put("records", validateRecord({ type: "competitor", stage: "draft", title: "Guess Co", fields: { pricing: "$999" }, links: [t.idea.id] }));
    assert.ok(comp && unconfirmed);
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    const j = await wait(t.pipeline, job.id, ["done", "failed", "stopped"]);
    assert.equal(j.status, "done", j.error);
    assert.deepEqual(j.stages[4].output.competitorPrices, [7, 999].slice(0, 1));
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0, zeroPrices: true }, fields: { price: "" } });
    const job = t.pipeline.start(t.idea.id);
    let w = await wait(t.pipeline, job.id, ["waiting_user"]);
    assert.equal(w.waiting.kind, "need_price");
    assert.throws(() => t.pipeline.answer(job.id, { price: "free" }), /Enter a price/);
    t.pipeline.answer(job.id, { suggest: true });
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    const j = await wait(t.pipeline, job.id, ["stopped", "done", "failed"]);
    assert.equal(j.status, "done", j.error);
    assert.equal(j.stages[3].output.answered, 20);
    assert.equal(j.stages[3].output.inconclusive, false);
  }

  {
    {
      const t = setup({ behaviour: { noMoreAfter: 0 }, fields: { price: "" } });
      const job = t.pipeline.start(t.idea.id);
      assert.equal((await wait(t.pipeline, job.id, ["waiting_user"])).waiting.kind, "need_price");
      const before = t.log.length;
      t.pipeline.answer(job.id, { price: "$12.50" });
      await wait(t.pipeline, job.id, ["waiting_user"]);
      assert.equal(t.store.get("records", t.idea.id).fields.price, "", "the idea keeps no price");
      t.pipeline.answer(job.id, { approve: true });
      const j = await wait(t.pipeline, job.id, ["done", "failed", "stopped"]);
      assert.equal(j.status, "done", j.error);
      assert.deepEqual(j.stages[3].output.pitchPrice, { value: 12.5 });
      const asked = t.log.filter((c) => c.agent.name === "Panel").length;
      assert.ok(asked > 0 && before > 0);
      assert.match(live(t.store).find((r) => r.title === "Customer panel (simulated)").body, /Pitched at \$?12\.5/);
      assert.match(live(t.store).find((r) => r.title === "Pricing (simulated)").body, /pitched the panel at \$12\.5/);
    }
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0, buy: 0, dropMost: true } });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    const j = await wait(t.pipeline, job.id, ["stopped", "done", "failed"]);
    assert.equal(j.status, "done", j.error + JSON.stringify(j.gate));
    assert.equal(j.stages[3].output.answered, 5);
    assert.equal(j.stages[3].output.inconclusive, true);
    assert.match(j.stages[3].output.summary, /^Inconclusive/);
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0, buy: 0.5, dropHalf: true } });
    const job = t.pipeline.start(t.idea.id, { panelN: 100, calls: 12 });
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    let j = await wait(t.pipeline, job.id, ["stopped", "done", "failed"]);
    assert.equal(j.gate?.kind, "cap");
    assert.equal(j.usage.calls, 12);
    assert.equal(j.caps.step, 40);
    assert.equal(j.stages[3].status, "pending");
    const calls = t.log.length;
    t.pipeline.resume(job.id);
    j = await wait(t.pipeline, job.id, ["done", "failed", "stopped"]);
    assert.equal(j.status, "done", j.error);
    assert.ok(j.stages[3].output.answered >= 50);
    assert.equal(t.log.length - calls, j.usage.calls - 12 + 1, "model calls plus the uncounted summary call");
    assert.throws(() => t.pipeline.start(t.idea.id, { panelN: 7 }), /20 buyers/);
  }

  {
    let release;
    const hold = new Promise((r) => (release = r));
    let reached = false;
    const t = setup({ behaviour: { noMoreAfter: 0 }, gate: async (system, signal) => {
      if (system.includes("Monopoly lens")) reached = true;
      if (system.includes("Monopoly lens")) await Promise.race([hold, new Promise((_, rej) => signal.addEventListener("abort", () => rej(signal.reason)))]);
    } });
    const job = t.pipeline.start(t.idea.id);
    for (let i = 0; i < 300 && !reached; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(reached);
    t.pipeline.cancel(job.id);
    const j = await wait(t.pipeline, job.id, ["cancelled"]);
    assert.equal(j.stages[2].status, "pending");
    release();
    assert.throws(() => t.pipeline.start("missing"), /Idea not found/);
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0 } });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    await wait(t.pipeline, job.id, ["done"]);
    const row = t.store.get("jobs", job.id);
    t.store.put("jobs", { ...row, status: "running", stages: row.stages.map((s, i) => (i === 3 ? { ...s, status: "running" } : s)) });
    t.store.close();
    const store = openStore(t.directory);
    const restarted = store.get("jobs", job.id);
    assert.equal(restarted.status, "stopped");
    assert.equal(restarted.stages[3].status, "pending");
    assert.match(restarted.error, /Resume/);
    const assistant = createAssistant({ directory: t.directory, store, providers: t.providers });
    const pipeline = createPipeline({ directory: t.directory, store, providers: t.providers, assistant });
    pipeline.resume(job.id);
    const j = await wait(pipeline, job.id, ["done", "failed"]);
    assert.equal(j.status, "done", j.error);
    assert.equal(j.stages[3].cached, false);
    pipeline.retry(job.id, { stage: "marketing" });
    assert.equal((await wait(pipeline, job.id, ["done", "failed"])).status, "done", "a recovered job can be retried too");
    store.close();
  }

  {
    const KEY = "sk-test-secret-key-123";
    const PAGES = {
      "https://astrosoft.test/pricing": "AstroSoft. Classical pipelines for telescopes. Plans from $49 per month. Free trial.",
      "https://reviews.test/astrosoft": "Reviews of AstroSoft. It is far too slow for large surveys, wrote one user.",
    };
    const stub = (calls, mode = "ok") => async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, auth: init.headers.Authorization, redirect: init.redirect, body });
      if (mode === "denied") return { ok: false, status: 401, headers: new Map(), text: async () => "bad key " + KEY };
      if (url.endsWith("/web_search")) return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ results: [{ title: "AstroSoft pricing", url: "https://astrosoft.test/pricing", content: "AstroSoft pricing" }, { title: "AstroSoft reviews", url: "https://reviews.test/astrosoft", content: "reviews" }, { title: "Local", url: "http://127.0.0.1/admin", content: "no" }] }) };
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ title: "Page", content: PAGES[body.url] || "" }) };
    };
    const calls = [];
    const t = setup({ behaviour: { noMoreAfter: 0 }, webKey: KEY, webFetch: stub(calls) });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    const j = t.pipeline.get(job.id);
    const comp = j.stages[1].output;
    assert.equal(comp.mode, "web");
    assert.equal(comp.sourcedCount, 1);
    assert.equal(calls.filter((c) => c.url.endsWith("/web_search")).length, 3);
    assert.equal(calls.filter((c) => c.url.endsWith("/web_fetch")).length, 2);
    assert.ok(calls.every((c) => c.auth === "Bearer " + KEY && c.redirect === "manual" && c.url.startsWith("https://ollama.com/api/")));
    assert.equal(j.usage.searches, 5);
    const recs = live(t.store).filter((r) => r.type === "competitor");
    const astro = recs.find((r) => r.title.startsWith("AstroSoft"));
    assert.equal(astro.title, "AstroSoft (confirmed by source)");
    assert.equal(astro.origin.by, "simulation");
    assert.equal(astro.reviewed, null);
    assert.equal(astro.fields.website, "https://astrosoft.test/pricing");
    assert.match(astro.fields.facts, /Price \(source: https:\/\/astrosoft\.test\/pricing, accessed \d{4}-\d\d-\d\d\): \$49 per month/);
    assert.match(astro.fields.facts, /Public complaint, verbatim \(source: https:\/\/reviews\.test\/astrosoft/);
    assert.ok(!astro.fields.pricing && !astro.fields.sources);
    const ghost = recs.find((r) => r.title.startsWith("Ghost"));
    assert.equal(ghost.title, "Ghost Co (unconfirmed)");
    assert.doesNotMatch(ghost.fields.facts, /$4b|invented/);
    assert.match(ghost.fields.facts, /Price: not seen on a fetched page/);
    const map = live(t.store).find((r) => r.title === "Competitor map (simulated)").body;
    assert.match(map, /Axes: price by speed/);
    assert.match(map, /lowest 49, median 49, highest 49/);
    assert.ok(!JSON.stringify(t.store.get("jobs", job.id)).includes(KEY));
    assert.ok(!live(t.store).some((r) => JSON.stringify(r).includes("127.0.0.1")));
    for (const lens of ["Offers", "Monopoly", "Product"]) {
      const call = t.log.find((c) => c.agent.name === "Board " + lens);
      assert.ok(call, lens);
      assert.ok(call.user.includes("COMPETITOR EVIDENCE (from web pages"));
      assert.ok(call.user.includes("- AstroSoft (direct): Pipelines for telescope data; price $49 per month"));
    }
    t.pipeline.cancel(job.id);

    const again = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, again.id, ["waiting_user"]);
    assert.ok(t.pipeline.get(again.id).stages[1].cached);
    assert.equal(calls.filter((c) => c.url.endsWith("/web_search")).length, 3, "cached stage does not search again");
    t.pipeline.cancel(again.id);
  }

  {
    const calls = [];
    const t = setup({ behaviour: { noMoreAfter: 0 }, webKey: "k-private", webFetch: async (...a) => calls.push(a), private: true });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    assert.equal(calls.length, 0);
    const out = t.pipeline.get(job.id).stages[1].output;
    assert.equal(out.mode, "memory");
    assert.match(out.reason, /private entry/);
    assert.ok(live(t.store).filter((r) => r.type === "competitor").every((r) => r.title.endsWith("(unconfirmed)") && r.private));
    t.pipeline.cancel(job.id);
  }

  {
    const KEY = "sk-test-secret-key-123";
    const calls = [];
    const denied = async (url, init) => {
      calls.push(url);
      return { ok: false, status: 401, headers: new Map(), text: async () => "bad key " + KEY };
    };
    const t = setup({ behaviour: { noMoreAfter: 0 }, webKey: KEY, webFetch: denied });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    const out = t.pipeline.get(job.id).stages[1].output;
    assert.equal(out.mode, "memory");
    assert.equal(out.degraded, true);
    assert.match(out.reason, /web search failed: Web search key was rejected/);
    assert.equal(calls.length, 1);
    assert.ok(!JSON.stringify(t.store.get("jobs", job.id)).includes(KEY));
    t.pipeline.cancel(job.id);
    const next = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, next.id, ["waiting_user"]);
    assert.equal(t.pipeline.get(next.id).stages[1].cached, false, "a degraded stage is never reused from cache");
    t.pipeline.cancel(next.id);
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0 } });
    const j = t.pipeline.start(t.idea.id, { brand: false });
    assert.equal(j.stages.some((s) => s.name === "brand"), false);
    assert.equal(j.options.brand, false);
    t.pipeline.cancel(j.id);
  }

  // unit economics: assumptions fill the gaps and never touch the idea
  {
    const t = setup({ behaviour: { noMoreAfter: 0 }, fields: { variableCost: "", fixedCosts: "", hoursPerCustomer: "", availableHours: "" } });
    const before = JSON.stringify(t.store.get("records", t.idea.id));
    const j = await runToDone(t);
    assert.equal(j.status, "done", j.error);
    const cfo = j.stages.find((s) => s.name === "cfo");
    assert.equal(cfo.status, "done");
    assert.deepEqual(cfo.output.assumed, ["variableCost", "fixedCosts", "hoursPerCustomer", "availableHours"]);
    for (const k of cfo.output.assumed) {
      assert.equal(cfo.output.assumptions[k].label, "ASSUMPTION");
      assert.equal(cfo.output.assumptions[k].value, CFO_VALUES[k]);
      assert.equal(cfo.output.assumptions[k].why, "Because " + k);
      assert.equal(cfo.output.source[k], "assumed");
    }
    assert.equal(cfo.output.source.price, "yours");
    assert.equal(cfo.output.assumptions.startup.label, "ASSUMPTION");
    assert.equal(cfo.output.assumptions.ramp.shares.length, 12);
    assert.deepEqual(t.store.get("jobs", j.id).work.cfo.est.estimates.fixedCosts, { value: 400, why: "Because fixedCosts" }, "the assumptions live in job.work");
    const e = cfo.output.atTestPrice;
    assert.equal(e.ok, true);
    assert.equal(e.capacity, 60, "120 hours / 2 per customer");
    assert.equal(e.months.length, 12);
    assert.ok(e.cashNeeded >= 300 && Number.isFinite(e.year1Profit) && e.sensitivity.length === 4);
    assert.equal(cfo.output.atOwnPrice.price, 9, "also worked out at the owner's own price");
    assert.equal(cfo.output.atOwnPrice.contribution, 6);
    assert.ok(cfo.output.testPrice > 0);
    const note = live(t.store).find((r) => r.title === "Unit economics (simulated)");
    assert.match(note.body, /ASSUMPTION: Because variableCost/);
    assert.match(note.body, /YEAR 1, MONTH BY MONTH/);
    assert.match(note.body, /Price -10%/);
    assert.ok(!/n\/a|not computed/i.test(note.body));
    assert.equal(JSON.stringify(t.store.get("records", t.idea.id)), before, "the idea is untouched");
    assert.throws(() => validateRecord({ type: "idea", stage: "draft", title: "x", fields: { variableCost: "3" }, origin: { by: "simulation", runId: j.id }, reviewed: null }), /evidence field/);
    assert.throws(() => validateRecord({ type: "note", stage: "draft", title: "x", fields: {}, origin: { by: "simulation", runId: j.id }, reviewed: null, links: [t.idea.id] }) && validateRecord({ ...t.store.get("records", t.idea.id), fields: { ...t.idea.fields, fixedCosts: "400" }, origin: { by: "assistant", runId: j.id }, reviewed: null }), /evidence field/);
    const calls = t.log.filter((c) => c.agent.name === "CFO");
    assert.equal(calls.length, 1);
    assert.match(calls[0].user, /MISSING INPUTS \(estimate these\): variableCost, fixedCosts, hoursPerCustomer, availableHours/);
    assert.match(calls[0].user, /COMPETITOR EVIDENCE/);
    assert.match(calls[0].user, /SIMULATED PANEL/);
    // "Use these numbers": the owner copies them through a normal edit
    const idea = t.store.get("records", t.idea.id);
    const fields = { ...idea.fields };
    for (const k of cfo.output.assumed) fields[k] = String(cfo.output.assumptions[k].value);
    const saved = t.store.put("records", validateRecord({ ...idea, fields }));
    assert.equal(saved.fields.variableCost, "3");
    assert.equal(saved.fields.availableHours, "120");
    assert.equal(saved.origin.by, "user");
  }

  // owner has every input and no price: the price is assumed only when the buyers cannot suggest one
  {
    const t = setup({ behaviour: { noMoreAfter: 0, zeroPrices: true }, fields: { price: "" } });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { suggest: true });
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    const j = await wait(t.pipeline, job.id, ["done", "failed", "stopped"]);
    assert.equal(j.status, "done", j.error);
    const pricing = j.stages.find((s) => s.name === "pricing").output;
    assert.equal(pricing.suggested, null);
    assert.equal(pricing.incomplete.stage, "panel");
    assert.match(pricing.incomplete.reason, /too few usable price answers/);
    const cfo = j.stages.find((s) => s.name === "cfo").output;
    assert.deepEqual(cfo.assumed, ["price"]);
    assert.equal(cfo.testPrice, 8);
    assert.equal(cfo.atOwnPrice, null);
    assert.equal(cfo.atTestPrice.ok, true);
    assert.equal(t.store.get("records", t.idea.id).fields.price, "");
    assert.ok(!/n\/a|not computed/i.test(live(t.store).find((r) => r.title === "Pricing (simulated)").body));
  }

  // a retry does not walk past a gate the owner has not overridden
  {
    const t = setup({ behaviour: { votes: ["PASS", "PASS", "PASS"], noMoreAfter: 0 } });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["stopped"]);
    const before = t.log.length;
    t.pipeline.retry(job.id, { stage: "competitors" });
    const j = await wait(t.pipeline, job.id, ["stopped", "done", "failed"]);
    assert.equal(j.status, "stopped");
    assert.equal(j.gate.stage, "board", "still stopped at the board gate");
    assert.equal(j.stages.find((x) => x.name === "panel").status, "pending");
    assert.ok(!t.log.slice(before).some((c) => c.agent.name === "Panel"), "no later stage ran");
  }

  // 502/503/504 and 429 are retried even without the words "rate limit"
  {
    const t = setup({ behaviour: { noMoreAfter: 0, flaky: { name: "Marketing", times: 1, message: "Request failed (503): upstream" } } });
    const j = await runToDone(t);
    assert.equal(j.status, "done", j.error);
    assert.equal(t.log.filter((c) => c.agent.name === "Marketing").length, 2);
  }

  // a manual retry of competitors gets a fresh search allowance, up to a ceiling per job
  {
    const KEY = "k-search";
    const mk = (calls) => async (url, init) => {
      calls.push(url);
      const body = url.endsWith("/web_search") ? { results: [] } : {};
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    };
    const t = setup({ behaviour: { noMoreAfter: 0 }, webKey: KEY, webFetch: mk([]) });
    const job = t.pipeline.start(t.idea.id);
    await wait(t.pipeline, job.id, ["waiting_user"]);
    const row = t.store.get("jobs", job.id);
    t.store.put("jobs", { ...row, status: "stopped", usage: { ...row.usage, searches: 30 } });
    t.pipeline.retry(job.id, { stage: "competitors" });
    assert.equal(t.store.get("jobs", job.id).caps.searches, 40, "ten more searches for this retry");
    await wait(t.pipeline, job.id, ["waiting_user", "done", "failed", "stopped"]);
    const again = t.store.get("jobs", job.id);
    t.store.put("jobs", { ...again, status: "stopped", usage: { ...again.usage, searches: 85 } });
    t.pipeline.retry(job.id, { stage: "competitors" });
    assert.equal(t.store.get("jobs", job.id).caps.searches, 90, "never above the ceiling");
    await wait(t.pipeline, job.id, ["waiting_user", "done", "failed", "stopped"]);
    const full = t.store.get("jobs", job.id);
    t.store.put("jobs", { ...full, status: "stopped", usage: { ...full.usage, searches: 90 } });
    assert.throws(() => t.pipeline.retry(job.id, { stage: "competitors" }), /Search limit reached for this test. Start a new test/);
  }

  // a flaky model is retried automatically, inside the call cap
  {
    const t = setup({ behaviour: { noMoreAfter: 0, flaky: { name: "Marketing", times: 2, message: "429 rate limit exceeded" } } });
    const j = await runToDone(t);
    assert.equal(j.status, "done", j.error);
    assert.equal(t.log.filter((c) => c.agent.name === "Marketing").length, 3, "two failures then a success");
    assert.equal(j.stages.find((s) => s.name === "marketing").usage.calls, 3, "every attempt counts against the caps");
    assert.equal(j.usage.calls, 1 + 4 + 1 + 1 + 5 + 1 + 1 + 1 + 1 + 2, "one grill call, then every stage, plus the two failed attempts");
  }
  {
    const t = setup({ behaviour: { noMoreAfter: 0, flaky: { name: "Marketing", times: 5, message: "model is busy, try again" } } });
    const j = await runToDone(t, ["failed", "done"]);
    assert.equal(j.status, "failed");
    assert.equal(t.log.filter((c) => c.agent.name === "Marketing").length, 3, "at most two retries");
    assert.equal(j.stages.find((s) => s.name === "marketing").reason, "The model service was too busy to answer.");
    assert.ok(!/busy, try again/.test(j.stages.find((s) => s.name === "marketing").reason), "plain words, not the raw error");
  }
  {
    const t = setup({ behaviour: { noMoreAfter: 0, flaky: { name: "Marketing", times: 1, message: "boom" } } });
    const j = await runToDone(t, ["failed", "done"]);
    assert.equal(j.status, "failed");
    assert.equal(t.log.filter((c) => c.agent.name === "Marketing").length, 1, "an error that is not transient is not retried");
  }
  {
    const t = setup({ behaviour: { noMoreAfter: 0, flaky: { name: "Marketing", times: 2, message: "429 rate limit exceeded" } } });
    const job = t.pipeline.start(t.idea.id, { calls: 1 + 4 + 1 + 1 + 5 + 1 + 1 + 1 + 1 + 1 });
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    const j = await wait(t.pipeline, job.id, ["done", "failed", "stopped"]);
    assert.equal(j.status, "stopped");
    assert.equal(j.gate.kind, "cap", "retries stop at the call cap");
    assert.equal(j.usage.calls, j.caps.calls);
  }

  // a model that sends broken JSON gets a local repair, then one repair prompt
  {
    const t = setup({ behaviour: { noMoreAfter: 0, cfoReply: (n, ok) => (n === 1 ? ok.slice(0, -2) + ",\n```" : ok) } });
    const j = await runToDone(t);
    assert.equal(j.stages.find((s) => s.name === "cfo").status, "done");
    assert.equal(t.log.filter((c) => c.agent.name === "CFO").length, 1, "a trailing comma is repaired locally, no second call");
  }
  {
    const t = setup({ behaviour: { noMoreAfter: 0, cfoReply: (n, ok) => (n === 1 ? "I could not do that." : ok) } });
    const j = await runToDone(t);
    assert.equal(j.stages.find((s) => s.name === "cfo").status, "done");
    const calls = t.log.filter((c) => c.agent.name === "CFO");
    assert.equal(calls.length, 2);
    assert.match(calls[1].user, /Your last reply was rejected/);
  }

  // an optional stage that fails does not block the rest; the retry API reruns just that stage
  {
    const t = setup({ behaviour: { noMoreAfter: 0, cfoThrow: "internal stack trace foo.cjs:12" } });
    const j = await runToDone(t);
    assert.equal(j.status, "done");
    const states = Object.fromEntries(j.stages.map((s) => [s.name, s.status]));
    assert.equal(states.cfo, "failed");
    assert.ok(["marketing", "brand", "experiment"].every((n) => states[n] === "done"), "later stages still ran");
    assert.equal(j.stages.find((s) => s.name === "cfo").reason, "This step did not finish.");
    assert.ok(!JSON.stringify(j.stages.map((s) => s.reason)).includes("stack trace"));
    assert.equal(t.store.get("jobs", j.id).retries, undefined);
    assert.throws(() => t.pipeline.retry(j.id, { stage: "nope" }), /not part of this test/);
    assert.throws(() => t.pipeline.retry("missing", { stage: "cfo" }), /Job not found/);
    t.behaviourSet({ cfoThrow: "" });
    const before = t.log.length;
    const out = t.pipeline.retry(j.id, { stage: "cfo" });
    assert.equal(out.status, "queued");
    assert.throws(() => t.pipeline.retry(j.id, { stage: "cfo" }), /still working/, "not while it is running");
    const r = await wait(t.pipeline, j.id, ["done", "failed", "stopped"]);
    assert.equal(r.status, "done", r.error);
    assert.equal(r.stages.find((s) => s.name === "cfo").status, "done");
    assert.equal(r.stages.find((s) => s.name === "cfo").reason, "");
    const fresh = t.log.slice(before).map((c) => c.agent.name);
    assert.deepEqual(fresh.filter((n) => n !== "Summary"), ["CFO"], "only that stage ran");
    assert.deepEqual(r.retries.map((x) => x.stage), ["cfo"], "history kept");
    assert.equal(r.stages.find((s) => s.name === "panel").usage.calls, 6, "other stages keep their own history");
    assert.ok(r.stages.every((s) => !s.stale));
  }

  // a retry bypasses the cache and marks the stages that used its output as stale
  {
    const t = setup({ behaviour: { noMoreAfter: 0 } });
    const j = await runToDone(t);
    const again = t.pipeline.start(t.idea.id);
    const second = await wait(t.pipeline, again.id, ["done"]);
    assert.equal(second.status, "done");
    const before = t.log.length;
    t.pipeline.retry(j.id, { stage: "competitors" });
    const r = await wait(t.pipeline, j.id, ["done", "failed", "stopped"]);
    assert.equal(r.stages.find((s) => s.name === "competitors").cached, false, "the cache entry is bypassed");
    const ran = t.log.slice(before).map((c) => c.agent.name);
    assert.ok(ran.includes("Competitor scout"));
    assert.ok(!ran.includes("Board Offers") && !ran.includes("Marketing") && !ran.includes("Panel"), "later stages did not rerun");
    const stale = r.stages.filter((s) => s.stale).map((s) => s.name);
    assert.deepEqual(stale.sort(), ["board", "brand", "cfo", "experiment", "marketing"].sort(), "the consumers of the competitor map, and what depends on them");
    assert.ok(r.stages.filter((s) => s.stale).every((s) => s.stale.by === "competitors"));
    assert.ok(!r.stages.find((s) => s.name === "panel").stale && !r.stages.find((s) => s.name === "pricing").stale, "stages that did not use it are not stale");
    // "Update from new results" reruns one stale stage by retrying it
    const b2 = t.log.length;
    t.pipeline.retry(j.id, { stage: "board" });
    const r2 = await wait(t.pipeline, j.id, ["done", "failed", "stopped"]);
    assert.ok(!r2.stages.find((s) => s.name === "board").stale);
    assert.ok(t.log.slice(b2).some((c) => c.agent.name.startsWith("Board")));
    assert.ok(r2.stages.find((s) => s.name === "cfo").stale, "the other stale stages stay marked");
  }
  {
    const t = setup({ behaviour: { noMoreAfter: 0 } });
    const j = await runToDone(t);
    const before = t.log.length;
    t.pipeline.retry(j.id, { stage: "pricing", rerunLater: true });
    const r = await wait(t.pipeline, j.id, ["done", "failed", "stopped"]);
    assert.equal(r.status, "done", r.error);
    const ran = [...new Set(t.log.slice(before).map((c) => c.agent.name))];
    assert.ok(ran.includes("CFO") && ran.includes("Marketing") && ran.includes("Brand") && ran.includes("Experiment"), "downstream stages rerun when asked: " + ran);
    assert.ok(!ran.includes("Panel") && !ran.includes("Competitor scout"));
    assert.ok(r.stages.every((s) => !s.stale));
    assert.equal(r.retries[0].rerunLater, true);
  }

  // retry works on stopped and failed jobs, and a failed stage can be retried by name
  {
    const t = setup({ behaviour: { noMoreAfter: 0, flaky: { name: "Marketing", times: 9, message: "model is busy" } } });
    const j = await runToDone(t, ["failed"]);
    assert.equal(j.status, "failed");
    t.behaviourSet({ flaky: null });
    t.pipeline.retry(j.id, { stage: "marketing" });
    const r = await wait(t.pipeline, j.id, ["done", "failed", "stopped"]);
    assert.equal(r.status, "done", r.error);
    assert.equal(r.stages.find((s) => s.name === "marketing").status, "done");
    assert.ok(r.stages.find((s) => s.name === "brand").status === "done" && r.stages.find((s) => s.name === "experiment").status === "done");
    assert.ok(t.pipeline.get(j.id).retries.length === 1);
  }

  // retry respects the call cap: no hidden extra calls
  {
    const t = setup({ behaviour: { noMoreAfter: 0 } });
    const job = t.pipeline.start(t.idea.id, { calls: 20 });
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    let j = await wait(t.pipeline, job.id, ["done", "failed", "stopped"]);
    j = t.pipeline.get(job.id);
    const used = j.usage.calls;
    const before = t.log.length;
    t.pipeline.retry(job.id, { stage: j.status === "done" ? "marketing" : j.gate.stage });
    const r = await wait(t.pipeline, job.id, ["done", "failed", "stopped"]);
    assert.ok(r.usage.calls <= r.caps.calls, "never past the cap");
    if (used >= j.caps.calls) {
      assert.equal(r.gate.kind, "cap");
      assert.equal(t.log.length, before, "a retry at the cap makes no model call");
    }
  }
  {
    const t = setup({ behaviour: { noMoreAfter: 0 } });
    const j = await runToDone(t);
    const row = t.store.get("jobs", j.id);
    t.store.put("jobs", { ...row, usage: { ...row.usage, calls: row.caps.calls } });
    const before = t.log.length;
    t.pipeline.retry(j.id, { stage: "marketing" });
    const r = await wait(t.pipeline, j.id, ["stopped"]);
    assert.equal(r.gate.kind, "cap");
    assert.equal(r.gate.stage, "marketing");
    assert.equal(t.log.filter((c, i) => i >= before && c.agent.name !== "Summary").length, 0, "no model call past the cap");
    assert.equal(r.stages.find((s) => s.name === "marketing").status, "pending");
    t.pipeline.resume(j.id);
    const ok = await wait(t.pipeline, j.id, ["done", "failed", "stopped"]);
    assert.equal(ok.status, "done", ok.error);
  }

  // partial panel: keep the answers, ask only the missing buyers
  {
    const t = setup({ behaviour: { noMoreAfter: 0, buy: 0.5, dropMost: true } });
    const j = await runToDone(t);
    const panel = j.stages.find((s) => s.name === "panel");
    assert.equal(panel.output.answered, 5);
    assert.equal(panel.output.inconclusive, true);
    assert.equal(panel.output.missing, 15);
    assert.match(panel.output.incomplete.reason, /Only 5 of 20 simulated buyers answered/);
    assert.equal(panel.output.incomplete.action, "Ask the 15 missing buyers");
    const keep = t.store.get("jobs", j.id).work.panel.answers.map((a) => a.id);
    t.behaviourSet({ dropMost: false });
    const before = t.log.length;
    t.pipeline.retry(j.id, { stage: "panel" });
    const r = await wait(t.pipeline, j.id, ["done", "failed", "stopped"]);
    assert.equal(r.status, "done", r.error);
    const asked = t.log.slice(before).filter((c) => c.agent.name === "Panel");
    const ids = asked.flatMap((c) => [...c.user.matchAll(/\[(P\d+)\]/g)].map((m) => m[1]));
    assert.equal(ids.length, 15, "only the missing buyers were asked");
    assert.ok(ids.every((id) => !keep.includes(id)));
    const out = r.stages.find((s) => s.name === "panel").output;
    assert.equal(out.answered, 20);
    assert.equal(out.inconclusive, false);
    assert.equal(out.incomplete, undefined);
    const answers = t.store.get("jobs", j.id).work.panel.answers;
    assert.deepEqual(answers.slice(0, 5).map((a) => a.id), keep, "the earlier answers are kept");
    assert.ok(r.stages.find((s) => s.name === "pricing").stale, "pricing used the panel, so it can be updated");
  }

  // a board member without a clear vote is asked once more, then flagged with a retry
  {
    const t = setup({ behaviour: { noMoreAfter: 0, boardFirst: "My memo with no verdict line." } });
    const j = await runToDone(t);
    const board = j.stages.find((s) => s.name === "board").output;
    assert.deepEqual(board.votes, ["FUND", "FUND IF", "FUND"]);
    assert.equal(board.incomplete, undefined, "the follow-up line fixed it");
  }
  {
    const t = setup({ behaviour: { noMoreAfter: 0, boardFirst: "My memo with no verdict line.", boardFix: false } });
    const j = await runToDone(t);
    const board = j.stages.find((s) => s.name === "board").output;
    assert.equal(board.votes[0], "");
    assert.match(board.incomplete.reason, /Offers member did not give a clear score and vote/);
    assert.equal(board.incomplete.stage, "board");
  }

  // web fallback is incomplete and can be retried; private ideas stay offline on retry
  {
    const calls = [];
    const t = setup({ behaviour: { noMoreAfter: 0 }, webKey: "k-priv", webFetch: async (...a) => (calls.push(a), { ok: false, status: 500, json: async () => ({}), text: async () => "" }), private: true });
    const j = await runToDone(t);
    assert.equal(j.stages.find((s) => s.name === "competitors").output.incomplete, undefined, "no web search was expected for a private idea");
    t.pipeline.retry(j.id, { stage: "competitors" });
    const r = await wait(t.pipeline, j.id, ["done", "failed", "stopped"]);
    assert.equal(r.status, "done", r.error);
    assert.equal(calls.length, 0, "a private idea never reaches the web, not even on retry");
    assert.ok(t.log.length > 0 && t.log.every((c) => c.meta.private === true), "every model call, including the retry, is marked private");
  }
  {
    const t = setup({ behaviour: { noMoreAfter: 0 }, webKey: "k", webFetch: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }) });
    const j = await runToDone(t);
    const comps = j.stages.find((s) => s.name === "competitors").output;
    assert.equal(comps.degraded, true);
    assert.equal(comps.incomplete.stage, "competitors");
    assert.match(comps.incomplete.reason, /web search did not work/);
    assert.ok(!/error|bug|not computed|n\/a/i.test(comps.incomplete.reason));
  }

  {
    const directory = tmp(),
      server = createServer({ directory });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const api = async (p, method = "GET", data) => {
      const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
      return { status: r.status, body: await r.json() };
    };
    const idea = (await api("/api/records", "POST", { type: "idea", stage: "draft", title: "Idea" })).body;
    assert.equal((await api(`/api/ideas/${idea.id}/test`, "POST", {})).status, 400);
    assert.equal((await api("/api/jobs/nope/cancel", "POST", {})).status, 404);
    assert.equal((await api("/api/jobs/nope/retry", "POST", { stage: "cfo" })).status, 404);
    const empty = await api(`/api/ideas/${idea.id}/summary`);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, { ready: false, current: false, busy: false, summary: null });
    const nothing = await api(`/api/ideas/${idea.id}/summary`, "POST", {});
    assert.equal(nothing.status, 409);
    assert.match(nothing.body.error, /Run an idea test or research first/);
    assert.equal((await api("/api/ideas/missing/summary")).status, 404);
    assert.ok(Array.isArray((await api("/api/state")).body.jobs));
    const blocked = await api(`/api/records/${idea.id}`, "PATCH", { stage: "validating" });
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.error, /real results/);
    const exp = (await api("/api/records", "POST", { type: "experiment", stage: "draft", title: "E", links: [idea.id], fields: { results: "5 signed up" } })).body;
    assert.equal((await api(`/api/records/${idea.id}`, "PATCH", { stage: "validating" })).status, 200);
    assert.ok(exp.id);
    const sim = (await api("/api/records", "POST", { type: "experiment", stage: "draft", title: "S", links: [idea.id], origin: { by: "simulation" }, fields: { hypothesis: "h" } })).body;
    await api(`/api/records/${idea.id}`, "PATCH", { stage: "draft" });
    await api(`/api/records/${exp.id}`, "DELETE");
    assert.equal((await api(`/api/records/${idea.id}`, "PATCH", { stage: "validating" })).status, 400);
    assert.ok(sim.id);
    const used = await api(`/api/records/${idea.id}`, "PATCH", { fields: { variableCost: "2.5", fixedCosts: "400", hoursPerCustomer: "2", availableHours: "100" } });
    assert.equal(used.status, 200, "Use these numbers is a normal edit by the owner");
    assert.equal(used.body.fields.fixedCosts, "400");
    assert.equal(used.body.origin.by, "user");
    const refused = await api("/api/records", "POST", { type: "idea", stage: "draft", title: "Sim idea", origin: { by: "simulation" }, fields: { fixedCosts: "400" } });
    assert.equal(refused.status, 400, "a simulated author can never write an evidence field");
    assert.match(refused.body.error, /evidence field/);
    await new Promise((r) => server.close(r));
  }
  console.log("pipeline tests passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
