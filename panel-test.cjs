"use strict";
const assert = require("node:assert/strict");
const { dealPersonas, batchPrompts, parseAnswers, tally, vanWestendorp } = require("./panel.cjs");

{
  const batch = { ids: ["P001"] };
  const huge = parseAnswers(JSON.stringify([{ id: "P001", buys: "yes", confidence: 3, reason: "fine", prices: { tooCheap: 1e17, bargain: 1e17, expensive: 1e17, tooExpensive: 1e17 } }]), batch);
  assert.equal(huge.answers.length, 1, "an absurd price drops the price, not the answer");
  assert.equal(huge.answers[0].prices, null);
  const rows = Array.from({ length: 6 }, () => ({ prices: { tooCheap: 1e17, bargain: 1e17, expensive: 1e17, tooExpensive: 1e17 } }));
  const t0 = Date.now();
  assert.equal(vanWestendorp(rows).n, 0, "huge identical prices are dropped, not looped over");
  const wide = Array.from({ length: 6 }, () => ({ prices: { tooCheap: 1, bargain: 5e8, expensive: 8e8, tooExpensive: 1e9 } }));
  assert.equal(vanWestendorp(wide).n, 6);
  assert.ok(Date.now() - t0 < 2000);
}

const customer = {
  business: "Test Bar",
  target: "Office workers who buy coffee",
  age: [24, 38],
  segments: [
    { name: "Early", share: 0.45, income: [38000, 85000] },
    { name: "Mid", share: 0.4, income: [85000, 150000] },
    { name: "High", share: 0.15, income: [150000, 210000] },
  ],
  behaviours: [
    { name: "Daily regular", share: 0.2, how: "Buys the same drink most mornings." },
    { name: "Deal hunter", share: 0.8, how: "Waits for offers." },
  ],
  objections: ["Too steep", "My place is closer"],
  habits: ["you walk past the shop on the way to work"],
};

const a1 = dealPersonas(customer, { n: 20, seed: 7 });
assert.deepEqual(dealPersonas(customer, { n: 20, seed: 7 }), a1);
assert.notDeepEqual(dealPersonas(customer, { n: 20, seed: 8 }), a1);
assert.deepEqual(a1.map((p) => p.id), Array.from({ length: 20 }, (_, i) => `P${String(i + 1).padStart(3, "0")}`));
const segCounts = (ps) => ps.reduce((m, p) => ({ ...m, [p.segment]: (m[p.segment] ?? 0) + 1 }), {});
assert.deepEqual(segCounts(a1), { Early: 9, Mid: 8, High: 3 });
for (const p of a1) {
  const seg = customer.segments.find((s) => s.name === p.segment);
  assert.ok(p.income >= seg.income[0] - 500 && p.income <= seg.income[1] + 500, `income ${p.income} outside ${seg.income}`);
  assert.equal(p.income % 1000, 0);
  assert.ok(p.age >= 24 && p.age <= 38);
  assert.ok(customer.objections.includes(p.objection));
  assert.equal(p.habit, "you walk past the shop on the way to work");
}
assert.equal(dealPersonas({ ...customer, habits: undefined }, { n: 3, seed: 1 })[0].habit, "");
assert.equal(dealPersonas(customer, { n: 75, seed: 1 }).length, 75);
assert.equal(new Set(dealPersonas(customer, { n: 75, seed: 1 }).map((p) => p.name)).size, 75);

assert.throws(() => dealPersonas({ ...customer, business: "" }), /needs 'business'/);
assert.throws(() => dealPersonas({ ...customer, objections: [] }), /needs 'objections'/);
assert.throws(() => dealPersonas({ ...customer, segments: [{ name: "x", income: [1] }] }), /income \[low, high\]/);
assert.throws(() => dealPersonas({ ...customer, behaviours: [{ how: "x" }] }), /needs a name/);
assert.throws(() => dealPersonas({ ...customer, segments: "Early" }), /must be a list/);
assert.throws(() => dealPersonas(customer, { n: 0 }), /n must be/);
assert.throws(() => dealPersonas({ ...customer, segments: [{ name: "x", share: 0, income: [1, 2] }] }), /shares must be/);

