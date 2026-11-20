"use strict";
// Compares the local decision engine with the old planner JSON on labelled captures and paper relevance cases.
// Not part of npm test. Usage: node decide-eval.cjs [--models gemma4:e4b] [--out dir] [--skip-planner] [--type-only] [--split] [--bench]
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const { decide, embed, cosine, calibrate, metrics } = require("./decide.cjs");
const { PLAN_SYSTEM, FORM_SCHEMA } = require("./assistant.cjs");
const INTENT_OPTIONS = [
  { value: "new_idea", label: "new_idea", hint: "a fresh idea to build, try or research" },
  { value: "new_problem", label: "new_problem", hint: "a problem or pain the owner observed" },
  { value: "note_for_existing", label: "note_for_existing", hint: "extra information about something they already track" },
  { value: "question", label: "question", hint: "the owner asks something" },
  { value: "task", label: "task", hint: "something to do, a reminder or an errand" },
];
const { SCREEN_SYSTEM, SCREEN_SCHEMA, RELEVANCE } = require("./research.cjs");
const { providerManager } = require("./providers.cjs");
const { FRAME, PAPERS, SEEDS, CAPTURES, ATTACH_PAIRS, TYPE_CAPTURES } = require("./decide-eval-data.cjs");
const { typeQuestion, multiQuestion, multiP, partState, splitCapture, summarize: summarizeType } = require("./classify.cjs");

const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d;
};
const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const stop = (m) => {
  try {
    execFileSync("ollama", ["stop", m], { stdio: "ignore" });
  } catch {}
};
const frameText = (f) => `Question: ${f.question}\nContribution: ${f.contribution}\nMethod: ${f.method}\nPopulation or dataset: ${f.population}`;
const paperState = (p) => `${frameText(FRAME)}\n\nPAPER: ${p.title}\n${p.abstract ? "Abstract: " + p.abstract : "Abstract: none (title only)"}`;
const seedIds = Object.fromEntries(Object.keys(SEEDS).map((k, i) => [k, "R0" + (i + 1)]));
const indexText = Object.entries(SEEDS).map(([k, s]) => `${seedIds[k]} | ${s.type} | ${s.title}`).join("\n");

const rowsOf = (results, labelOf) => results.filter((r) => r.probabilities).map((r) => ({ probabilities: r.rawProbabilities, label: labelOf(r) }));
const cross = (rows, id) => {
  const a = rows.filter((_, i) => i % 2 === 0),
    b = rows.filter((_, i) => i % 2 === 1),
    ta = calibrate(id, a).temperature,
    tb = calibrate(id, b).temperature;
  const apply = (rs, T) => rs.map((r) => ({ ...r, probabilities: Object.fromEntries(Object.entries(r.probabilities).map(([k, v]) => [k, Math.pow(Math.max(v, 1e-12), 1 / T)])) })).map((r) => {
    const s = Object.values(r.probabilities).reduce((x, y) => x + y, 0);
    return { ...r, probabilities: Object.fromEntries(Object.entries(r.probabilities).map(([k, v]) => [k, v / s])) };
  });
  const full = calibrate(id, rows);
  return { temperature: full.temperature, before: metrics(rows), afterInSample: full.after, afterCrossFit: metrics([...apply(b, ta), ...apply(a, tb)]) };
};
const auc = (scores, labels) => {
  let win = 0,
    n = 0;
  for (let i = 0; i < scores.length; i++)
    for (let j = 0; j < scores.length; j++)
      if (labels[i] && !labels[j]) {
        n++;
        win += scores[i] > scores[j] ? 1 : scores[i] === scores[j] ? 0.5 : 0;
      }
  return win / n;
};
const sweep = (results, thresholds) =>
  thresholds.map((t) => {
    const kept = results.filter((r) => r.confidence >= t);
    return { threshold: t, answered: kept.length, abstained: results.length - kept.length, accuracyOfAnswered: kept.length ? kept.filter((r) => r.ok).length / kept.length : null };
  });

async function engineIntent(model) {
  const out = [];
  for (const c of CAPTURES) {
    const [r] = await decide({ state: c.body, questions: [{ id: "intent", type: "choice", prompt: "What kind of capture is this?", options: INTENT_OPTIONS }] }, { model });
    out.push({ ...r, id: c.id, expect: c.intent, ok: r.answer === c.intent });
  }
  return out;
}

