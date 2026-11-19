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
    generate: async (agent, messages, signal, onDelta, options = {}) => {
      const system = messages[0].content,
        user = messages[messages.length - 1].content;
      log.push({ agent, system: system.slice(0, 40), options });
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
      else if (system.includes("competitive landscape"))
        text = JSON.stringify({ competitors: [{ name: "AstroSoft", kind: "direct", positioning: "Classical pipelines", complaint: "Slow", gap: "No quantum", pricing: "$50", sources: "https://x.test", website: "https://x.test" }, { name: "Spreadsheets", kind: "substitute", positioning: "Free", complaint: "Manual", gap: "No scale" }], gap: "Quantum for telescopes", copycat: "A big cloud" });
      else if (system.includes("customer profile for a simulated")) text = JSON.stringify(PROFILE);
      else if (system.startsWith("You play simulated buyers")) {
        const all = [...user.matchAll(/\[(P\d+)\]/g)].map((m) => m[1]),
          ids = behaviour.dropHalf ? all.slice(0, Math.ceil(all.length / 2)) : all;
        text = JSON.stringify(
          ids.map((id, i) => ({ id, buys: i / ids.length < behaviour.buy ? "yes" : "no", confidence: (i % 5) + 1, reason: "Because " + id, wouldFlipIf: "Lower price", prices: { tooCheap: behaviour.prices[0] + (i % 3), bargain: behaviour.prices[1] + (i % 3), expensive: behaviour.prices[2] + (i % 3), tooExpensive: behaviour.prices[3] + (i % 3) } })),
        );
      } else if (system.includes("marketing director")) text = "Positioning: ...\nCheapest real test: pre-sale at the suggested price.";
      else if (system.includes("write one experiment")) text = JSON.stringify({ hypothesis: "If we pre-sell, then 5 sign up", plan: "Landing page", success: "5 pre-orders", results: "we won", decision: "go" });
      else throw Error("unexpected prompt: " + system.slice(0, 60));
      return { text, usage: { input: 10, output: 5 } };
    },
  };
  const assistant = createAssistant({ directory, store, providers });
  assistant.update({ planner: { provider: "local", model: "plan-m" }, writer: { provider: "local", model: "write-m" }, simulation: { provider: "local", model: "sim-m" } });
  const pipeline = createPipeline({ directory, store, providers, assistant });
  const fields = { solution: "Quantum filters", audience: "Astronomers", price: "9", variableCost: "2", fixedCosts: "100", hoursPerCustomer: "2", availableHours: "100", currency: "$", ...opts.fields };
  const idea = store.put("records", validateRecord({ type: "idea", stage: "draft", title: "Quantum algorithms for telescope data processing", body: "", fields }));
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
    assert.equal(job.caps.calls, 25);
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
    assert.deepEqual(j.stages.map((s) => s.status), Array(7).fill("done"));
    assert.ok(j.usage.calls <= 25 && j.usage.calls === j.stages.reduce((n, s) => n + s.usage.calls, 0));
    assert.equal(j.usage.calls, 2 + 4 + 1 + 1 + 4 + 1 + 1 + 0);
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
    assert.ok(comps.every((r) => r.title.endsWith("(unconfirmed)") && !r.fields.sources && !r.fields.pricing && !r.fields.website));
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
    assert.equal(t.log.length, before);
    assert.ok(j2.stages.every((s) => s.cached));
    assert.equal(j2.usage.calls, 0);
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
    assert.equal(j.stages[2].status, "pending");
    t.pipeline.resume(job.id, { override: true });
    j = await wait(t.pipeline, job.id, ["waiting_user"]);
    assert.equal(j.waiting.kind, "approve_profile");
    assert.equal(Object.keys(t.store.get("jobs", job.id).overrides).length, 1);
    t.pipeline.cancel(job.id);
    const calls = t.log.length;
    const rerun = t.pipeline.start(t.idea.id);
    j = await wait(t.pipeline, rerun.id, ["waiting_user", "stopped"]);
    assert.equal(j.status, "waiting_user", "identical hash does not re-stop");
    assert.ok(j.stages[1].cached && j.stages[1].gate);
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
    const t = setup({ behaviour: { noMoreAfter: 0, buy: 0.5, dropHalf: true } });
    const job = t.pipeline.start(t.idea.id, { panelN: 100 });
    await wait(t.pipeline, job.id, ["waiting_user"]);
    t.pipeline.answer(job.id, { approve: true });
    let j = await wait(t.pipeline, job.id, ["stopped", "done", "failed"]);
    assert.equal(j.gate?.kind, "cap");
    assert.equal(j.usage.calls, 25);
    assert.equal(j.stages[3].status, "pending");
    const calls = t.log.length;
    t.pipeline.resume(job.id);
    j = await wait(t.pipeline, job.id, ["done", "failed", "stopped"]);
    assert.equal(j.status, "done", j.error);
    assert.ok(j.stages[3].output.answered >= 50);
    assert.equal(t.log.length - calls, j.usage.calls - 25);
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
    assert.equal(j.stages[1].status, "pending");
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
    assert.equal((await api("/api/jobs")).body.jobs.length, 0);
    assert.equal((await api("/api/jobs/nope")).status, 404);
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
