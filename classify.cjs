"use strict";
const crypto = require("node:crypto");

const MIN_COVERAGE = 0.5,
  MARGIN = 0.15,
  MAX_SHOTS = 8,
  KEEP_CORRECTIONS = 200,
  MULTI_YES = 0.7;

// Each hint is a short definition plus two examples. They are what the model reads, so the probabilities are only as good as these lines.
const TYPE_OPTIONS = [
  { value: "idea", label: "idea", hint: "something the owner could build or start: a product, tool, service or business, even described as a fragment. 'a mobile app that finds free parking', 'what if schools shared one tutoring pool', 'a monthly box of local cheese'" },
  { value: "problem", label: "problem", hint: "a pain, annoyance or failure that people (the owner, customers, a team) experience, with no solution proposed. 'the office coffee machine is always broken', 'I forget to reply to half my emails'" },
  { value: "experiment", label: "experiment", hint: "a concrete test to run to find out whether something is true or works: a hypothesis, trial, A/B test, pilot or prototype to measure. 'call 20 shops and count how many want it', 'try the checklist for one week and see if mistakes drop', 'show two prices to half the visitors each', 'run it on a small sample and check the results by hand'" },
  { value: "technology", label: "technology", hint: "a tool, library, model, framework or technique to know about or evaluate; facts about how it works. 'Rust has no garbage collector', 'the new ONNX runtime supports int4 weights'" },
  { value: "competitor", label: "competitor", hint: "the subject is a named company or product that already exists: what it sells, its price, features or weaknesses. Use this even when the speaker criticises it. 'Slack charges 8 dollars a user', 'Trello has no time tracking', 'Dropbox got bloated'" },
  { value: "note", label: "note", hint: "research to do, something to read or look up, a question to investigate, a fact, a meeting note, a reminder or a to-do that is none of the above. 'read up on tax rules for freelancers', 'book the dentist for Monday'" },
];
const TYPE_PROMPT = "Which kind of entry should this capture be filed as? Judge what the speaker is mainly doing, not the topic. A capture that names a pain with no fix is a problem; one that proposes something to build is an idea.";
const HANDLING_OPTIONS = [
  { value: "new", label: "new", hint: "a new thought to file as its own entry, including tasks and reminders" },
  { value: "note_for_existing", label: "adds to existing", hint: "extra information about something the owner already tracks, e.g. 'for the telescope scheduler: filter low targets first'" },
  { value: "question", label: "question", hint: "the owner asks something and wants an answer, e.g. 'does the dataset allow commercial use?'" },
];
const HANDLING_PROMPT = "How should this capture be handled?";
const MULTI_OPTIONS = [
  { value: "single", label: "one item", hint: "one thought about one thing, however long or rambling; several sentences that all develop the same point are still one item" },
  { value: "several", label: "several items", hint: "two or three different kinds of statement in a row, each worth its own entry: a problem, then a fix idea, then a test; or an idea, then a rival product" },
];

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const oneLine = (v, n) => clip(String(v ?? "").replace(/<<<|>>>/g, "").replace(/"/g, "'").replace(/\s+/g, " "), n);
const round = (p) => Math.round(p * 1000) / 1000;

function tokens(v) {
  return new Set(String(v || "").toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
}

// Most recent corrections that share words with the capture come first, then the most recent of the rest.
function relevantCorrections(list, text, cap = MAX_SHOTS) {
  const mine = tokens(text),
    recent = [...list].reverse(),
    shared = (c) => [...tokens(c.text)].some((w) => mine.has(w));
  const hits = recent.filter(shared),
    rest = recent.filter((c) => !hits.includes(c));
  return [...hits, ...rest].slice(0, cap);
}

function typeQuestion(corrections = []) {
  const shots = corrections.slice(0, MAX_SHOTS).map((c) => `- "${oneLine(c.text, 160)}" is ${c.corrected}, not ${c.predicted}`);
  return {
    id: "type",
    type: "choice",
    prompt: shots.length ? `${TYPE_PROMPT}\nThe owner corrected earlier guesses like this, so follow their way of filing:\n${shots.join("\n")}` : TYPE_PROMPT,
    options: TYPE_OPTIONS,
  };
}
const handlingQuestion = () => ({ id: "intent", type: "choice", prompt: HANDLING_PROMPT, options: HANDLING_OPTIONS });
const multiQuestion = () => ({ id: "multi", type: "choice", prompt: "Does this capture hold one item or several separate items of different kinds?", options: MULTI_OPTIONS });
const multiP = (r) => r?.probabilities?.several ?? null;

// Turns one engine result for the type question into the stored classification plus an uncertainty verdict.
function summarize(result, threshold) {
  if (!result || result.logprobs === false || !result.probabilities) return null;
  const sorted = Object.entries(result.probabilities).sort((a, b) => b[1] - a[1]),
    [[type, p], second] = sorted,
    gap = second ? p - second[1] : 1;
  const classification = {
    type,
    p: round(p),
    alternatives: sorted.slice(1, 4).filter(([, q]) => q >= 0.01).map(([t, q]) => ({ type: t, p: round(q) })),
    model: result.model || "",
  };
  const uncertain = p < threshold || (result.coverage ?? 1) < MIN_COVERAGE || gap < MARGIN;
  return { classification, uncertain, gap, latencyMs: result.latencyMs ?? null, coverage: result.coverage ?? null, distribution: Object.fromEntries(sorted.map(([t, q]) => [t, round(q)])) };
}

const partState = (whole, part) => `WHOLE CAPTURE (context only):
${clip(whole, 1500)}

CLASSIFY ONLY THIS PART:
${clip(part, 600)}`;

async function classifyType(engine, text, { threshold = 0.6, corrections = [] } = {}) {
  const [result] = await engine.decide({ state: text, questions: [typeQuestion(relevantCorrections(corrections, text))] });
  return summarize(result, threshold);
}

// Splits only when the planner proposed 2 to 3 segments, the engine agrees the capture is multi-topic,
// every segment is confidently classified and at least two different types come out.
async function classifyParts(engine, text, segments, { threshold = 0.6, corrections = [] } = {}) {
  if (!Array.isArray(segments) || segments.length < 2 || segments.length > 3) return null;
  const [gate] = await engine.decide({ state: text, questions: [multiQuestion()] });
  if (!gate || gate.logprobs === false || (multiP(gate) ?? 0) < MULTI_YES) return { split: false, multiYes: multiP(gate) };
  const parts = [];
  for (const seg of segments) {
    const c = await classifyType(engine, partState(text, seg.text), { threshold, corrections });
    if (!c || c.uncertain) return { split: false, multiYes: multiP(gate), reason: "a segment was not confident" };
    parts.push({ title: seg.title, text: seg.text, ...c });
  }
  if (new Set(parts.map((p) => p.classification.type)).size < 2) return { split: false, multiYes: multiP(gate), reason: "segments share one type" };
  return { split: true, multiYes: multiP(gate), parts };
}

const article = (t) => (/^[aeiou]/.test(t) ? "an" : "a");
const sentence = (c) => {
  const [a, b] = [{ type: c.type, p: c.p }, ...c.alternatives];
  return b ? `Is this ${article(a.type)} ${a.type} (${Math.round(a.p * 100)}%) or ${article(b.type)} ${b.type} (${Math.round(b.p * 100)}%)?` : `Is this ${article(a.type)} ${a.type}?`;
};

function correctedClassification(prior, type) {
  const old = [{ type: prior.type, p: prior.p }, ...prior.alternatives].filter((a) => a.type !== type);
  return { type, p: 1, alternatives: old.slice(0, 3), model: prior.model, corrected: true };
}

// Called when the owner changes the type of an entry the assistant classified. Keeps the labelled example local.
function recordCorrection(store, validateCorrection, prior, type) {
  const guess = prior.classification?.type;
  if (!guess || prior.classification.corrected || guess === type || type === "inbox") return false;
  store.put("corrections", validateCorrection({ id: crypto.randomUUID(), text: prior.body || prior.title, predicted: guess, corrected: type }));
  store.db.prepare(`DELETE FROM corrections WHERE rowid NOT IN (SELECT rowid FROM corrections ORDER BY rowid DESC LIMIT ${KEEP_CORRECTIONS})`).run();
  return true;
}

module.exports = { TYPE_OPTIONS, HANDLING_OPTIONS, MIN_COVERAGE, MARGIN, MAX_SHOTS, MULTI_YES, typeQuestion, handlingQuestion, multiQuestion, summarize, classifyType, classifyParts, relevantCorrections, multiP, partState, sentence, correctedClassification, recordCorrection };