async function engineAttach(model, embedModel) {
  const out = [];
  for (const [cid, seed, expect] of ATTACH_PAIRS) {
    const c = CAPTURES.find((x) => x.id === cid),
      s = SEEDS[seed],
      entry = `${s.title}\n${s.body}`;
    const [r] = await decide({ state: `CAPTURE:\n${c.body}\n\nENTRY:\n${entry}`, questions: [{ id: "attach", type: "yesno", statement: `This capture is about the entry "${s.title}"` }] }, { model });
    const { vectors } = await embed([c.body, entry], { model: embedModel });
    out.push({ pair: `${cid}/${seed}`, expect, yes: r.yes, answer: r.answer, cosine: cosine(vectors[0], vectors[1]), ms: r.latencyMs, ok: (r.answer === "yes") === expect, probabilities: r.probabilities, rawProbabilities: r.rawProbabilities, confidence: r.confidence });
  }
  return out;
}

async function enginePapers(model, embedModel) {
  const { vectors } = await embed([frameText(FRAME), ...PAPERS.map((p) => `${p.title}. ${p.abstract || ""}`)], { model: embedModel });
  const out = [];
  for (const [i, p] of PAPERS.entries()) {
    const [r] = await decide({ state: paperState(p), questions: [RELEVANCE] }, { model });
    out.push({ ...r, id: p.id, expect: p.label, ok: r.answer === p.label, cosine: cosine(vectors[0], vectors[i + 1]) });
  }
  return out;
}


// Capture type classification: single captures are scored on the type question, multi-topic captures on each part plus the multi gate.
async function typeEval(model) {
  const T = { type: 2 };
  const singles = TYPE_CAPTURES.filter((c) => c.type !== "multi"),
    multis = TYPE_CAPTURES.filter((c) => c.type === "multi"),
    rows = [];
  for (const c of singles) {
    const [r] = await decide({ state: c.body, questions: [typeQuestion()] }, { model, temperatures: T }),
      [g] = await decide({ state: c.body, questions: [multiQuestion()] }, { model });
    rows.push({ id: c.id, expect: c.type, answer: r.answer, confidence: r.confidence, probabilities: r.probabilities, raw: r.rawProbabilities, ms: r.latencyMs, gateYes: multiP(g), ok: r.answer === c.type, uncertain: summarizeType(r, 0.6).uncertain, hard: !!c.hard });
  }
  const parts = [],
    gates = [];
  for (const c of multis) {
    const [g] = await decide({ state: c.body, questions: [multiQuestion()] }, { model });
    gates.push({ id: c.id, yes: multiP(g) });
    for (const p of c.parts) {
      const [r] = await decide({ state: partState(c.body, p.text), questions: [typeQuestion()] }, { model, temperatures: T });
      parts.push({ id: c.id, expect: p.type, answer: r.answer, confidence: r.confidence, probabilities: r.probabilities, raw: r.rawProbabilities, ms: r.latencyMs, ok: r.answer === p.type });
    }
  }
  const all = [...rows, ...parts],
    types = [...new Set(all.map((r) => r.expect))],
    perType = Object.fromEntries(types.map((t) => [t, (() => { const x = all.filter((r) => r.expect === t); return { n: x.length, accuracy: x.filter((r) => r.ok).length / x.length }; })()])),
    confusion = {};
  for (const r of all.filter((x) => !x.ok)) confusion[r.expect + " -> " + r.answer] = (confusion[r.expect + " -> " + r.answer] || 0) + 1;
  const bins = [[0, 0.5], [0.5, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 0.95], [0.95, 1.01]].map(([lo, hi]) => {
    const x = all.filter((r) => r.confidence >= lo && r.confidence < hi);
    return { range: lo + "-" + Math.min(1, hi), n: x.length, meanConfidence: x.length ? x.reduce((a, r) => a + r.confidence, 0) / x.length : null, accuracy: x.length ? x.filter((r) => r.ok).length / x.length : null };
  });
  const mk = (list) => list.map((r) => ({ probabilities: r.raw, label: r.expect })),
    shipped = all.map((r) => ({ probabilities: r.probabilities, label: r.expect }));
  const uncertain = singles.length ? rows.filter((r) => r.uncertain) : [];
  return {
    singles: { n: rows.length, accuracy: rows.filter((r) => r.ok).length / rows.length },
    parts: { n: parts.length, accuracy: parts.filter((r) => r.ok).length / parts.length },
    overall: { n: all.length, accuracy: all.filter((r) => r.ok).length / all.length, calibration: metrics(shipped), calibrationRaw: metrics(mk(all)), calibrationFit: all.length >= 10 ? cross(mk(all), "type") : null },
    perType,
    confusion,
    reliability: bins,
    hard: (() => { const x = rows.filter((r) => r.hard); return { n: x.length, accuracy: x.filter((r) => r.ok).length / x.length, askedOrWrong: x.filter((r) => r.uncertain || !r.ok).length }; })(),
    askedRate: uncertain.length / rows.length,
    answeredAccuracy: (() => { const x = rows.filter((r) => !r.uncertain); return x.length ? x.filter((r) => r.ok).length / x.length : null; })(),
    latencyMs: { median: median(all.map((r) => r.ms)), max: Math.max(...all.map((r) => r.ms)) },
    rawMs: all.map((r) => r.ms),
    multiGate: { yesOnMulti: gates.map((g) => g.id + ":" + g.yes?.toFixed(2)), meanYesSingles: rows.reduce((a, r) => a + (r.gateYes || 0), 0) / rows.length, singlesAbove70: rows.filter((r) => (r.gateYes || 0) >= 0.7).map((r) => r.id), multisAbove70: gates.filter((g) => (g.yes || 0) >= 0.7).length + "/" + gates.length },
    wrong: all.filter((r) => !r.ok).map((r) => r.id + ": " + r.expect + " -> " + r.answer + " (" + r.confidence.toFixed(2) + ")"),
  };
}

