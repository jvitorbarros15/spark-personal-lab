"use strict";
// Compares the local decision engine with the old planner JSON on labelled captures and paper relevance cases.
// Not part of npm test. Usage: node decide-eval.cjs [--models qwen3:4b,gemma4:e4b] [--out dir] [--skip-planner]
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const { decide, embed, cosine, calibrate, metrics } = require("./decide.cjs");
const { PLAN_SYSTEM, INTENT_OPTIONS, FORM_SCHEMA } = require("./assistant.cjs");
const { SCREEN_SYSTEM, SCREEN_SCHEMA, RELEVANCE } = require("./research.cjs");
const { providerManager } = require("./providers.cjs");
const { FRAME, PAPERS, SEEDS, CAPTURES, ATTACH_PAIRS } = require("./decide-eval-data.cjs");

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
  const models = arg("models", "qwen3:4b,gemma4:e4b").split(","),
    outDir = arg("out", path.join(os.tmpdir(), "spark-decide-eval")),
    embedModel = arg("embed", "bge-m3");
  fs.mkdirSync(outDir, { recursive: true });
  const all = [];
  for (const model of models) {
    stop(model);
    process.stderr.write(`== ${model}\n`);
    await decide({ state: "warm up", questions: [{ id: "w", type: "yesno", statement: "This is a test." }] }, { model });
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