const personas = dealPersonas(customer, { n: 12, seed: 3 });
const batches = batchPrompts(personas, "  Matcha latte, $6.50.  ", { perCall: 5, target: "Office workers" });
assert.deepEqual(batches.map((b) => b.ids.length), [5, 5, 2]);
assert.deepEqual(batches[0].ids, personas.slice(0, 5).map((p) => p.id));
assert.ok(batches[0].prompt.includes(`[${personas[0].id}] ${personas[0].name}`));
assert.ok(!batches[0].prompt.includes(`[${personas[5].id}]`));
assert.ok(batches[0].prompt.includes("Matcha latte, $6.50."));
assert.ok(batches[0].prompt.includes("Target customer: Office workers"));
assert.ok(batches[0].prompt.includes("independently"));
assert.ok(batches[0].prompt.includes("simulated"));
assert.ok(batches[0].prompt.includes('"buys": "yes" | "no",'));
assert.ok(batches[0].prompt.includes('"confidence": 1 to 5'));
assert.equal(batchPrompts(personas, "x", { perCall: 100 }).length, 1);
assert.equal(batchPrompts([], "x").length, 0);
assert.throws(() => batchPrompts(personas, "   "), /pitch is empty/);
assert.throws(() => batchPrompts(personas, "x", { perCall: 0 }), /perCall/);

const batch = { ids: ["P001", "P002", "P003"] };
const ans = (id, extra = {}) => ({
  id,
  buys: "yes",
  reason: "Fine",
  wouldFlipIf: "",
  prices: { tooCheap: 2, bargain: 3, expensive: 5, tooExpensive: 7 },
  ...extra,
});
const clean = parseAnswers(JSON.stringify([ans("P001"), ans("P002", { buys: "no" }), ans("P003", { buys: "maybe" })]), batch);
assert.deepEqual(clean.errors, []);
assert.deepEqual(clean.answers.map((a) => a.buys), ["yes", "no", "no"]);
assert.deepEqual(clean.answers.map((a) => a.confidence), [3, 3, 1]);
assert.equal(parseAnswers(JSON.stringify([ans("P001", { confidence: 9 })]), batch).answers[0].confidence, 5);
assert.deepEqual(clean.answers[0], { id: "P001", buys: "yes", confidence: 3, reason: "Fine", reasonCode: "other", purchasesFirstMonth: 0, objection: "", wouldFlipIf: "", prices: { tooCheap: 2, bargain: 3, expensive: 5, tooExpensive: 7 } });

const rich = parseAnswers(JSON.stringify([ans("P001", { reason_code: "Price", purchases_first_month: 3, objection: "Too dear", would_change_my_mind: "Half price", wouldFlipIf: undefined }), ans("P002", { buys: "no", reason_code: "nonsense", purchases_first_month: 5 })]), batch).answers;
assert.equal(rich[0].reasonCode, "price");
assert.equal(rich[0].purchasesFirstMonth, 3);
assert.equal(rich[0].objection, "Too dear");
assert.equal(rich[0].wouldFlipIf, "Half price");
assert.equal(rich[1].reasonCode, "other");
assert.equal(rich[1].purchasesFirstMonth, 0);
assert.ok(batches[0].prompt.includes("Do not be agreeable") && batches[0].prompt.includes("purchases_first_month") && batches[0].prompt.includes("reason_code"));
const codes = tally([ans("P001", { buys: "no", reason_code: "price" }), ans("P002", { buys: "no", reason_code: "price" }), ans("P003", { buys: "no", reason_code: "trust" })].map((a) => parseAnswers(JSON.stringify([a]), batch).answers[0]), personas).reasonCodesNo;
assert.deepEqual(codes, [{ code: "price", count: 2 }, { code: "trust", count: 1 }]);

const wrapped = parseAnswers("Here you go:\n```json\n" + JSON.stringify([ans("P001"), ans("P002"), ans("P003")]) + "\n```\nDone.", batch);
assert.equal(wrapped.answers.length, 3);
assert.deepEqual(wrapped.errors, []);

const truncated = JSON.stringify([ans("P001"), ans("P002")]).slice(0, -20);
const partial = parseAnswers(truncated, batch);
assert.deepEqual(partial.answers.map((a) => a.id), ["P001"]);
assert.deepEqual(partial.errors, [
  { id: "P002", problem: "no valid answer" },
  { id: "P003", problem: "no valid answer" },
]);

