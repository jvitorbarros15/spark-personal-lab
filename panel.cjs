// Ported from founder-skill (MIT, Jake Schincariol); see licenses/founder-skill-MIT.txt.
"use strict";

const FIRST_NAMES = [
  "Maya", "Jordan", "Priya", "Marcus", "Sofia", "Ethan", "Aisha", "Liam", "Chloe", "Daniel", "Nadia", "Owen",
  "Grace", "Ravi", "Emma", "Kenji", "Zoe", "Luca", "Hana", "Noah", "Fatima", "Caleb", "Isla", "Mateo", "Leah",
  "Omar", "Ava", "Theo", "Mei", "Jonah", "Sara", "Diego", "Ruby", "Kofi", "Nora", "Felix", "Amara", "Ben", "Lina",
  "Sam", "Aria", "Julian", "Keisha", "Marco", "Ines", "Tariq", "Elena", "Hugo", "Yara", "Callum", "Rosa", "Idris",
  "Freya", "Andre", "Leila", "Mason", "Talia", "Rohan", "Esme", "Victor", "Anya", "Kai", "Beatriz", "Declan",
  "Sana", "Jasper", "Min", "Gabriel", "Olivia", "Arjun", "Clara", "Malik", "Iris", "Wes", "Noor", "Rafael", "Ivy",
  "Dev", "Maeve", "Tomas", "Celine", "Adrian", "Lucia", "Hamza", "Poppy", "Ezra", "Sienna", "Darius", "Quinn",
  "Selin", "Rhys", "Nia", "Oscar", "Tess", "Bilal", "Jade", "Luis", "Harper", "Emil", "Kira", "Pablo", "Alma",
  "Seth", "Zara", "Nico", "Farah", "Levi", "June", "Eli", "Ana", "Yusuf", "Lena", "Cole", "Mira", "Raj", "Elle",
  "Finn", "Dana", "Sol", "Ada",
];
const { STANCE_ALL } = require("./revenue.cjs");
const BUYS = ["yes", "no"];
const REASONS = ["price", "habit", "need", "trust", "quality", "convenience", "timing", "values", "other"];
const MAX_PRICE = 1e9;
const PRICE_KEYS = ["tooCheap", "bargain", "expensive", "tooExpensive"];
const I18N = require("./dist/assets/i18n.js");
const SIMULATED_NOTE = "Every buyer is played by the same model, so they share one set of biases and are not independent people. The buy rate is an upper bound, not evidence of demand: confirm the big calls with real buyers before spending.";
const ANSWER_SHAPE = `{
  "id": "<buyer id>",
  "buys": "yes" | "no",
  "confidence": 1 to 5, how sure you are of that answer (1 = a coin flip, 5 = certain),
  "purchases_first_month": how many times you would buy in the first month (0 if you would not buy),
  "reason_code": one of ${REASONS.join(" / ")},
  "reason": "why, in one or two sentences, in your own voice",
  "objection": "the doubt that weighs most for you, in your own words",
  "wouldFlipIf": "the one thing that would change this answer, or empty",
  "prices": { "tooCheap": the price at which it would seem too cheap to be any good, "bargain": the price at which it would feel like a bargain, "expensive": the price at which it starts to feel expensive but you might still buy, "tooExpensive": the price at which you would not buy it at all (all numbers) }
}`;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function validateCustomer(c) {
  if (!c || typeof c !== "object") throw new Error("customer profile must be an object");
  for (const k of ["business", "target", "segments", "behaviours", "objections"]) {
    const v = c[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) {
      throw new Error(`customer.json needs '${k}'`);
    }
  }
  for (const k of ["segments", "behaviours", "objections"]) {
    if (!Array.isArray(c[k])) throw new Error(`customer.json '${k}' must be a list`);
  }
  for (const s of c.segments) {
    if (!s || s.name === undefined || !Array.isArray(s.income) || s.income.length !== 2) {
      throw new Error("every segment needs a name and an income [low, high]");
    }
  }
  for (const b of c.behaviours) {
    if (!b || b.name === undefined) throw new Error("every behaviour needs a name");
  }
}

