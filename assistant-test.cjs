"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { openStore, validateRecord, validateArchive } = require("./store.cjs");
const { createAssistant, parsePlan } = require("./assistant.cjs");
const { createServer } = require("./server.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "spark-assistant-"));
const plan = (actions, extra = {}) =>
  JSON.stringify({ intent: "new_idea", summary: "A summary.", topic: "quantum", keywords: ["quantum", "telescope"], actions, ...extra });
const work = (n) => ({
  id: "https://openalex.org/W" + n,
  title: "Quantum paper " + n,
  display_name: "Quantum paper " + n,
  doi: "https://doi.org/10.1/" + n,
  publication_year: 2020 + n,
  authorships: [{ author: { display_name: "Ada " + n } }],
  primary_location: { source: { display_name: "Journal " + n } },
  abstract_inverted_index: { Quantum: [0], algorithms: [1], help: [2] },
});
const okFetch = (count = 7) => {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    if (url.startsWith("https://api.crossref.org/works/")) return { ok: true, status: 200, json: async () => ({ message: { title: ["Quantum paper " + url.slice(-1)] } }) };
    if (url.startsWith("https://api.crossref.org/works?")) return { ok: true, status: 200, json: async () => ({ message: { items: [] } }) };
    if (url.startsWith("https://export.arxiv.org/")) return { ok: true, status: 200, text: async () => "<feed></feed>" };
    return { ok: true, status: 200, json: async () => ({ meta: { count }, results: [1, 2, 3, 4, 5, 6].map(work) }) };
  };
  f.calls = calls;
  return f;
};

function setup({ plans = [], fetchImpl = okFetch(), brainstorm = ["Here is ", "the reply."], keys = {}, settings = { model: "stub-model" } } = {}) {
  const directory = tmp(),
    store = openStore(directory),
    log = [],
    queue = [...plans];
  const providers = {
    config: (p) => ({ key: keys[p] || "", base: "" }),
    openAlexKey: () => "",
    generate: async (agent, messages, signal, onDelta, options = {}) => {
      log.push({ agent, messages, options });
      const planning = messages[0].content.startsWith("You plan what");
      if (planning) {
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return { text: next ?? "not json", usage: { input: 10, output: 5 } };
      }
      if (brainstorm instanceof Error) throw brainstorm;
      let text = "";
      for (const d of brainstorm) {
        if (signal.aborted) throw signal.reason;
        text += d;
        onDelta(d);
      }
      return { text, usage: { input: 20, output: 8 } };
    },
  };
  const assistant = createAssistant({ directory, store, providers, fetchImpl });
  if (settings) assistant.update(settings);
  const capture = (title = "Quantum computing for astronomy, focus on telescope data", body = "") =>
    store.put("records", validateRecord({ type: "inbox", stage: "inbox", title, body }));
  const run = async (cap, signal = new AbortController().signal) => {
    const events = [],
      job = assistant.begin(cap.id, signal);
    await job.execute((e) => events.push(e));
    return { run: store.get("assistant_runs", job.run.id), events };
  };
  const existing = (title, body = "") =>
    store.put("records", validateRecord({ type: "note", stage: "draft", title, body }));
  return { directory, store, assistant, log, capture, run, existing, providers };
}
const live = (store) => store.list("records").filter((r) => !r.deleted);
const mine = (store, run) => live(store).filter((r) => r.assistantRun === run.id);