const braces = parseAnswers(JSON.stringify([ans("P001", { reason: "I said } and { in quotes \" ok" })]), { ids: ["P001"] });
assert.equal(braces.answers[0].reason, 'I said } and { in quotes " ok');

const messy = parseAnswers(
  JSON.stringify([
    ans("P001", { buys: "Sure" }),
    ans("P002", { prices: { tooCheap: "$2.50", bargain: "3,00", expensive: 5, tooExpensive: 0 } }),
    ans("P009"),
    ans("P003", { reason: "  " }),
    ans("P001", { buys: "no" }),
    ans("P003", { buys: true, wouldFlipIf: 4 }),
    ans("P003", { buys: "no" }),
  ]),
  batch,
);
assert.deepEqual(messy.errors, [
  { id: "P001", problem: "buys must be yes or no" },
  { id: "P009", problem: 'id "P009" is not a buyer in this batch' },
  { id: "P003", problem: "reason is missing" },
  { id: "P003", problem: "answered twice, kept the first" },
]);
assert.deepEqual(messy.answers.map((a) => [a.id, a.buys, a.wouldFlipIf]), [
  ["P002", "yes", ""],
  ["P001", "no", ""],
  ["P003", "yes", ""],
]);
assert.equal(messy.answers[0].prices, null);

const noPrices = parseAnswers(JSON.stringify([ans("P001", { prices: { tooCheap: 0, bargain: 0, expensive: 0, tooExpensive: 0 } }), ans("P002", { prices: undefined })]), batch);
assert.deepEqual(noPrices.answers.map((a) => [a.id, a.buys, a.prices]), [["P001", "yes", null], ["P002", "yes", null]]);
assert.deepEqual(noPrices.errors, [{ id: "P003", problem: "no valid answer" }]);
assert.deepEqual(parseAnswers(JSON.stringify([ans("P001", { prices: { tooCheap: "$2.50", bargain: "3,00", expensive: 5, tooExpensive: 9 } })]), { ids: ["P001"] }).answers[0].prices, { tooCheap: 2.5, bargain: 300, expensive: 5, tooExpensive: 9 });

const garbage = parseAnswers("I cannot help with that. {not json} and then nothing", batch);
assert.equal(garbage.answers.length, 0);
assert.equal(garbage.errors.length, 4);
assert.equal(garbage.errors[0].problem, "not valid JSON");

const tallyPersonas = [
  { id: "P001", segment: "A", behaviour: "x", income: 40000 },
  { id: "P002", segment: "A", behaviour: "x", income: 90000 },
  { id: "P003", segment: "A", behaviour: "y", income: 120000 },
  { id: "P004", segment: "B", behaviour: "y", income: 50000 },
  { id: "P005", segment: "B", behaviour: "x", income: 100000 },
  { id: "P006", segment: "B", behaviour: "y", income: 200000 },
];
const pr = { tooCheap: 2, bargain: 3, expensive: 5, tooExpensive: 7 };
const t = tally(
  [
    { id: "P001", buys: "yes", reason: "Good coffee", wouldFlipIf: "", prices: pr },
    { id: "P002", buys: "yes", reason: "Good coffee!", wouldFlipIf: "", prices: pr },
    { id: "P003", buys: "no", reason: "Too pricey", wouldFlipIf: "A discount", prices: pr },
    { id: "P004", buys: "no", reason: "too pricey", wouldFlipIf: "a discount.", prices: pr },
    { id: "P005", buys: "no", reason: "Not for me", wouldFlipIf: "", prices: pr },
    { id: "P006", buys: "no", confidence: 1, reason: "Maybe", wouldFlipIf: "", prices: pr },
  ],
  tallyPersonas,
);
assert.equal(t.answered, 6);
assert.equal(t.buys, 2);
assert.equal(t.passes, 4);
assert.equal(t.lowConfidenceShare, 1 / 6);
assert.ok(Math.abs(t.meanConfidence - (3 * 5 + 1) / 6) < 1e-9);
assert.equal(t.buyRate, 2 / 6);
assert.deepEqual(t.bySegment.map((g) => [g.group, g.buyers, g.buyRate, g.yes, g.no]), [["A", 3, 2 / 3, 2, 1], ["B", 3, 0, 0, 3]]);
assert.deepEqual(t.bySegment[0].reasons.map((r) => r.text), ["Too pricey"]);
assert.ok(t.bySegment.every((g) => g.yes + g.no === g.buyers));
assert.deepEqual(t.byBehaviour.map((g) => [g.group, g.buyers]), [["x", 3], ["y", 3]]);
assert.deepEqual(t.topReasonsNo, [
  { text: "Too pricey", count: 2 },
  { text: "Not for me", count: 1 },
  { text: "Maybe", count: 1 },
]);
assert.deepEqual(t.flipIfNo, [{ text: "A discount", count: 2 }]);
assert.ok(t.effectiveSampleNote.includes("upper bound"));
assert.equal(tally([], tallyPersonas).buyRate, null);