function quota(items, n) {
  const shares = items.map((it) => Number(it.share ?? 1));
  const total = shares.reduce((a, b) => a + b, 0);
  if (!(total > 0) || shares.some((s) => !(Number.isFinite(s) && s >= 0))) {
    throw new Error("shares must be numbers of at least 0 that add up to more than 0");
  }
  const raw = shares.map((s) => (n * s) / total);
  const counts = raw.map(Math.trunc);
  const order = raw.map((_, i) => i).sort((i, j) => (raw[j] - counts[j]) - (raw[i] - counts[i]));
  const left = n - counts.reduce((a, b) => a + b, 0);
  for (const i of order.slice(0, left)) counts[i]++;
  return counts;
}

function dealPersonas(customer, { n = 20, seed = 7 } = {}) {
  validateCustomer(customer);
  if (!Number.isInteger(n) || n < 1) throw new Error("n must be a whole number of at least 1");
  if (!Number.isInteger(seed)) throw new Error("seed must be a whole number");
  const rng = mulberry32(seed);
  const pick = (xs) => xs[Math.floor(rng() * xs.length)];
  const shuffle = (xs) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  const expand = (items) => {
    const counts = quota(items, n);
    return items.flatMap((it, i) => Array(counts[i]).fill(it));
  };
  const [ageLo, ageHi] = customer.age ?? [25, 45];
  const segs = shuffle(expand(customer.segments));
  const behs = shuffle(expand(customer.behaviours));
  const names = shuffle(FIRST_NAMES.slice());
  while (names.length < n) {
    const k = Math.floor(names.length / FIRST_NAMES.length) + 1;
    names.push(...FIRST_NAMES.map((x) => `${x} ${k}`));
  }
  const habits = customer.habits ?? [];
  return Array.from({ length: n }, (_, i) => {
    const s = segs[i];
    const b = behs[i];
    const [lo, hi] = s.income.map(Number);
    return {
      id: `P${String(i + 1).padStart(3, "0")}`,
      name: names[i],
      age: Math.floor(rng() * (Number(ageHi) - Number(ageLo) + 1)) + Number(ageLo),
      segment: s.name,
      income: Math.round((lo + rng() * (hi - lo)) / 1000) * 1000,
      behaviour: b.name,
      behaviourHow: b.how ?? "",
      objection: pick(customer.objections),
      habit: habits.length ? pick(habits) : "",
    };
  });
}

function personaCard(p) {
  return [
    `[${p.id}] ${p.name}, ${p.age}. ${p.segment}. About $${p.income.toLocaleString("en-US")} a year.`,
    `How they buy: ${p.behaviour}. ${p.behaviourHow}`.trimEnd(),
    p.habit ? `Their day: ${p.habit}.` : null,
    `The doubt that comes to mind first: "${p.objection}"`,
  ].filter(Boolean).join("\n");
}

function batchPrompts(personas, pitch, { perCall = 5, target = "", ask = null } = {}) {
  if (!Number.isInteger(perCall) || perCall < 1) throw new Error("perCall must be a whole number of at least 1");
  const text = String(pitch ?? "").trim();
  if (!text) throw new Error("the pitch is empty");
  const batches = [];
  for (let i = 0; i < personas.length; i += perCall) {
    const group = personas.slice(i, i + perCall);
    const prompt = [
      ask?.rules ||
        "You are simulating buyers on a consumer panel. A founder wants to know, before spending any money, whether real people like these would buy. Each answer is only useful if it is honest: most people do not buy most things, and a polite yes is worse than a clear no. These answers are simulated, not from real customers, so they are useful for finding objections, not for proving demand.",
      ask ? null : "Decide as each buyer would, with their money, habits and doubts, in a normal week. Every buyer sees the offer for the first time, the way a passer-by or a scroller would, and must decide: answer yes or no, with a confidence from 1 to 5; never maybe. Answer every buyer independently: one buyer's answer must not shape another's. Do not be agreeable. Do not invent facts about the business beyond the pitch. If the pitch gives no price, still answer the four price questions with the dollar amounts you would expect, never 0.",
      target ? `Target customer: ${target}` : null,
      `=== BUYERS ===\n${group.map(personaCard).join("\n\n")}\n=== END BUYERS ===`,
      `=== PITCH (each buyer sees exactly this, for the first time) ===\n${text}\n=== END PITCH ===`,
      `Reply with ONLY a JSON array with one object per buyer, in the order listed above. No markdown fence, no text outside the array. Each object has this shape:\n${ask?.shape || ANSWER_SHAPE}`,
    ].filter(Boolean).join("\n\n");
    batches.push({ ids: group.map((p) => p.id), prompt });
  }
  return batches;
}

