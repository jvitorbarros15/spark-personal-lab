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
      let text = "";
      if (system.startsWith("Grill the owner")) {
        const round = Number(user.match(/round (\d+) of/)[1]);
        text = round > behaviour.noMoreAfter ? "NO MORE QUESTIONS" : `Q1 - Who pays: Who pays?\nRecommended: the lab\n\nQ2 - Why now: Why now?\nRecommended: new instruments${round === behaviour.fatalRound ? "\nfatal: Nobody can pay for it." : ""}`;
      } else if (system.includes("chair of a three-member board")) text = "Chair summary.";
      else if (system.includes("Offers lens")) text = `Memo.\nScore: 6/10 | Vote: ${behaviour.votes[0]}`;
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
      else if (system.includes("customer profile for a simulated")) text = JSON.stringify(PROFILE);
      else if (system.startsWith("You play simulated buyers")) {
        const all = [...user.matchAll(/\[(P\d+)\]/g)].map((m) => m[1]),
          ids = behaviour.dropMost ? (all.length === 4 ? all.slice(0, 1) : []) : behaviour.dropHalf ? all.slice(0, Math.ceil(all.length / 2)) : all;
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
  const pipeline = createPipeline({ directory, store, providers, assistant, webFetch: opts.webFetch });
  const fields = { solution: "Quantum filters", audience: "Astronomers", price: "9", variableCost: "2", fixedCosts: "100", hoursPerCustomer: "2", availableHours: "100", currency: "$", ...opts.fields };
  const idea = store.put("records", validateRecord({ type: "idea", stage: "draft", title: "Quantum algorithms for telescope data processing", body: "", fields, private: !!opts.private }));
  return { directory, store, providers, assistant, pipeline, idea, log };
}
const live = (store) => store.list("records").filter((r) => !r.deleted);
const EVIDENCE = { problem: ["evidence"], experiment: ["results", "decision"], competitor: ["pricing", "sources"], technology: ["source"], idea: ["price", "variableCost", "fixedCosts", "hoursPerCustomer", "availableHours"] };

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
    assert.deepEqual(j.stages.map((s) => s.status), Array(8).fill("done"));
    assert.ok(j.usage.calls <= 40 && j.usage.calls === j.stages.reduce((n, s) => n + s.usage.calls, 0));
    assert.equal(j.usage.calls, 2 + 4 + 1 + 1 + 5 + 1 + 1 + 1 + 0, "the summary call is not counted against the job call cap");
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
    assert.equal(j.stages[6].name, "brand");
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
    assert.match(j.summaryError, /summary model down/);
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
    assert.equal(j.status, "done", j.error);
    assert.equal(j.stages[3].output.answered, 5);
    assert.equal(j.stages[3].output.inconclusive, true);
    assert.match(j.stages[3].output.summary, /^Inconclusive/);
  }

  {
    const t = setup({ behaviour: { noMoreAfter: 0, buy: 0.5, dropHalf: true } });
    const job = t.pipeline.start(t.idea.id, { panelN: 100, calls: 25 });
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    let j = await wait(t.pipeline, job.id, ["stopped", "done", "failed"]);
    assert.equal(j.gate?.kind, "cap");
    assert.equal(j.usage.calls, 25);
    assert.equal(j.caps.step, 40);
    assert.equal(j.stages[3].status, "pending");
    const calls = t.log.length;
    t.pipeline.resume(job.id);
    j = await wait(t.pipeline, job.id, ["done", "failed", "stopped"]);
    assert.equal(j.status, "done", j.error);
    assert.ok(j.stages[3].output.answered >= 50);
    assert.equal(t.log.length - calls, j.usage.calls - 25 + 1, "model calls plus the uncounted summary call");
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
    await new Promise((r) => server.close(r));
  }
  console.log("pipeline tests passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