const near = (actual, expected, label) => {
  if (expected === null) assert.equal(actual, null, label);
  else assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
};
const toAnswers = (rows, extra = []) => [
  ...rows.map((r, i) => ({ id: `P${i}`, prices: { tooCheap: r[0], bargain: r[1], expensive: r[2], tooExpensive: r[3] } })),
  ...extra,
];
const A = [[3, 4, 6, 8], [2, 5, 7, 9], [4, 5, 6, 7], [3, 3.5, 5.5, 6], [5, 6, 7, 8], [2, 4, 8, 10], [4, 6, 6.5, 7.5]];

const va = vanWestendorp(toAnswers(A));
assert.equal(va.n, 7);
assert.equal(va.dropped, 0);
near(va.points.PMC, 4.01, "A PMC");
near(va.points.PME, 6.993333333333333, "A PME");
near(va.points.OPP, 5.02, "A OPP");
near(va.points.IPP, 5.99, "A IPP");
assert.deepEqual(va.range, [va.points.PMC, va.points.PME]);
assert.deepEqual(va.median, { tooCheap: 3, bargain: 5, expensive: 6.5, tooExpensive: 8 });

const vb = vanWestendorp(
  toAnswers(
    [...A, [1, 2, 3, 4]],
    [
      { id: "bad-order", prices: { tooCheap: 5, bargain: 6, expensive: 4, tooExpensive: 8 } },
      { id: "incomplete", prices: { tooCheap: 3, bargain: null, expensive: 6, tooExpensive: 8 } },
    ],
  ),
);
assert.equal(vb.n, 8);
assert.equal(vb.dropped, 2);
near(vb.points.PMC, 4.005, "B PMC");
near(vb.points.PME, 6.986666666666667, "B PME");
near(vb.points.OPP, 4.02, "B OPP");
near(vb.points.IPP, 5.5, "B IPP");
assert.deepEqual(vb.median, { tooCheap: 3, bargain: 4.5, expensive: 6.25, tooExpensive: 7.75 }, "even count averages the two middle answers");

const vc = vanWestendorp(toAnswers([[1, 2, 4, 6], [2, 3, 5, 7], [3, 4, 6, 8], [4, 5, 7, 9], [2, 2.5, 3.5, 5]]));
assert.equal(vc.n, 5);
near(vc.points.PMC, 2.52, "C PMC");
near(vc.points.PME, 5.99, "C PME");
near(vc.points.OPP, 4.02, "C OPP");
near(vc.points.IPP, 4.0, "C IPP");

const thin = vanWestendorp(toAnswers(A.slice(0, 4)));
assert.deepEqual(thin, { n: 4, dropped: 0, points: { PMC: null, PME: null, OPP: null, IPP: null }, range: [null, null], median: { tooCheap: null, bargain: null, expensive: null, tooExpensive: null } });
assert.equal(vanWestendorp([]).n, 0);

{
  const st = parseAnswers(JSON.stringify([ans("P001", { stance: "Fine_With_Ads", stance2: "<img onerror=x>" }), ans("P002", { stance: "free text that is not allowed" })]), batch);
  assert.equal(st.answers[0].stance, "fine_with_ads");
  assert.equal(st.answers[0].stance2, undefined, "only listed stances pass through");
  assert.equal(st.answers[1].stance, undefined);
}

console.log("Panel tests passed");