function jsonObjects(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (depth === 0) {
      if (c === "{") {
        depth = 1;
        start = i;
      }
      continue;
    }
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) out.push(text.slice(start, i + 1));
  }
  return out;
}

function checkAnswer(o, ids) {
  if (!ids.includes(o.id)) return { problem: `id ${JSON.stringify(o.id)} is not a buyer in this batch` };
  let buys = typeof o.buys === "boolean" ? (o.buys ? "yes" : "no") : String(o.buys ?? "").trim().toLowerCase();
  let confidence = Number(o.confidence);
  confidence = Number.isFinite(confidence) ? Math.min(5, Math.max(1, Math.round(confidence))) : 3;
  if (buys === "maybe") {
    buys = "no";
    confidence = 1;
  }
  if (!BUYS.includes(buys)) return { problem: "buys must be yes or no" };
  if (typeof o.reason !== "string" || !o.reason.trim()) return { problem: "reason is missing" };
  const reasonCode = String(o.reason_code ?? o.reasonCode ?? "").trim().toLowerCase();
  const first = Number(o.purchases_first_month ?? o.purchasesFirstMonth);
  let prices = {};
  for (const k of PRICE_KEYS) {
    const raw = o.prices?.[k];
    const v = typeof raw === "string" ? Number(raw.replace(/[$,\s]/g, "")) : raw;
    if (!(Number.isFinite(v) && v > 0 && v <= MAX_PRICE)) {
      prices = null;
      break;
    }
    prices[k] = v;
  }
  return {
    answer: {
      id: o.id,
      buys,
      confidence,
      reason: o.reason.trim(),
      reasonCode: REASONS.includes(reasonCode) ? reasonCode : "other",
      purchasesFirstMonth: buys === "yes" && Number.isFinite(first) && first >= 0 ? Math.min(60, Math.round(first)) : 0,
      objection: typeof o.objection === "string" ? o.objection.trim().slice(0, 300) : "",
      ...(STANCE_ALL.includes(String(o.stance ?? "").trim().toLowerCase()) ? { stance: String(o.stance).trim().toLowerCase() } : {}),
      ...(STANCE_ALL.includes(String(o.stance2 ?? "").trim().toLowerCase()) ? { stance2: String(o.stance2).trim().toLowerCase() } : {}),
      wouldFlipIf: [o.wouldFlipIf, o.would_change_my_mind].find((x) => typeof x === "string")?.trim() ?? "",
      prices,
    },
  };
}

function parseAnswers(text, batch) {
  const answers = [];
  const errors = [];
  const seen = new Set();
  for (const raw of jsonObjects(String(text ?? ""))) {
    let o;
    try {
      o = JSON.parse(raw);
    } catch {
      errors.push({ id: null, problem: "not valid JSON" });
      continue;
    }
    const r = checkAnswer(o, batch.ids);
    if (r.problem) errors.push({ id: o.id ?? null, problem: r.problem });
    else if (seen.has(o.id)) errors.push({ id: o.id, problem: "answered twice, kept the first" });
    else {
      seen.add(o.id);
      answers.push(r.answer);
    }
  }
  for (const id of batch.ids) {
    if (!seen.has(id)) errors.push({ id, problem: "no valid answer" });
  }
  return { answers, errors };
}

const normalize = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();

