"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { decide, embed, cosine, knn, calibrate, metrics, temper, createEngine } = require("./decide.cjs");
const { openStore, validateArchive } = require("./store.cjs");

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const tok = (token, logprob, top = []) => ({ token, logprob, bytes: [...Buffer.from(token)], top_logprobs: top.map(([t, lp]) => ({ token: t, logprob: lp, bytes: [...Buffer.from(t)] })) });
const lp = (p) => Math.log(p);

// Streams {"id": "X"} the way qwen3 tokenises it: a quote token, then the value token with ranked alternatives.
function payload(fields, extra = {}) {
  const content = JSON.stringify(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.pick])), null, 2),
    logprobs = [tok("{\n", -3, [["Okay", lp(0.9)]])];
  for (const [k, v] of Object.entries(fields)) {
    logprobs.push(tok(`  "${k}":`, -0.01), tok(' "', -0.01));
    logprobs.push(tok(v.pick, lp(v.top[0][1]), v.top.map(([t, p]) => [t, lp(p)])));
    logprobs.push(tok('",\n', -0.3));
  }
  return { model: "stub", message: { role: "assistant", content }, done: true, prompt_eval_count: 40, eval_count: 9, logprobs, ...extra };
}
const stub = (handlers) => {
  const calls = [];
  const f = async (url, init) => {
    const path = new URL(url).pathname,
      body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ path, body });
    const h = handlers[path];
    if (!h) return { ok: false, status: 404, text: async () => "no handler", json: async () => ({}) };
    const out = await h(body);
    return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) };
  };
  f.calls = calls;
  return f;
};

const INTENTS = [{ value: "new_idea", label: "new_idea" }, { value: "new_problem", label: "new_problem" }, { value: "note_for_existing", label: "note_for_existing" }, { value: "question", label: "question" }, { value: "task", label: "task" }];