// Sentence-level split: every labelled capture goes through splitCapture without the gate, then the gate is read separately
// so both the splitter alone and splitter plus gate can be scored. Multi captures must yield their parts' types in order.
const EXAMPLE = { id: "EX", type: "multi", body: "Students forget deadlines, that's a real problem. An app that texts reminders could fix it. I could test it with 10 friends for two weeks.", parts: [{ type: "problem" }, { type: "idea" }, { type: "experiment" }] };
// Multi-sentence captures that stay on one topic: the splitter must leave them whole.
const LONG_SINGLES = [
  { id: "L01", type: "idea", body: "An app that texts students reminders before deadlines. It would read the syllabus and pull the dates out by itself. Students would only have to confirm them once." },
  { id: "L02", type: "problem", body: "Our onboarding takes three weeks. New hires wait days for laptop access. Half of them ask the same questions in the first week." },
  { id: "L03", type: "idea", body: "Uma ideia: um app que lembra os alunos dos prazos. Ele leria o plano de ensino e extrairia as datas. O aluno só precisaria confirmar uma vez." },
  { id: "L04", type: "competitor", body: "Notion charges ten dollars per seat. Its offline mode is weak. Mobile search is slow compared to Obsidian." },
  { id: "L05", type: "problem", body: "O problema é que ninguém lê os relatórios semanais. Eles são longos demais. A equipe acaba decidindo no improviso." },
  { id: "L06", type: "experiment", body: "Run the signup page with two headlines for a week. Send half the traffic to each. Compare the conversion rate at the end." },
  { id: "L07", type: "technology", body: "Whisper large-v3 handles accents much better than v2. It runs on CPU but slowly. The quantised build cuts memory by half." },
  { id: "L08", type: "note", body: "Read the paper on retrieval augmented generation. Also look up how chunk size affects recall. Then write down three takeaways." },
  { id: "L09", type: "idea", body: "What if a bakery sold a subscription box of day-old bread? Customers would pick up on Saturdays. It would cut waste and bring regulars in." },
  { id: "L10", type: "problem", body: "Students forget deadlines all the time, and then they panic. They miss submission windows and lose marks. It happens every single term." },
];
async function splitEval(model) {
  const T = { type: 2 },
    engine = { decide: (i) => decide(i, { model, temperatures: T }) },
    rows = [];
  for (const c of [...TYPE_CAPTURES, ...LONG_SINGLES, EXAMPLE]) {
    const began = Date.now(),
      r = (await splitCapture(engine, c.body, {})) || { split: false, reason: "one sentence" },
      ms = Date.now() - began;
    let gateYes = null;
    if (r.split) gateYes = multiP((await engine.decide({ state: c.body, questions: [multiQuestion()] }))[0]);
    const got = r.split ? r.parts.map((p) => p.classification.type) : [c.type === "multi" ? "-" : c.type];
    const want = c.type === "multi" ? c.parts.map((p) => p.type) : null;
    rows.push({ id: c.id, multi: c.type === "multi", sentences: r.sentences ?? 1, candidateSplit: !!r.split, gateYes, got, want, typesOk: !!want && r.split && JSON.stringify(got) === JSON.stringify(want), ms, reason: r.reason || "" });
  }
  const multis = rows.filter((r) => r.multi),
    singles = rows.filter((r) => !r.multi),
    gate = (r) => r.candidateSplit && (r.gateYes ?? 0) >= 0.7;
  return {
    multis: { n: multis.length, splitterOnly: multis.filter((r) => r.candidateSplit).length, withGate: multis.filter(gate).length, typesExact: multis.filter((r) => r.typesOk).length, typesExactWithGate: multis.filter((r) => r.typesOk && gate(r)).length },
    singles: { n: singles.length, falseSplitsSplitterOnly: singles.filter((r) => r.candidateSplit).map((r) => r.id), falseSplitsWithGate: singles.filter(gate).map((r) => r.id) },
    latencyMs: { medianSingleSentence: median(singles.filter((r) => r.sentences < 2).map((r) => r.ms)), medianMultiSentence: median(rows.filter((r) => r.sentences >= 2).map((r) => r.ms)), medianThreeSentence: median(rows.filter((r) => r.sentences === 3).map((r) => r.ms)), maxMs: Math.max(...rows.map((r) => r.ms)) },
    rows,
  };
}