async function main() {
  {
    const t = setup({
      plans: [
        plan([
          { action: "create_entry", ref: "a", type: "idea", title: "Quantum algorithms for telescope data", body: "Explore it.", fields: { solution: "Use QFT.", evidence: "made up", price: "5", audience: 7 } },
          { action: "search_papers", query: "quantum algorithms telescope data" },
          { action: "find_related" },
          { action: "ask", question: "Which telescope?" },
        ]),
      ],
      settings: { model: "stub-model", maxPapers: 3 },
    });
    const related = t.existing("Telescope data pipeline", "Quantum telescope data notes");
    const cap = t.capture();
    const { run, events } = await t.run(cap);
    assert.equal(run.status, "done");
    assert.equal(run.planSource, "model");
    assert.equal(run.usage.calls, 2);
    assert.equal(run.usage.inputTokens, 30);
    const idea = mine(t.store, run).find((r) => r.type === "idea");
    assert.ok(idea);
    assert.equal(idea.stage, "draft");
    assert.deepEqual(idea.links.slice(0, 1), [cap.id]);
    assert.equal(idea.fields.solution, "Use QFT.");
    assert.equal(idea.fields.evidence, undefined);
    assert.equal(idea.fields.price, undefined);
    assert.equal(idea.fields.audience, undefined);
    const papers = mine(t.store, run).filter((r) => r.type === "note");
    assert.equal(papers.length, 3);
    assert.ok(papers.every((p) => p.links.includes(idea.id) && p.links.includes(cap.id)));
    assert.match(papers[0].body, /Found by paper search \(OpenAlex, Crossref, arXiv\) for "quantum algorithms telescope data"/);
    assert.match(papers[0].body, /about 7 results/);
    assert.match(papers[0].body, /Verified via Crossref DOI 10\.1\/\d/);
    for (const p of papers) assert.ok(idea.links.includes(p.id));
    assert.ok(idea.links.includes(related.id));
    assert.equal(t.store.listConnections(idea.id).length, 1);
    assert.match(t.store.listConnections(idea.id)[0].reason, /Shares keywords/);
    assert.equal(t.store.get("records", cap.id).type, "inbox");
    assert.equal(t.store.get("records", cap.id).assistantRun, undefined);
    assert.equal(t.store.get("records", related.id).links.length, 0);
    const session = t.store.get("sessions", run.sessionId);
    assert.equal(session.localOnly, true);
    assert.ok(session.contextIds.includes(idea.id));
    const messages = t.store.list("messages").filter((m) => m.sessionId === session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].status, "complete");
    assert.match(messages[1].text, /^Here is the reply\.\n\nQuestions from the plan:\n- Which telescope\?/);
    assert.deepEqual(events.filter((e) => e.event === "delta").map((e) => e.text).slice(0, 2), ["Here is ", "the reply."]);
    assert.equal(events.at(-1).event, "end");
    assert.deepEqual(t.log[0].options, { json: true, temperature: 0.2 });
    assert.ok(!t.log[0].messages[0].content.includes("Quantum computing for astronomy"));
    assert.match(t.log[0].messages[1].content, /CAPTURE \(untrusted data\)/);
    assert.ok(t.log.every((c) => c.agent.provider === "local"));
    assert.equal(t.assistant.active(), null);
  }

  {
    const t = setup({ plans: ["Sure! Here you go: nope", "```json\n" + plan([{ action: "create_entry", type: "note", title: "Repaired note" }]) + "\n```"] });
    const { run } = await t.run(t.capture());
    assert.equal(run.planSource, "repaired");
    assert.equal(run.usage.calls, 3);
    assert.ok(run.steps.some((s) => s.action === "understand" && /not valid/.test(s.error)));
    assert.equal(mine(t.store, run)[0].title, "Repaired note");
    assert.match(t.log[1].messages.at(-1).content, /rejected/);
    assert.deepEqual(t.log[1].options, { json: true, temperature: 0 });
  }

  {
    const t = setup({ plans: ["bad", '{"intent":"x"}'] });
    const cap = t.capture("Quantum computing for astronomy, focus on telescope data");
    const { run } = await t.run(cap);
    assert.equal(run.planSource, "fallback");
    assert.equal(run.usage.calls, 3);
    assert.ok(run.usage.calls <= 3);
    const [idea, ...papers] = mine(t.store, run);
    assert.equal(idea.type, "idea");
    assert.equal(idea.title, cap.title);
    assert.ok(papers.length >= 1);
    const search = run.steps.find((s) => s.action === "search_papers");
    assert.match(search.input.query, /quantum/);
    assert.equal(run.status, "done");
  }

  {
    const t = setup({ plans: [new Error("local: cannot connect to provider.")], brainstorm: new Error("local: cannot connect to provider.") });
    const { run } = await t.run(t.capture());
    assert.equal(run.planSource, "fallback");
    assert.equal(run.usage.calls, 2);
    assert.equal(run.status, "failed");
    assert.match(run.error, /Undo removes them/);
    assert.equal(mine(t.store, run).filter((r) => r.type === "idea").length, 1);
    const reply = t.store.get("messages", run.messageId);
    assert.equal(reply.status, "failed");
    t.assistant.undo(run.id);
    assert.equal(mine(t.store, run).length, 0);
  }

  {
    const t = setup({
      plans: [plan([{ action: "delete_everything", id: "x" }, { action: "toString" }, { action: "create_entry", type: "problem", title: "Kept going", fields: { people: "Astronomers", evidence: "invented" } }])],
    });
    const { run } = await t.run(t.capture());
    assert.equal(run.status, "done");
    const unknown = run.steps.filter((s) => /Unknown action/.test(s.error));
    assert.deepEqual(unknown.map((s) => s.action), ["delete_everything", "toString"]);
    const problem = mine(t.store, run)[0];
    assert.equal(problem.title, "Kept going");
    assert.deepEqual(problem.fields, { people: "Astronomers" });
  }

  {
    const t = setup({ plans: [plan([{ action: "search_papers", query: "quantum telescope" }])] });
    const cap = t.capture("Quantum astronomy");
    const { run } = await t.run(cap);
    assert.equal(run.steps[0].result.defaulted, true);
    const idea = mine(t.store, run).find((r) => r.type === "idea");
    assert.equal(idea.title, "Quantum astronomy");
    assert.ok(mine(t.store, run).filter((r) => r.type === "note").every((n) => n.links.includes(idea.id)));
  }

  {
    const t = setup({ plans: [plan(Array.from({ length: 11 }, (_, i) => ({ action: "create_entry", type: "note", title: "Note " + i })))] });
    const { run } = await t.run(t.capture());
    assert.equal(mine(t.store, run).length, 8);
    const skipped = run.steps.filter((s) => /limited to 8 actions/.test(s.error));
    assert.equal(skipped.length, 3);
    assert.equal(run.status, "done");
  }

  {
    const t = setup();
    const a = t.existing("Existing A"),
      b = t.existing("Existing B");
    t.assistant.update({ model: "stub-model" });
    t.providers.generate = ((original) => async (...args) => {
      if (args[1][0].content.startsWith("You plan what"))
        return {
          text: plan([
            { action: "create_entry", ref: "n", type: "note", title: "Mine" },
            { action: "link", from: "n", to: "not-in-index" },
            { action: "link", from: a.id, to: b.id },
            { action: "update_entry", id: a.id, fields: { solution: "hacked" } },
            { action: "update_entry", id: "n", fields: { evidence: "no" } },
            { action: "link", from: "n", to: a.id },
          ]),
          usage: null,
        };
      return original(...args);
    })(t.providers.generate);
    const { run } = await t.run(t.capture());
    const errors = run.steps.filter((s) => s.error).map((s) => s.error);
    assert.equal(errors.length, 4);
    assert.match(errors[0], /Unknown entry id/);
    assert.match(errors[1], /Unknown entry id|created in this run/);
    assert.match(errors[2], /only works on entries created/);
    assert.match(errors[3], /No valid fields/);
    assert.deepEqual(t.store.get("records", a.id).links, []);
    assert.deepEqual(t.store.get("records", b.id).links, []);
    assert.equal(t.store.get("records", a.id).fields.solution, undefined);
    assert.equal(mine(t.store, run)[0].links.includes(a.id), true);
  }

  {
    const t = setup({ plans: [plan([{ action: "create_entry", ref: "i", type: "idea", title: "Undo me" }, { action: "search_papers", query: "quantum" }, { action: "find_related" }])] });
    const keep = t.existing("Quantum Undo me keep", "quantum telescope");
    const keepBefore = JSON.stringify(t.store.get("records", keep.id));
    const cap = t.capture();
    const { run } = await t.run(cap);
    assert.ok(run.createdIds.length >= 2);
    assert.ok(t.store.listConnections().length >= 0);
    const after = t.assistant.undo(run.id);
    assert.equal(after.status, "undone");
    assert.equal(mine(t.store, run).length, 0);
    for (const id of run.createdIds) assert.ok(t.store.get("records", id).deleted);
    assert.equal(JSON.stringify(t.store.get("records", keep.id)), keepBefore);
    assert.equal(t.store.get("records", cap.id).deleted, null);
    assert.equal(t.store.listConnections().length, 0);
    assert.ok(t.store.get("sessions", run.sessionId));
    assert.equal(after.steps.at(-1).action, "undo");
    assert.throws(() => t.assistant.undo(run.id), /already undone/);
    assert.throws(() => t.assistant.undo("missing"), /not found/);
  }

  {
    const failing = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const t = setup({ plans: [plan([{ action: "create_entry", type: "idea", title: "Rate limited" }, { action: "search_papers", query: "quantum" }])], fetchImpl: failing });
    const { run } = await t.run(t.capture());
    assert.equal(run.status, "done");
    const step = run.steps.find((s) => s.action === "search_papers");
    assert.match(step.error, /rate-limited/);
    assert.equal(mine(t.store, run).length, 1);
    assert.match(t.log.at(-1).messages[1].content, /paper search failed: Paper search unavailable: OpenAlex: rate-limited; Crossref: rate-limited; arXiv: rate-limited/);
  }

  {
    const t = setup({ settings: null });
    const cap = t.capture();
    assert.equal(t.assistant.settings().enabled, false);
    assert.throws(() => t.assistant.begin(cap.id, new AbortController().signal), /Turn on/);
    t.assistant.update({ model: "m" });
    assert.equal(t.assistant.settings().enabled, true);
    t.assistant.update({ enabled: false });
    assert.throws(() => t.assistant.begin(cap.id, new AbortController().signal), /Turn on/);
    t.assistant.update({ enabled: true, provider: "openai", model: "gpt-x" });
    assert.equal(t.assistant.settings().cloud, true);
    assert.throws(() => t.assistant.begin(cap.id, new AbortController().signal), /API key required/);
    assert.equal(t.log.length, 0);
    assert.equal(t.assistant.active(), null);
    t.assistant.update({ provider: "local" });
    assert.throws(() => t.assistant.update({ provider: "evil" }), /supported provider/);
    assert.throws(() => t.assistant.update({ maxPapers: 99 }), /1 to 10/);
    assert.throws(() => t.assistant.begin("nope", new AbortController().signal), /Capture not found/);
    assert.throws(() => t.assistant.begin(t.existing("A note").id, new AbortController().signal), /Capture not found/);
  }

  {
    const t = setup({ keys: { openai: "sk-test" }, plans: [plan([{ action: "create_entry", type: "note", title: "Cloud note" }])], settings: { provider: "openai", model: "gpt-x" } });
    const { run } = await t.run(t.capture());
    assert.equal(run.provider, "openai");
    assert.ok(t.log.every((c) => c.agent.provider === "openai"));
    assert.equal(t.store.get("sessions", run.sessionId).localOnly, false);
    assert.equal(run.usage.calls, 2);
  }

  {
    const t = setup({ plans: [plan([])] });
    const first = t.capture("first");
    const job = t.assistant.begin(first.id, new AbortController().signal);
    assert.throws(() => t.assistant.begin(t.capture("second").id, new AbortController().signal), /already working/);
    await job.execute(() => {});
    assert.equal(t.assistant.active(), null);
  }

  {
    const controller = new AbortController();
    const t = setup({ plans: [plan([{ action: "create_entry", type: "idea", title: "Partial" }])], brainstorm: ["part", "never"] });
    const original = t.providers.generate;
    t.providers.generate = (agent, messages, signal, onDelta, options) =>
      original(agent, messages, signal, (d) => {
        onDelta(d);
        controller.abort(new Error("Cancelled by user"));
      }, options);
    const { run } = await t.run(t.capture(), controller.signal);
    assert.equal(run.status, "failed");
    assert.equal(t.store.get("messages", run.messageId).status, "cancelled");
    assert.equal(t.store.get("messages", run.messageId).text, "part");
    assert.equal(mine(t.store, run).length, 1);
  }

  {
    const t = setup({ plans: [plan([{ action: "create_entry", type: "note", title: "Persisted" }])] });
    const { run } = await t.run(t.capture());
    assert.ok(run.steps.length >= 3);
    assert.ok(run.started && run.finished);
    assert.equal(run.phase, "");
    t.store.close();
    const reopened = openStore(t.directory);
    const again = reopened.get("assistant_runs", run.id);
    assert.deepEqual(again, run);
    assert.equal(reopened.list("assistant_runs").length, 1);
    const archive = reopened.archive();
    assert.equal(archive.assistantRuns.length, 1);
    const fresh = openStore(tmp());
    fresh.importArchive(JSON.parse(JSON.stringify(archive)), "replace");
    const restored = fresh.get("assistant_runs", run.id);
    assert.equal(restored.status, "done");
    assert.deepEqual(restored.createdIds, run.createdIds);
    assert.equal(fresh.get("records", run.createdIds[0]).assistantRun, run.id);
    assert.equal(fresh.importArchive(archive, "merge").assistantRuns, 1);
    assert.deepEqual(validateArchive({ ...archive, assistantRuns: undefined }).assistantRuns, []);
    assert.throws(() => validateArchive({ ...archive, assistantRuns: [{ ...run, status: "bogus" }] }), /Invalid assistant run/);
    assert.throws(() => validateArchive({ ...archive, assistantRuns: [{ ...run, id: "bad id" }] }), /Invalid identifier/);
    assert.throws(() => validateRecord({ type: "note", stage: "draft", title: "x", assistantRun: "bad id" }), /Invalid identifier/);
    fresh.close();
    const stuckDir = tmp(),
      stuck = openStore(stuckDir);
    stuck.put("assistant_runs", { ...run, id: "stuck", status: "running" });
    stuck.close();
    const revived = openStore(stuckDir);
    assert.equal(revived.get("assistant_runs", "stuck").status, "failed");
    revived.close();
    reopened.close();
  }

  assert.deepEqual(parsePlan('prefix {"intent":"a","summary":"b","topic":"c","keywords":[],"actions":[]} suffix').actions, []);
  assert.throws(() => parsePlan('{"intent":"a","summary":"b","topic":"c","keywords":"x","actions":[]}'), /keywords/);
  assert.throws(() => parsePlan('{"intent":"a","summary":"b","topic":"c","keywords":[],"actions":[{"nope":1}]}'), /actions/);

  {
    const directory = tmp(),
      fetchImpl = okFetch(),
      server = createServer({ directory, papersFetch: fetchImpl });
    server.providers.generate = async (agent, messages, signal, onDelta) => {
      if (messages[0].content.startsWith("You plan what"))
        return { text: plan([{ action: "create_entry", type: "idea", title: "HTTP idea" }, { action: "search_papers", query: "quantum" }]), usage: null };
      onDelta("streamed ");
      onDelta("reply");
      return { text: "streamed reply", usage: { input: 1, output: 1 } };
    };
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = "http://127.0.0.1:" + server.address().port;
    const call = (url, method = "GET", data) =>
      fetch(base + url, { method, headers: data === undefined ? {} : { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    let res = await call("/api/assistant/settings");
    assert.equal((await res.json()).enabled, false);
    res = await call("/api/assistant/runs", "POST", { captureId: "x" });
    assert.equal(res.status, 409);
    res = await call("/api/assistant/settings", "POST", { model: "stub", maxPapers: 2 });
    assert.deepEqual(await res.json(), { provider: "local", model: "stub", maxPapers: 2, autoRunOnCapture: true, enabled: true, cloud: false });
    const capture = await (await call("/api/records", "POST", { type: "inbox", stage: "inbox", title: "Quantum thing", body: "", fields: {}, links: [] })).json();
    res = await call("/api/assistant/runs", "POST", { captureId: capture.id });
    assert.equal(res.status, 200);
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(events[0].event, "start");
    assert.equal(events.at(-1).event, "end");
    assert.equal(events.filter((e) => e.event === "delta").map((e) => e.text).join(""), "streamed reply");
    const runId = events[0].runId;
    assert.equal(server.runs.size, 0);
    const state = await (await call("/api/state")).json();
    assert.equal(state.assistantRuns[0].id, runId);
    assert.equal(state.assistant.enabled, true);
    assert.equal(state.records.filter((r) => r.assistantRun === runId).length, 3);
    const one = await (await call("/api/assistant/runs/" + runId)).json();
    assert.equal(one.status, "done");
    assert.equal((await (await call("/api/assistant/runs?limit=5")).json()).runs.length, 1);
    const exported = await (await call("/api/export")).json();
    assert.equal(exported.assistantRuns.length, 1);
    res = await call("/api/assistant/runs/" + runId + "/undo", "POST", {});
    assert.equal((await res.json()).status, "undone");
    res = await call("/api/assistant/runs/" + runId + "/undo", "POST", {});
    assert.equal(res.status, 409);
    res = await call("/api/assistant/runs/missing");
    assert.equal(res.status, 404);
    const after = await (await call("/api/state")).json();
    assert.equal(after.records.filter((r) => r.assistantRun === runId && !r.deleted).length, 0);
    assert.equal(after.records.find((r) => r.id === capture.id).deleted, null);
    res = await call("/api/records/" + exported.records.find((r) => r.assistantRun).id, "PATCH", { title: "Edited by owner" });
    assert.equal((await res.json()).assistantRun, runId);
    await new Promise((r) => server.close(r));
  }
  console.log("assistant tests passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
