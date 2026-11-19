"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  http = require("node:http"),
  os = require("node:os"),
  path = require("node:path");
const { openStore, validateRecord } = require("./store.cjs");
const { createCost, isCloud, isCloudName, isOffPeak, nextOffPeak, priceFor, callCost, DEFAULT_PRICES } = require("./cost.cjs");
const { createAssistant } = require("./assistant.cjs");
const { createPipeline } = require("./pipeline.cjs");
const { createServer } = require("./server.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "spark-cost-"));
const PEAK = new Date("2026-11-19T13:00:00Z"),
  EVENING = new Date("2026-11-19T20:00:00Z"),
  SATURDAY = new Date("2026-11-21T13:00:00Z");
const CLOUD = { provider: "local", model: "deepseek-v4-pro:cloud" },
  LOCAL = { provider: "local", model: "plan-m" };
const wait = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

function stub(log, usage = { input: 1000, output: 500 }) {
  return {
    config: () => ({ key: "k", base: "" }),
    openAlexKey: () => "",
    generate: async (agent, messages, signal, onDelta, options = {}) => {
      log.push({ agent, system: messages[0].content, all: messages.map((m) => m.content).join(" "), options });
      let text = "ok";
      if (messages[0].content.startsWith("You file one captured thought"))
        text = JSON.stringify({ intent: "new_idea", type: "idea", title: "Private thing", fields: {}, attachToId: null, paperQuery: null, question: null });
      else if (messages[0].content.startsWith("Grill the owner")) text = "Q1 - Who pays: Who pays?\nRecommended: the lab";
      onDelta(text);
      return { text, usage };
    },
  };
}
function setup(clock = () => PEAK, usage) {
  const directory = tmp(),
    store = openStore(directory),
    log = [],
    base = stub(log, usage);
  let assistant;
  const cost = createCost({ directory, store, providers: base, clock, localModel: () => Object.values({ ...assistant.settings() }).find((a) => a?.model && !isCloudName(a.model)) });
  const providers = cost.wrap(base);
  assistant = createAssistant({ directory, store, providers });
  assistant.update({ planner: LOCAL, writer: CLOUD, simulation: CLOUD });
  return { directory, store, log, cost, providers, assistant, base };
}
const calls = (log) => log.filter((c) => c.agent.model.endsWith("cloud"));

async function main() {
  // naming, off-peak, price math
  assert.ok(isCloudName("deepseek-v4-pro:cloud") && isCloudName("gpt-oss:120b-cloud") && !isCloudName("llama3.1:8b") && !isCloudName("cloudy-model"));
  assert.ok(isCloud({ provider: "openai", model: "gpt-x" }) && isCloud(CLOUD) && !isCloud(LOCAL));
  assert.ok(!isOffPeak(PEAK) && isOffPeak(EVENING) && isOffPeak(SATURDAY) && isOffPeak(new Date("2026-11-19T11:59:00Z")) && !isOffPeak(new Date("2026-11-19T17:59:00Z")) && isOffPeak(new Date("2026-11-19T18:00:00Z")));
  assert.equal(nextOffPeak(PEAK).toISOString(), "2026-11-19T18:00:00.000Z");
  assert.equal(nextOffPeak(EVENING).toISOString(), EVENING.toISOString());
  assert.equal(nextOffPeak(new Date("2026-11-20T17:59:59Z")).toISOString(), "2026-11-20T18:00:00.000Z");
  assert.equal(nextOffPeak(SATURDAY).toISOString(), SATURDAY.toISOString());
  const pro = priceFor(CLOUD, DEFAULT_PRICES);
  assert.equal(callCost(100000, 20000, pro, false), 0.2112);
  assert.equal(callCost(100000, 20000, pro, true), 0.1056);
  assert.equal(callCost(1e6, 1e6, priceFor({ provider: "local", model: "gpt-oss:120b-cloud" }, DEFAULT_PRICES), true), 0.75);
  assert.equal(callCost(1e6, 1e6, priceFor({ provider: "local", model: "kimi-k3:cloud" }, DEFAULT_PRICES), true), 18);
  assert.equal(callCost(5000, 5000, priceFor(LOCAL, DEFAULT_PRICES), false), 0);
  assert.equal(priceFor({ provider: "local", model: "mystery:cloud" }, DEFAULT_PRICES), null);
  assert.equal(callCost(10, 10, null, false), null);

  // ledger rows, off-peak, unknown price
  {
    const t = setup();
    await t.providers.generate(CLOUD, [{ role: "user", content: "hi" }], new AbortController().signal, () => {}, {}, { stage: "pipeline:board", runId: "run-1" });
    const [row] = t.store.list("usage");
    assert.deepEqual({ ...row, id: undefined, at: undefined }, { id: undefined, at: undefined, provider: "local", model: "deepseek-v4-pro:cloud", cloud: true, stage: "pipeline:board", runId: "run-1", tokensIn: 1000, tokensOut: 500, costUsd: 0.0033, offPeak: false, estimated: false, note: "" });
    await t.providers.generate(LOCAL, [{ role: "user", content: "hi" }], new AbortController().signal, () => {}, {}, { stage: "assistant:planner" });
    assert.equal(t.store.list("usage")[1].cloud, false);
    assert.equal(t.store.list("usage")[1].costUsd, 0);
    await t.providers.generate({ provider: "local", model: "mystery:cloud" }, [{ role: "user", content: "hi" }], new AbortController().signal, () => {}, {}, { stage: "discussion:builder" });
    assert.equal(t.store.list("usage")[2].costUsd, null);
    const s = t.cost.summary();
    assert.equal(s.spent, 0.0033);
    assert.equal(s.unknownCalls, 1);
    assert.equal(s.byModel["deepseek-v4-pro:cloud"].calls, 1);
    assert.equal(s.byFeature.pipeline.costUsd, 0.0033);
    assert.equal(s.byFeature.discussion.unknown, 1);
    assert.equal(s.byRun["run-1"].costUsd, 0.0033);
    const off = setup(() => EVENING);
    await off.providers.generate(CLOUD, [{ role: "user", content: "hi" }], new AbortController().signal, () => {}, {}, { stage: "pipeline:board" });
    assert.equal(off.store.list("usage")[0].costUsd, 0.00165);
    assert.equal(off.store.list("usage")[0].offPeak, true);
    const noUsage = setup(() => PEAK, null);
    await noUsage.providers.generate(CLOUD, [{ role: "user", content: "x".repeat(400) }], new AbortController().signal, () => {}, {}, { stage: "pipeline:board" });
    assert.equal(noUsage.store.list("usage")[0].estimated, true);
    assert.equal(noUsage.store.list("usage")[0].tokensIn, 100);
  }

  // settings validation and editable prices
  {
    const t = setup();
    assert.equal(t.cost.settings().budget, 5);
    assert.match(t.cost.settings().pricesNote, /2026-11-19.*ollama\.com\/pricing/);
    assert.throws(() => t.cost.update({ budget: -1 }), /monthly budget/);
    assert.throws(() => t.cost.update({ prices: { x: { input: "a", output: 1 } } }), /Input price/);
    t.cost.update({ budget: 7, prices: { "my-model:cloud": { input: 1, output: 2 } } });
    assert.equal(t.cost.settings().budget, 7);
    await t.providers.generate({ provider: "local", model: "my-model:cloud" }, [{ role: "user", content: "hi" }], new AbortController().signal, () => {}, {}, { stage: "x:y" });
    assert.equal(t.store.list("usage")[0].costUsd, 0.002);
  }

  // budget cap falls back to local
  {
    const t = setup();
    t.cost.update({ budget: 0.01 });
    t.store.put("usage", { id: "old", at: PEAK.toISOString(), provider: "local", model: "deepseek-v4-pro:cloud", cloud: true, stage: "pipeline:board", runId: "", tokensIn: 0, tokensOut: 0, costUsd: 0.0095, offPeak: false, estimated: false, note: "" });
    const notes = [];
    const r = await t.providers.generate(CLOUD, [{ role: "user", content: "hi" }], new AbortController().signal, () => {}, {}, { stage: "pipeline:board", note: (n) => notes.push(n) });
    assert.equal(t.log.at(-1).agent.model, "plan-m");
    assert.ok(r.fellBack);
    assert.match(notes[0], /^budget: used local model/);
    const row = t.store.list("usage").at(-1);
    assert.equal(row.cloud, false);
    assert.equal(row.costUsd, 0);
    assert.match(row.note, /budget/);
    t.cost.update({ budget: 5 });
    await t.providers.generate(CLOUD, [{ role: "user", content: "hi" }], new AbortController().signal, () => {}, {}, { stage: "pipeline:board" });
    assert.equal(t.log.at(-1).agent.model, "deepseek-v4-pro:cloud");
    const lastMonth = setup(() => new Date("2026-12-02T10:00:00Z"));
    lastMonth.cost.update({ budget: 0.01 });
    lastMonth.store.put("usage", { id: "old", at: "2026-11-20T10:00:00.000Z", provider: "local", model: "deepseek-v4-pro:cloud", cloud: true, stage: "a:b", runId: "", tokensIn: 0, tokensOut: 0, costUsd: 4, offPeak: false, estimated: false, note: "" });
    assert.equal(lastMonth.cost.spent(), 0);
    const noLocal = setup();
    noLocal.assistant.update({ planner: CLOUD });
    noLocal.cost.update({ budget: 0 });
    await assert.rejects(noLocal.providers.generate(CLOUD, [{ role: "user", content: "hi" }], new AbortController().signal, () => {}, {}, { private: true }), /local model/);
    assert.equal(calls(noLocal.log).length, 0);
  }

  // find_related never shows a private title to a cloud model on a public run
  {
    const t = setup();
    t.store.put("records", validateRecord({ type: "note", stage: "draft", title: "Private thing hiddentitle", body: "private thing", private: true }));
    const cap = t.store.put("records", validateRecord({ type: "inbox", stage: "inbox", title: "Private thing zebra annealing", body: "" }));
    let finish;
    const done = new Promise((r) => (finish = r));
    t.assistant.enqueue(cap.id, (e) => e.event === "end" && finish());
    await done;
    assert.ok(!t.log.some((c) => c.all.includes("hiddentitle")));
  }

  // parallel cloud calls cannot together pass the cap
  {
    const t = setup();
    t.cost.update({ budget: 0.03 });
    const go = () => t.providers.generate(CLOUD, [{ role: "user", content: "hi" }], new AbortController().signal, () => {}, {}, { stage: "pipeline:board" });
    const results = await Promise.all([go(), go(), go()]);
    assert.equal(results.filter((r) => r.fellBack).length, 2);
    assert.equal(t.log.filter((c) => c.agent.model.endsWith("cloud")).length, 1);
  }

  // structured output never goes to a cloud model
  {
    const t = setup();
    await t.providers.generate(CLOUD, [{ role: "user", content: "hi" }], new AbortController().signal, () => {}, { schema: { type: "object" } }, { stage: "research:cite" });
    assert.equal(t.log[0].agent.model, "plan-m");
  }

  // assistant: private capture never reaches a cloud model; public run does
  {
    const t = setup();
    const secret = t.store.put("records", validateRecord({ type: "note", stage: "draft", title: "Secret plan for telescope", body: "classified", private: true }));
    const open = t.store.put("records", validateRecord({ type: "note", stage: "draft", title: "Open telescope note", body: "public" }));
    const runOne = async (cap) => {
      let finish;
      const done = new Promise((r) => (finish = r)),
        run = t.assistant.enqueue(cap.id, (e) => e.event === "end" && finish());
      await done;
      return t.store.get("assistant_runs", run.id);
    };
    const pub = t.store.put("records", validateRecord({ type: "inbox", stage: "inbox", title: "A public thought about telescope", body: "" }));
    const first = await runOne(pub);
    assert.equal(first.status, "done");
    assert.equal(first.private, false);
    assert.ok(calls(t.log).length >= 1, "public run uses the cloud writer");
    const planner = t.log.find((c) => c.system.startsWith("You file one captured thought"));
    assert.ok(!planner.system.includes("Secret plan") && !JSON.stringify(t.log).includes("classified"));
    t.log.length = 0;
    const cap = t.store.put("records", validateRecord({ type: "inbox", stage: "inbox", title: "My private thought", body: "", private: true }));
    const run = await runOne(cap);
    assert.equal(run.status, "done");
    assert.equal(run.private, true);
    assert.equal(calls(t.log).length, 0, "no cloud call for a private capture");
    assert.ok(t.log.length >= 2 && t.log.every((c) => c.agent.model === "plan-m"));
    assert.ok(run.steps.some((s) => s.action === "cost" && /private: used local model/.test(s.result.note)));
    const made = t.store.list("records").filter((r) => r.origin?.runId === run.id);
    assert.ok(made.length && made.every((r) => r.private === true));
    const rows = t.store.list("usage").filter((u) => u.runId === run.id);
    assert.ok(rows.length >= 2 && rows.every((u) => !u.cloud && u.costUsd === 0));
    assert.ok(rows.some((u) => /private: used local model/.test(u.note)));
    assert.ok(secret && open);
  }

  // pipeline and research: private idea never reaches a cloud model; positive control does
  {
    for (const kind of ["test", "research"]) {
      for (const priv of [true, false]) {
        const t = setup();
        const pipeline = createPipeline({ directory: t.directory, store: t.store, providers: t.providers, assistant: t.assistant, cost: t.cost, clock: () => PEAK });
        const idea = t.store.put("records", validateRecord({ type: "idea", stage: "draft", title: "Quantum filters", body: "", private: priv }));
        const job = kind === "test" ? pipeline.start(idea.id) : pipeline.startResearch(idea.id);
        await wait(() => t.log.length >= 1);
        await wait(() => ["waiting_user", "failed", "stopped", "done"].includes(pipeline.get(job.id).status));
        if (priv) {
          assert.equal(calls(t.log).length, 0, `${kind}: no cloud call`);
          assert.ok(t.store.list("usage").filter((u) => u.runId === job.id).every((u) => !u.cloud));
          assert.match(t.store.get("jobs", job.id).work.notes?.[0] || "", /private: used local model/);
        } else {
          if (kind === "test") {
            assert.ok(calls(t.log).length >= 1, "control run uses the cloud model");
            assert.ok(t.store.list("usage").some((u) => u.runId === job.id && u.cloud));
          } else assert.match(t.store.get("jobs", job.id).work.notes?.[0] || "", /structured output needs a local model/);
        }
        const linked = t.store.list("records").filter((r) => r.origin?.runId === job.id);
        assert.ok(linked.every((r) => r.private === priv));
        if (pipeline.get(job.id).status !== "done") try { pipeline.cancel(job.id); } catch {}
        pipeline.shutdown();
      }
    }
    // a private record linked to the idea also makes the job local-only
    const t = setup();
    const pipeline = createPipeline({ directory: t.directory, store: t.store, providers: t.providers, assistant: t.assistant, cost: t.cost, clock: () => PEAK });
    const note = t.store.put("records", validateRecord({ type: "note", stage: "draft", title: "Private note", private: true }));
    const idea = t.store.put("records", validateRecord({ type: "idea", stage: "draft", title: "Linked idea", links: [note.id] }));
    const job = pipeline.start(idea.id);
    await wait(() => ["waiting_user", "failed", "stopped"].includes(pipeline.get(job.id).status));
    assert.equal(calls(t.log).length, 0);
    assert.ok(t.log.length >= 1);
    pipeline.shutdown();
  }

  // off-peak scheduling
  {
    const t = setup();
    let now = PEAK;
    const pipeline = createPipeline({ directory: t.directory, store: t.store, providers: t.providers, assistant: t.assistant, cost: t.cost, clock: () => now });
    const idea = t.store.put("records", validateRecord({ type: "idea", stage: "draft", title: "Later idea", body: "" }));
    const job = pipeline.start(idea.id, { when: "offpeak" });
    assert.equal(job.scheduledFor, "2026-11-19T18:00:00.000Z");
    assert.equal(job.status, "queued");
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(t.log.length, 0);
    assert.equal(pipeline.get(job.id).status, "queued");
    assert.equal(pipeline.cancel(job.id).status, "cancelled");
    assert.throws(() => pipeline.start(idea.id, { when: "soon" }), /run now or wait/);
    now = EVENING;
    const direct = pipeline.start(idea.id, { when: "offpeak" });
    assert.equal(direct.scheduledFor, "");
    await wait(() => t.log.length >= 1);
    pipeline.cancel(direct.id);
    pipeline.shutdown();
    // estimate: peak now vs off-peak, then history
    const e1 = pipeline.estimate(idea.id, "test");
    assert.equal(e1.basis, "typical run");
    assert.equal(e1.tokensIn, 45000 > 25 * 12000 ? 25 * 12000 : 45000);
    assert.ok(e1.costNowUsd !== null && e1.costOffPeakUsd <= e1.costNowUsd);
    now = PEAK;
    const e2 = pipeline.estimate(idea.id, "research");
    assert.ok(e2.costOffPeakUsd < e2.costNowUsd);
    assert.equal(e2.nextOffPeak, "2026-11-19T18:00:00.000Z");
    assert.equal(e2.offPeakNow, false);
    t.store.put("usage", { id: "h1", at: PEAK.toISOString(), provider: "local", model: "x", cloud: false, stage: "research:frame", runId: "hist", tokensIn: 8000, tokensOut: 2000, costUsd: 0, offPeak: false, estimated: false, note: "" });
    t.store.put("jobs", { id: "hist", status: "done" });
    const e3 = pipeline.estimate(idea.id, "research");
    assert.match(e3.basis, /average of 1 past research run/);
    assert.equal(e3.tokensIn, 8000);
    const priv = t.store.put("records", validateRecord({ type: "idea", stage: "draft", title: "Priv", private: true }));
    assert.equal(pipeline.estimate(priv.id, "test").costNowUsd, 0);
    t.assistant.update({ writer: { provider: "local", model: "mystery:cloud" }, simulation: { provider: "local", model: "mystery:cloud" } });
    assert.equal(pipeline.estimate(idea.id, "test").costNowUsd, null);
  }

  // export / import of usage rows and the private flag
  {
    const t = setup();
    await t.providers.generate(CLOUD, [{ role: "user", content: "hi" }], new AbortController().signal, () => {}, {}, { stage: "pipeline:board", runId: "r" });
    t.store.put("records", validateRecord({ type: "note", stage: "draft", title: "Hush", private: true }));
    const archive = t.store.archive();
    assert.equal(archive.usage.length, 1);
    assert.equal(archive.records[0].private, true);
    const other = openStore(tmp());
    const result = other.importArchive(JSON.parse(JSON.stringify(archive)), "merge");
    assert.equal(result.usage, 1);
    assert.deepEqual(other.list("usage"), archive.usage);
    assert.equal(other.list("records")[0].private, true);
    assert.throws(() => other.importArchive({ ...archive, usage: [{ id: "u", costUsd: -1 }] }), /usage cost/);
    assert.throws(() => validateRecord({ type: "note", stage: "draft", title: "x", private: "yes" }), /private flag/);
    assert.equal(validateRecord({ type: "note", stage: "draft", title: "x" }).private, false);
    const old = { ...archive };
    delete old.usage;
    assert.equal(openStore(tmp()).importArchive(old, "merge").usage, 0);
  }

  // discussion over HTTP: private context uses the local model, public context uses the cloud one
  {
    const models = [];
    const upstream = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      models.push(body.model);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: " + JSON.stringify({ choices: [{ delta: { content: "hi" }, finish_reason: null }] }) + "\n\n");
      res.write("data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50 } }) + "\n\n");
      res.end("data: [DONE]\n\n");
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const directory = tmp();
    const server = createServer({ directory, testBases: { local: `http://127.0.0.1:${upstream.address().port}/v1` }, clock: () => PEAK });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const api = async (url, method = "GET", data) => {
      const res = await fetch(base + url, { method, headers: data ? { "Content-Type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined });
      return res.headers.get("content-type")?.includes("ndjson") ? (await res.text()).trim().split("\n").map(JSON.parse) : { status: res.status, body: await res.json() };
    };
    try {
      await api("/api/assistant/settings", "POST", { planner: LOCAL });
      const secret = (await api("/api/records", "POST", { type: "note", stage: "draft", title: "Secret", private: true })).body;
      const open = (await api("/api/records", "POST", { type: "note", stage: "draft", title: "Open" })).body;
      assert.equal(secret.private, true);
      const patched = (await api(`/api/records/${open.id}`, "PATCH", { private: true })).body;
      assert.equal(patched.private, true);
      assert.equal((await api(`/api/records/${open.id}`, "PATCH", { private: "nope" })).status, 400);
      await api(`/api/records/${open.id}`, "PATCH", { private: false });
      const agent = { id: "A", name: "A", role: "builder", provider: "local", model: "deepseek-v4-pro:cloud", instruction: "" };
      const mk = async (contextIds) => (await api("/api/sessions", "POST", { title: "t", mode: "solo", agents: [agent], contextIds, rounds: 1, localOnly: false })).body;
      const privateSession = await mk([secret.id, open.id]),
        publicSession = await mk([open.id]);
      const privateEvents = await api("/api/chat", "POST", { sessionId: privateSession.id, prompt: "Think." });
      assert.ok(privateEvents.some((e) => e.event === "message_start"));
      assert.deepEqual(models, ["plan-m"]);
      assert.ok(!models.includes("deepseek-v4-pro:cloud"));
      await api("/api/chat", "POST", { sessionId: publicSession.id, prompt: "Think." });
      assert.deepEqual(models, ["plan-m", "deepseek-v4-pro:cloud"]);
      const later = await mk([open.id]);
      await api("/api/sessions/" + later.id, "PATCH", { contextIds: [secret.id] });
      await api("/api/chat", "POST", { sessionId: later.id, prompt: "Think." });
      await api("/api/sessions/" + later.id, "PATCH", { contextIds: [] });
      await api("/api/chat", "POST", { sessionId: later.id, prompt: "Think again." });
      assert.deepEqual(models.slice(2), ["plan-m", "plan-m"], "history that held a private entry stays local after it is deselected");
      const state = (await api("/api/state")).body;
      assert.equal(state.cost.byFeature.discussion.calls, 1);
      assert.equal(state.cost.spent > 0, true);
      const cost = (await api("/api/cost")).body;
      assert.equal(cost.budget, 5);
      const saved = (await api("/api/cost/settings", "POST", { budget: 9 })).body;
      assert.equal(saved.budget, 9);
      assert.equal((await api("/api/cost/settings", "POST", { budget: "lots" })).status, 400);
      const idea = (await api("/api/records", "POST", { type: "idea", stage: "draft", title: "Estimate me" })).body;
      const estimate = (await api(`/api/ideas/${idea.id}/estimate?kind=test`)).body;
      assert.ok(estimate.tokensIn > 0 && "costNowUsd" in estimate);
    } finally {
      await new Promise((r) => server.close(r));
      upstream.close();
    }
  }
  console.log("cost tests passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