function countBy(texts) {
  const m = new Map();
  for (const text of texts) {
    const key = normalize(text);
    const hit = m.get(key) ?? { text, count: 0 };
    hit.count++;
    m.set(key, hit);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

function tally(answers, personas, lang = "en") {
  const byId = new Map(personas.map((p) => [p.id, p]));
  const rows = answers
    .filter((a) => byId.has(a.id))
    .map((a) => {
      const p = byId.get(a.id);
      return { ...a, segment: p.segment, behaviour: p.behaviour, income: p.income };
    });
  const incomes = rows.map((r) => r.income).sort((a, b) => a - b);
  const cut1 = incomes[Math.floor(incomes.length / 3)];
  const cut2 = incomes[Math.floor((2 * incomes.length) / 3)];
  const money = (v) => `$${v.toLocaleString("en-US")}`;
  const band = (inc) => (inc < cut1 ? `under ${money(cut1)}` : inc >= cut2 ? `${money(cut2)} and up` : `${money(cut1)} to ${money(cut2)}`);
  const withBand = rows.map((r) => ({ ...r, incomeBand: band(r.income) }));

  const rate = (rs) => (rs.length ? rs.filter((r) => r.buys === "yes").length / rs.length : null);
  const count = (buys) => withBand.filter((r) => r.buys === buys).length;
  const group = (key) => {
    const m = new Map();
    for (const r of withBand) m.set(r[key], [...(m.get(r[key]) ?? []), r]);
    return [...m]
      .map(([name, rs]) => ({ group: name, buyers: rs.length, buyRate: rate(rs), yes: rs.filter((r) => r.buys === "yes").length, no: rs.filter((r) => r.buys === "no").length, reasons: countBy(rs.filter((r) => r.buys === "no").map((r) => r.reason)).slice(0, 3) }))
      .sort((a, b) => b.buyRate - a.buyRate);
  };
  const no = withBand.filter((r) => r.buys === "no");
  return {
    answered: withBand.length,
    buys: count("yes"),
    passes: count("no"),
    buyRate: rate(withBand),
    meanConfidence: withBand.length ? withBand.reduce((n, r) => n + (r.confidence ?? 3), 0) / withBand.length : null,
    lowConfidenceShare: withBand.length ? withBand.filter((r) => (r.confidence ?? 3) <= 2).length / withBand.length : null,
    bySegment: group("segment"),
    byBehaviour: group("behaviour"),
    reasonCodesNo: [...no.reduce((m, r) => m.set(r.reasonCode || "other", (m.get(r.reasonCode || "other") || 0) + 1), new Map())].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    topReasonsNo: countBy(no.map((r) => r.reason)).slice(0, 5),
    flipIfNo: countBy(no.map((r) => r.wouldFlipIf).filter(Boolean)),
    stances: Object.fromEntries(["stance", "stance2"].map((k) => [k, withBand.reduce((m, r) => (r[k] ? { ...m, [r[k]]: (m[r[k]] || 0) + 1 } : m), {})])),
    effectiveSampleNote: I18N.translate(lang, SIMULATED_NOTE),
  };
}

function cross(grid, falling, rising) {
  for (let i = 1; i < grid.length; i++) {
    const d0 = rising[i - 1] - falling[i - 1];
    const d1 = rising[i] - falling[i];
    if (d0 <= 0 && 0 <= d1 && d1 !== d0) {
      const t = -d0 / (d1 - d0);
      return grid[i - 1] + t * (grid[i] - grid[i - 1]);
    }
    if (d0 === 0) return grid[i - 1];
  }
  return null;
}

function medianOf(values) {
  const s = [...values].sort((a, b) => a - b),
    h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

function vanWestendorp(answers) {
  const rows = [];
  let dropped = 0;
  for (const a of answers) {
    const p = PRICE_KEYS.map((k) => a?.prices?.[k]);
    if (p.some((v) => !(Number.isFinite(v) && v > 0 && v <= MAX_PRICE)) || !(p[0] <= p[1] && p[1] <= p[2] && p[2] <= p[3])) dropped++;
    else rows.push(p);
  }
  const n = rows.length;
  if (n < 5) {
    return { n, dropped, points: { PMC: null, PME: null, OPP: null, IPP: null }, range: [null, null], median: Object.fromEntries(PRICE_KEYS.map((k) => [k, null])) };
  }
  const lo = Math.min(...rows.map((r) => r[0]));
  const hi = Math.max(...rows.map((r) => r[3]));
  const step = Math.max(0.01, Math.round(((hi - lo) / 400) * 100) / 100);
  const grid = [];
  for (let i = 0, n = Math.floor((hi - lo) / step + 1e-9); i <= n; i++) grid.push(Math.round((lo + i * step) * 1e4) / 1e4);
  const share = (test) => grid.map((p) => rows.filter((r) => test(r, p)).length / n);
  const tc = share((r, p) => r[0] >= p);
  const ch = share((r, p) => r[1] >= p);
  const ex = share((r, p) => r[2] <= p);
  const te = share((r, p) => r[3] <= p);
  const notCheap = ch.map((v) => 1 - v);
  const notExp = ex.map((v) => 1 - v);
  const points = {
    PMC: cross(grid, tc, notCheap),
    PME: cross(grid, notExp, te),
    OPP: cross(grid, tc, te),
    IPP: cross(grid, ch, ex),
  };
  const median = Object.fromEntries(PRICE_KEYS.map((k, i) => [k, medianOf(rows.map((r) => r[i]))]));
  return { n, dropped, points, range: [points.PMC, points.PME], median };
}

module.exports = { dealPersonas, batchPrompts, parseAnswers, tally, vanWestendorp, medianOf };