const pct = (xs, q) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : null;
};
const vramMiB = () => {
  try {
    return Number(execFileSync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8" }).trim().split(" ")[0]);
  } catch {
    return null;
  }
};

// One compact row per model: type accuracy, split counts, paper AUC, ECE, asked share, latency and VRAM, all from the same decide() calls.
async function benchEval(model) {
  const idle = vramMiB(),
    began = Date.now();
  await decide({ state: "warm up", questions: [{ id: "w", type: "yesno", statement: "This is a test." }] }, { model });
  const coldMs = Date.now() - began,
    loaded = vramMiB();
  const t = await typeEval(model),
    sp = await splitEval(model),
    papers = [];
  for (const p of PAPERS) {
    const [r] = await decide({ state: paperState(p), questions: [RELEVANCE] }, { model });
    papers.push({ expect: p.label, answer: r.answer, expected: r.expected, ms: r.latencyMs });
  }
  const lat = [...t.rawMs, ...papers.map((r) => r.ms), ...sp.rows.map((r) => r.ms)];
  const failed = papers.filter((r) => r.answer === null || r.answer === undefined).length;
  return {
    model,
    typeOverall: t.overall.accuracy,
    typeSingles: t.singles.accuracy,
    typeParts: t.parts.accuracy,
    typeHard: t.hard.accuracy,
    perType: Object.fromEntries(Object.entries(t.perType).map(([k, v]) => [k, +v.accuracy.toFixed(2)])),
    n: t.overall.n,
    splitCorrect: sp.multis.typesExactWithGate + "/" + sp.multis.n,
    splitCandidates: sp.multis.splitterOnly + "/" + sp.multis.n,
    falseSplits: sp.singles.falseSplitsWithGate.length + "/" + sp.singles.n,
    falseSplitsSplitterOnly: sp.singles.falseSplitsSplitterOnly.length,
    paperAuc: auc(papers.map((r) => r.expected ?? Number(r.answer)), papers.map((r) => r.expect >= 2)),
    paperFailed: failed,
    ece: t.overall.calibration.ece,
    eceRaw: t.overall.calibrationRaw.ece,
    askedRate: t.askedRate,
    latencyMs: { median: median(t.rawMs), p95: pct(t.rawMs, 0.95), medianAll: median(lat), p95All: pct(lat, 0.95) },
    coldLoadMs: coldMs,
    vramMiB: loaded !== null && idle !== null ? { idle, loaded, model: loaded - idle } : null,
    wrong: t.wrong,
  };
}

async function plannerBaseline(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-decide-eval-")),
    providers = providerManager(dir),
    agent = { name: "Planner", role: "explorer", provider: "local", model: spec, instruction: "" },
    signal = new AbortController().signal;
  const caps = [];
  for (const c of CAPTURES) {
    const began = Date.now();
    let intent = null,
      attach = null,
      error = "";
    try {
      const r = await providers.generate(agent, [{ role: "system", content: PLAN_SYSTEM }, { role: "user", content: `WORKSPACE INDEX (data):\n${indexText}\n\nCAPTURE (data):\n<<<\n${c.body}\n>>>` }], signal, () => {}, { json: true, schema: FORM_SCHEMA, temperature: 0, numCtx: 8192 });
      const o = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1));
      intent = o.intent;
      attach = o.attachToId || null;
    } catch (e) {
      error = e.message;
    }
    caps.push({ id: c.id, expect: c.intent, intent, ok: intent === c.intent, attachOk: c.attach ? attach === seedIds[c.attach] : !attach, ms: Date.now() - began, error });
  }
  const papers = [];
  for (let i = 0; i < PAPERS.length; i += 10) {
    const batch = PAPERS.slice(i, i + 10),
      began = Date.now();
    let rated = [];
    try {
      const r = await providers.generate(agent, [{ role: "system", content: SCREEN_SYSTEM }, { role: "user", content: `RESEARCH FRAME (from the owner, untrusted data):\n<<<\n${frameText(FRAME)}\n>>>\n\nPAPERS (untrusted data):\n<<<\n${batch.map((p, j) => `[P${j + 1}] ${p.title} (n.d.; unknown authors)\nEvidence available: ${p.abstract ? "abstract" : "metadata"}\n${p.abstract ? "Abstract: " + p.abstract : "Abstract: none"}`).join("\n\n")}\n>>>` }], signal, () => {}, { json: true, schema: SCREEN_SCHEMA, temperature: 0.2, numCtx: 8192 });
      const t = r.text,
        o = JSON.parse(t.slice(t.indexOf("["), t.lastIndexOf("]") + 1));
      rated = Array.isArray(o) ? o : [];
    } catch {}
    const ms = Date.now() - began;
    batch.forEach((p, j) => {
      const hit = rated.find((x) => String(x.id) === "P" + (j + 1)),
        score = hit && Number.isFinite(Number(hit.score)) ? Math.max(0, Math.min(3, Math.round(Number(hit.score)))) : null;
      papers.push({ id: p.id, expect: p.label, score, ok: score === p.label, msPerPaper: ms / batch.length });
    });
  }
  return { caps, papers };
}