async function main() {
  {
    const f = stub({ "/api/chat": () => payload({ intent: { pick: "E", top: [["E", 0.7], ["task", 0.1], ["D", 0.1], ["Okay", 0.05], ["A", 0.02]] } }) });
    const [r] = await decide({ state: "Email Priya", questions: [{ id: "intent", type: "choice", options: INTENTS }] }, { model: "stub", fetchImpl: f });
    const sent = f.calls[0].body;
    assert.equal(sent.think, false);
    assert.equal(sent.stream, false);
    assert.equal(sent.logprobs, true);
    assert.equal(sent.top_logprobs, 10);
    assert.equal(sent.options.temperature, 0);
    assert.deepEqual(sent.format.properties.intent.enum, ["A", "B", "C", "D", "E"]);
    assert.deepEqual(sent.format.required, ["intent"]);
    assert.match(sent.messages[1].content, /E\) task/);
    assert.equal(r.answer, "task");
    near(r.coverage, 0.92);
    near(r.probabilities.task, (0.7 + 0.1) / 0.92);
    near(r.probabilities.question, 0.1 / 0.92);
    near(r.probabilities.new_idea, 0.02 / 0.92);
    near(Object.values(r.probabilities).reduce((a, b) => a + b, 0), 1);
    near(r.confidence, r.probabilities.task);
    assert.equal(r.logprobs, true);
    assert.equal(r.usage.input, 40);
    assert.equal(r.model, "stub");
    assert.ok(r.latencyMs >= 0);
  }
  {
    const f = stub({
      "/api/chat": () =>
        payload({
          intent: { pick: "A", top: [["A", 0.6], ["new", 0.2], ["B", 0.1]] },
          relevant: { pick: "B", top: [["B", 0.8], ["yes", 0.1], ["no", 0.05]] },
        }),
    });
    const out = await decide({ state: "s", questions: [{ id: "intent", type: "choice", options: INTENTS }, { id: "relevant", type: "yesno", statement: "It is relevant." }] }, { model: "stub", fetchImpl: f });
    assert.equal(f.calls.length, 1);
    assert.equal(out.length, 2);
    near(out[0].coverage, 0.7);
    assert.equal(out[0].probabilities.new_problem > 0.1, true);
    assert.equal(out[1].answer, "no");
    near(out[1].yes, 0.1 / 0.95);
    near(out[1].probabilities.no, 0.85 / 0.95);
    assert.equal(out[0].usage.shared, true);
  }
  {
    const f = stub({ "/api/chat": () => payload({ intent: { pick: "A", top: [["A", 0.9]] }, q2: { pick: "A", top: [["A", 0.9]] } }) });
    await decide({ state: "s", questions: [{ id: "intent", type: "choice", options: INTENTS }, { id: "q2", type: "yesno", statement: "x" }] }, { model: "stub", fetchImpl: f, batch: false });
    assert.equal(f.calls.length, 2);
    assert.deepEqual(Object.keys(f.calls[0].body.format.properties), ["intent"]);
  }
  {
    const f = stub({ "/api/chat": () => payload({ relevance: { pick: "C", top: [["C", 0.5], ["D", 0.3], ["B", 0.2]] } }) });
    const [r] = await decide({ state: "s", questions: [{ id: "relevance", type: "score", levels: [0, 1, 2, 3] }] }, { model: "stub", fetchImpl: f });
    assert.equal(r.answer, 2);
    near(r.expected, 0.2 * 1 + 0.5 * 2 + 0.3 * 3);
    assert.equal(r.type, "score");
  }
  {
    const f = stub({ "/api/chat": () => payload({ intent: { pick: "A", top: [["A", 0.6], ["B", 0.3], ["C", 0.1]] } }) });
    const [r] = await decide({ state: "s", questions: [{ id: "intent", type: "choice", options: INTENTS.slice(0, 3) }] }, { model: "stub", fetchImpl: f, temperatures: { intent: 2 } });
    near(r.rawProbabilities.new_idea, 0.6);
    assert.ok(r.probabilities.new_idea < 0.6 && r.probabilities.note_for_existing > 0.1);
    assert.equal(r.temperature, 2);
    near(temper([0.6, 0.3, 0.1], 1)[0], 0.6);
    near(temper([0.5, 0.5], 3)[0], 0.5);
  }
  {
    const f = stub({ "/api/chat": () => ({ model: "old", message: { content: '{"intent":"B"}' }, done: true, prompt_eval_count: 5, eval_count: 3 }) });
    const [r] = await decide({ state: "s", questions: [{ id: "intent", type: "choice", options: INTENTS }] }, { model: "old", fetchImpl: f });
    assert.equal(r.answer, "new_problem");
    assert.equal(r.probabilities, null);
    assert.equal(r.confidence, null);
    assert.equal(r.logprobs, false);
  }
  {
    const f = stub({ "/api/chat": () => payload({ intent: { pick: "C", top: [["Okay", 0.9], ["First", 0.05]] } }) });
    const [r] = await decide({ state: "s", questions: [{ id: "intent", type: "choice", options: INTENTS }] }, { model: "stub", fetchImpl: f });
    assert.equal(r.logprobs, false, "no matched mass falls back to the plain answer");
    assert.equal(r.answer, "note_for_existing");
  }
  {
    const f = stub({ "/api/chat": () => payload({ intent: { pick: "A", top: [["A", 0.9]] } }) });
    await assert.rejects(decide({ state: "s", questions: [{ id: "bad id", type: "choice", options: INTENTS }] }, { model: "stub", fetchImpl: f }), /id/);
    await assert.rejects(decide({ state: "s", questions: [{ id: "x", type: "choice", options: ["only"] }] }, { model: "stub", fetchImpl: f }), /2 to 26/);
    await assert.rejects(decide({ state: "s", questions: [{ id: "x", type: "yesno" }] }, { model: "stub", fetchImpl: f }), /statement/);
    await assert.rejects(decide({ state: "s", questions: [{ id: "x", type: "yesno", statement: "s" }] }, { fetchImpl: f }), /model/);
    const down = stub({ "/api/chat": () => { throw Error("connect ECONNREFUSED"); } });
    await assert.rejects(decide({ state: "s", questions: [{ id: "x", type: "yesno", statement: "s" }] }, { model: "m", fetchImpl: down }), /ECONNREFUSED/);
  }

  {
    const rows = [
      { probabilities: { a: 1, b: 0 }, label: "a" },
      { probabilities: { a: 0.8, b: 0.2 }, label: "b" },
    ];
    const m = metrics(rows);
    near(m.accuracy, 0.5);
    near(m.brier, (0 + (0.64 + 0.64)) / 2);
    near(m.ece, 0.5 * Math.abs(1 - 1) + 0.5 * Math.abs(0.8 - 0));
  }
  {
    const rng = (() => {
      let s = 7;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    })();
    const make = (T, n) =>
      Array.from({ length: n }, () => {
        const logit = (rng() - 0.5) * 6,
          pTrue = 1 / (1 + Math.exp(-logit / T)),
          shown = 1 / (1 + Math.exp(-logit));
        return { probabilities: { yes: shown, no: 1 - shown }, label: rng() < pTrue ? "yes" : "no" };
      });
    const over = calibrate("q", make(3, 400));
    assert.ok(over.temperature > 1.8 && over.temperature < 9, "overconfident rows give T above 1: " + over.temperature);
    assert.ok(over.after.nll < over.before.nll);
    assert.ok(over.after.ece < over.before.ece);
    assert.ok(over.after.brier <= over.before.brier);
    const under = calibrate("q", make(0.4, 400));
    assert.ok(under.temperature < 0.7, "underconfident rows give T below 1: " + under.temperature);
    const saved = {};
    calibrate("q", make(3, 50), { save: (id, t) => (saved[id] = t) });
    assert.ok(saved.q > 1);
    assert.throws(() => calibrate("q", make(1, 3)), /at least 5/);
  }

  {
    near(cosine([1, 0], [1, 0]), 1);
    near(cosine([1, 0], [0, 1]), 0);
    near(cosine([1, 1], [2, 2]), 1);
    assert.equal(cosine([0, 0], [1, 1]), 0);
    const top = knn([1, 0], [{ id: "a", vector: [0, 1] }, { id: "b", vector: [0.9, 0.1] }, { id: "c", vector: [-1, 0] }, { id: "d", vector: [1, 0.2] }], 2);
    assert.deepEqual(top.map((x) => x.id), ["b", "d"]);
    assert.ok(top[0].score > top[1].score);
  }

  {
    const store = openStore(fs.mkdtempSync(path.join(os.tmpdir(), "spark-decide-")));
    const vecs = { alpha: [1, 0, 0], beta: [0, 1, 0] };
    const f = stub({
      "/api/tags": () => ({ models: [{ name: "gemma4:e4b" }, { name: "qwen3-embedding:latest" }, { name: "nomic-embed-text:latest" }] }),
      "/api/embed": (b) => ({ embeddings: b.input.map((t) => vecs[t] || [0, 0, 1]) }),
    });
    const cache = { get: (k) => store.getEmbedding(k), put: (k, m, v) => store.putEmbedding(k, m, v) };
    const one = await embed(["alpha", "beta"], { fetchImpl: f, cache });
    assert.equal(one.model, "qwen3-embedding:latest", "falls back when bge-m3 is missing");
    assert.deepEqual(one.vectors, [[1, 0, 0], [0, 1, 0]]);
    const two = await embed(["beta", "gamma"], { fetchImpl: f, cache });
    assert.deepEqual(f.calls.filter((c) => c.path === "/api/embed").at(-1).body.input, ["gamma"], "cached texts are not re-sent");
    assert.deepEqual(two.vectors, [[0, 1, 0], [0, 0, 1]]);
    const three = await embed(["alpha"], { fetchImpl: f, cache, model: "bge-m3" });
    assert.equal(three.model, "bge-m3");
    assert.equal(f.calls.filter((c) => c.path === "/api/embed").length, 3, "the cache is keyed by model");
    const preferred = stub({ "/api/tags": () => ({ models: [{ name: "bge-m3:latest" }, { name: "nomic-embed-text:latest" }] }), "/api/embed": (b) => ({ embeddings: b.input.map(() => [1]) }) });
    assert.equal((await embed(["x"], { fetchImpl: preferred })).model, "bge-m3:latest");
    const none = stub({ "/api/tags": () => ({ models: [{ name: "gemma4:e4b" }] }) });
    await assert.rejects(embed(["x"], { fetchImpl: none }), /ollama pull bge-m3/);
    assert.equal(store.getEmbedding("missing"), null);
    const archive = JSON.stringify(store.archive());
    assert.ok(!/embedding|vector/i.test(Object.keys(JSON.parse(archive)).join(",")), "embeddings are not exported");
    validateArchive(JSON.parse(archive));
    store.close();
  }

  {
    const settings = { model: "m1", threshold: 0.7, temperatures: { intent: 2 } };
    const f = stub({ "/api/chat": () => payload({ intent: { pick: "A", top: [["A", 0.9], ["B", 0.1]] } }) });
    const engine = createEngine({ settings: () => settings, fetchImpl: f });
    assert.equal(engine.model(), "m1");
    assert.equal(engine.threshold(), 0.7);
    const [r] = await engine.decide({ state: "s", questions: [{ id: "intent", type: "choice", options: INTENTS.slice(0, 2) }] });
    assert.equal(f.calls[0].body.model, "m1");
    assert.equal(r.temperature, 2);
  }
  {
    const f = stub({ "/api/chat": () => payload({ intent: { pick: "A", top: [["A", 0.9], ["B", 0.1]] } }), "/api/tags": () => ({ models: [{ name: "x-cloud" }, { name: "big:cloud" }, { name: "remote:1b", remote_host: "https://ollama.com" }, { name: "nomic-embed-text:latest" }] }), "/api/embed": (b) => ({ embeddings: b.input.map(() => [1]) }) });
    const q = [{ id: "intent", type: "choice", options: INTENTS.slice(0, 2) }];
    for (const model of ["gpt-oss:120b-cloud", "qwen3:cloud", "X:Cloud"]) await assert.rejects(decide({ state: "s", questions: q }, { model, fetchImpl: f }), /local models/);
    for (const baseUrl of ["https://ollama.com", "http://127.0.0.1.evil.com:11434", "http://evil.com", "http://user:pw@127.0.0.1:11434", "not a url"])
      await assert.rejects(decide({ state: "s", questions: q }, { model: "m1", baseUrl, fetchImpl: f }), /this computer|invalid/);
    await assert.rejects(embed(["x"], { model: "big:cloud", fetchImpl: f }), /local models/);
    await assert.rejects(embed(["x"], { baseUrl: "https://ollama.com", fetchImpl: f }), /this computer/);
    assert.equal((await embed(["x"], { fetchImpl: f })).model, "nomic-embed-text:latest", "cloud and remote models are never picked");
    assert.equal(f.calls.filter((c) => c.path === "/api/chat").length, 0);
    await decide({ state: "s", questions: q }, { model: "m1", baseUrl: "http://localhost:11434", fetchImpl: f });
  }
  console.log("decide tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
