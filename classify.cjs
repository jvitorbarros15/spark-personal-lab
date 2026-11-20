"use strict";
const crypto = require("node:crypto");

const MIN_COVERAGE = 0.5,
  MARGIN = 0.15,
  MAX_SHOTS = 8,
  KEEP_CORRECTIONS = 200;

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

CLASSIFY ONLY THIS PART (if it only describes the product or company the whole capture is about, with 'it' or 'its', file it as that product, not as a problem):
${clip(part, 600)}`;

async function classifyType(engine, text, { threshold = 0.6, corrections = [] } = {}) {
  const [result] = await engine.decide({ state: text, questions: [typeQuestion(relevantCorrections(corrections, text))] });
  return summarize(result, threshold);
}

const MAX_PARTS = 3,
  MAX_SENTENCES = 5,
  MIN_WORDS = 3;
const CONNECTOR = /(?:,|;)?\s+(?=(?:and then|and also|but also|also|so then|then|e depois|e então|e também|também|então|além disso)\s)|,\s+(?=(?:and|e|so)\s)/i;
const words = (v) => (v.match(/[\p{L}\p{N}']+/gu) || []).length;

// Cuts a capture into candidate sentences at end punctuation, semicolons and spoken connectors. Fragments of fewer than
// three words ("uh so") are glued onto the next piece so no text is lost.
function sentences(text) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim()
    .split(/(?<=[.!?;])\s+(?=\S)/u)
    .flatMap((s) => s.split(CONNECTOR))
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  let carry = "";
  for (const piece of raw) {
    const joined = carry ? carry + " " + piece : piece;
    if (words(joined) < MIN_WORDS) carry = joined;
    else {
      out.push(joined);
      carry = "";
    }
  }
  if (carry) out.length ? (out[out.length - 1] += " " + carry) : out.push(carry);
  return out;
}

const partTitle = (t) => {
  const one = clip(t.replace(/^(?:uh|um|so|and|also|then|e|mas|também|então)[,\s]+/i, ""), 300);
  return one.length > 80 ? one.slice(0, 79).replace(/\s+\S*$/, "") + "…" : one;
};

// Folds the weakest part into its neighbour until at most MAX_PARTS remain, then joins neighbours of the same type.
function mergeParts(parts) {
  const join = (a, b) => ({ ...(a.classification.p >= b.classification.p ? a : b), text: a.text + " " + b.text });
  let list = parts;
  for (;;) {
    const merged = [];
    for (const p of list) {
      const last = merged[merged.length - 1];
      if (last && last.classification.type === p.classification.type) merged[merged.length - 1] = join(last, p);
      else merged.push(p);
    }
    list = merged;
    if (list.length <= MAX_PARTS) return list;
    let weak = 0;
    list.forEach((p, i) => {
      if (p.classification.p < list[weak].classification.p) weak = i;
    });
    const into = weak === 0 ? 1 : weak - 1;
    const [lo, hi] = into < weak ? [into, weak] : [weak, into];
    list = [...list.slice(0, lo), { ...list[into], text: list[lo].text + " " + list[hi].text }, ...list.slice(hi + 1)];
  }
}

// Sentence-level split. Each candidate sentence is typed on its own with the whole capture as context. A capture is split
// only when at least two different types each reach the threshold. The "several items" gate was dropped: with gemma4:e4b it
// passed 3 of 7 real multi-topic captures, so it blocked splits the sentence classifier got right.
// Sentences the engine is unsure about are folded into the part next to them, never dropped.
async function splitCapture(engine, text, { threshold = 0.6, corrections = [] } = {}) {
  const sents = sentences(text);
  if (sents.length < 2) return null;
  if (sents.length > MAX_SENTENCES) return { split: false, reason: "too long to split" };
  const typed = [];
  for (const s of sents) {
    const c = await classifyType(engine, partState(text, s), { threshold, corrections });
    if (!c) return { split: false, reason: "no probabilities" };
    typed.push({ title: partTitle(s), text: s, ...c });
  }
  const sure = typed.filter((t) => t.classification.p >= threshold && !t.uncertain);
  if (new Set(sure.map((t) => t.classification.type)).size < 2) return { split: false, reason: "fewer than two confident types", sentences: typed.length };
  const keep = typed.map((t) => (sure.includes(t) ? t : null)),
    folded = [];
  keep.forEach((t, i) => {
    if (t) return folded.push(t);
    const prev = folded[folded.length - 1],
      next = keep.slice(i + 1).find(Boolean) || null,
      src = typed[i];
    if (prev) folded[folded.length - 1] = { ...prev, text: prev.text + " " + src.text };
    else if (next) next.text = src.text + " " + next.text;
  });
  const parts = mergeParts(folded).map((p) => ({ ...p, title: partTitle(p.text) }));
  if (new Set(parts.map((p) => p.classification.type)).size < 2) return { split: false, reason: "fewer than two confident types", sentences: typed.length };
  return { split: true, parts, sentences: typed.length };
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

module.exports = { TYPE_OPTIONS, HANDLING_OPTIONS, MIN_COVERAGE, MARGIN, MAX_SHOTS, typeQuestion, handlingQuestion, multiQuestion, summarize, classifyType, splitCapture, sentences, relevantCorrections, multiP, partState, sentence, correctedClassification, recordCorrection };