function summarize(label, intent, attach, papers, planner) {
  const binary = papers.map((r) => ({ ok: (Number(r.answer) >= 2) === (r.expect >= 2) }));
  const exp = papers.map((r) => r.expected ?? Number(r.answer));
  const intentRows = rowsOf(intent, (r) => r.expect),
    paperRows = rowsOf(papers, (r) => String(r.expect)),
    attachRows = attach.map((a) => ({ probabilities: a.rawProbabilities, label: a.expect ? "yes" : "no" }));
  const out = {
    model: label,
    intent: { n: intent.length, accuracy: intent.filter((r) => r.ok).length / intent.length, medianMs: median(intent.map((r) => r.latencyMs)), coverageMin: Math.min(...intent.map((r) => r.coverage)), calibration: cross(intentRows, "intent"), sweep: sweep(intent, [0.5, 0.6, 0.7, 0.8, 0.9]), wrong: intent.filter((r) => !r.ok).map((r) => `${r.id}: ${r.expect} -> ${r.answer} (${r.confidence.toFixed(2)})`) },
    attach: { n: attach.length, accuracy: attach.filter((r) => r.ok).length / attach.length, cosineAuc: auc(attach.map((r) => r.cosine), attach.map((r) => r.expect)), yesAuc: auc(attach.map((r) => r.yes), attach.map((r) => r.expect)), medianMs: median(attach.map((r) => r.ms)), pairs: attach.map((r) => `${r.pair} want=${r.expect} yes=${r.yes?.toFixed(2)} cos=${r.cosine.toFixed(2)}`) },
    papers: {
      n: papers.length,
      accuracy4: papers.filter((r) => r.ok).length / papers.length,
      accuracyRelevant: binary.filter((r) => r.ok).length / binary.length,
      offTopicAsRelevant: papers.filter((r) => r.expect === 0 && Number(r.answer) >= 2).length,
      medianMs: median(papers.map((r) => r.latencyMs)),
      expectedAuc: auc(exp, papers.map((r) => r.expect >= 2)),
      cosineAuc: auc(papers.map((r) => r.cosine), papers.map((r) => r.expect >= 2)),
      calibration: cross(paperRows, "relevance"),
      wrong: papers.filter((r) => !r.ok).map((r) => `${r.id}: ${r.expect} -> ${r.answer} (${r.confidence?.toFixed(2)}, cos ${r.cosine.toFixed(2)})`),
    },
  };
  if (planner)
    out.planner = {
      intentAccuracy: planner.caps.filter((r) => r.ok).length / planner.caps.length,
      attachCorrect: planner.caps.filter((r) => r.attachOk).length,
      medianMs: median(planner.caps.map((r) => r.ms)),
      paperAccuracy4: planner.papers.filter((r) => r.ok).length / planner.papers.length,
      paperAccuracyRelevant: planner.papers.filter((r) => r.score !== null && (r.score >= 2) === (r.expect >= 2)).length / planner.papers.length,
      offTopicAsRelevant: planner.papers.filter((r) => r.expect === 0 && r.score >= 2).length,
      unparsed: planner.papers.filter((r) => r.score === null).length,
      medianMsPerPaper: median(planner.papers.map((r) => r.msPerPaper)),
    };
  return out;
}

async function main() {
  const models = arg("models", "gemma4:e4b").split(","),
    outDir = arg("out", path.join(os.tmpdir(), "spark-decide-eval")),
    embedModel = arg("embed", "bge-m3");
  fs.mkdirSync(outDir, { recursive: true });
  const all = [];
  for (const model of models) {
    stop(model);
    process.stderr.write(`== ${model}\n`);
    if (process.argv.includes("--bench")) {
      let b;
      try {
        b = await benchEval(model);
      } catch (e) {
        b = { model, error: e.message };
      }
      fs.writeFileSync(path.join(outDir, "bench-" + model.replace(/[^\w.-]+/g, "_") + ".json"), JSON.stringify(b, null, 2));
      console.log(JSON.stringify(b));
      stop(model);
      continue;
    }
    await decide({ state: "warm up", questions: [{ id: "w", type: "yesno", statement: "This is a test." }] }, { model });
    if (process.argv.includes("--split")) {
      const t = await splitEval(model);
      fs.writeFileSync(path.join(outDir, "split-" + model.replace(/[^\w.-]+/g, "_") + ".json"), JSON.stringify(t, null, 2));
      console.log(JSON.stringify(t, null, 2));
      stop(model);
      continue;
    }
    if (process.argv.includes("--type-only")) {
      const t = await typeEval(model);
      fs.writeFileSync(path.join(outDir, "type-" + model.replace(/[^\w.-]+/g, "_") + ".json"), JSON.stringify(t, null, 2));
      console.log(JSON.stringify(t, null, 2));
      stop(model);
      continue;
    }
    const intent = await engineIntent(model),
      attach = await engineAttach(model, embedModel),
      papers = await enginePapers(model, embedModel),
      planner = process.argv.includes("--skip-planner") ? null : await plannerBaseline(model);
    const s = summarize(model, intent, attach, papers, planner);
    all.push(s);
    fs.writeFileSync(path.join(outDir, model.replace(/[^\w.-]+/g, "_") + ".json"), JSON.stringify({ summary: s, intent, attach, papers, planner }, null, 2));
    console.log(JSON.stringify(s, null, 2));
    stop(model);
  }
  stop(embedModel);
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(all, null, 2));
  console.log("Wrote " + outDir);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
