"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const revenue = require("./revenue.cjs");
const { openStore, validateRecord } = require("./store.cjs");
const { createIdeaChat } = require("./ideachat.cjs");

const RAMP = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.9, 0.9];
const idea = (fields) => validateRecord({ type: "idea", stage: "draft", title: "T", fields });

// model validation
{
  assert.equal(revenue.MODEL_KEYS.length, 12);
  for (const m of revenue.MODEL_KEYS) assert.equal(idea({ revenueModel: m }).fields.revenueModel, m);
  assert.equal(idea({}).fields.revenueModel, undefined, "optional");
  assert.throws(() => idea({ revenueModel: "lottery" }), /revenue models/);
  assert.throws(() => idea({ revenueModel: "ads", revenueSecondary: "lottery" }), /second stream/);
  assert.throws(() => idea({ revenueSecondary: "ads" }), /main revenue model/);
  assert.throws(() => idea({ revenueModel: "ads", revenueSecondary: "ads" }), /differ/);
  assert.throws(() => idea({ revenueModel: "ads", revUsers: "many" }), /number/);
  assert.throws(() => idea({ revenueModel: "ads", revRpm: "-3" }), /number/);
  const ok = idea({ revenueModel: "ads", revenueSecondary: "freemium", revenueNotes: "free with a no-ads upgrade", revUsers: "50000", revPageviews: "10", revRpm: "4.5", revFreeUsers: "1000", revConversion: "3" });
  assert.equal(ok.fields.revRpm, "4.5");
  assert.equal(ok.fields.revenueSecondary, "freemium");
}

// exports and backups keep the fields
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-revenue-"));
  const store = openStore(dir);
  const saved = store.put("records", idea({ revenueModel: "grants_research", revGrantSize: "250000", revGrantsPerYear: "2", revenueNotes: "NSF" }));
  const archive = store.archive();
  assert.equal(archive.records.find((r) => r.id === saved.id).fields.revGrantSize, "250000");
  const other = openStore(fs.mkdtempSync(path.join(os.tmpdir(), "spark-revenue-")));
  other.importArchive(JSON.parse(JSON.stringify(archive)), "replace");
  const back = other.get("records", saved.id);
  assert.equal(back.fields.revenueModel, "grants_research");
  assert.equal(back.fields.revenueNotes, "NSF");
  assert.equal(back.fields.revGrantsPerYear, "2");
}

// language mapping, including combinations
{
  assert.equal(revenue.fromText("I want it free with ads sometimes").model, "ads");
  assert.equal(revenue.fromText("this is research, I'd fund it with grants").model, "grants_research");
  assert.equal(revenue.fromText("I'd like to keep it free forever").model, "not_monetized_yet");
  assert.equal(revenue.fromText("people pay a monthly subscription").model, "subscription");
  assert.equal(revenue.fromText("we take a 10% commission on each sale").model, "marketplace_commission");
  assert.equal(revenue.fromText("pay per use, metered by API call").model, "usage_based");
  assert.equal(revenue.fromText("a one-time purchase").model, "one_time");
  assert.equal(revenue.fromText("companies would license the technology").model, "licensing");
  assert.equal(revenue.fromText("donations from the community").model, "donations");
  assert.equal(revenue.fromText("nothing about money here"), null);
  assert.deepEqual(revenue.fromText("free with ads, and a paid plan without ads"), { model: "ads", secondary: "freemium" });
  assert.deepEqual(revenue.fromText("freemium: free tier with ads, paid upgrade removes them"), { model: "freemium", secondary: "ads" });
  const combo = revenue.fromText("consulting services and licensing the software");
  assert.deepEqual([combo.model, combo.secondary].sort(), ["licensing", "services"]);
  assert.equal(revenue.parse("Grants and research funding"), "grants_research");
  assert.equal(revenue.parse("one-time"), "one_time");
}

// the idea chat turns what the owner says into a proposal, and ignores it when nothing changed
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-revenue-"));
  const store = openStore(dir);
  const i = store.put("records", idea({ solution: "NFL picks" }));
  const s = store.put("sessions", { id: "s1", title: "w", agents: [], contextIds: [i.id], mode: "solo", rounds: 1, localOnly: false, ideaId: i.id, created: new Date().toISOString(), updated: new Date().toISOString() });
  store.put("messages", { id: "m1", sessionId: s.id, role: "user", text: "I want it free with ads, and a paid plan without ads", status: "complete", round: 1, agent: null, error: "", usage: null, created: new Date().toISOString(), context: "" });
  const chat = createIdeaChat({ store, canvas: { blockText: () => "" }, pipeline: {}, assistant: {}, extractJson: JSON.parse });
  const found = chat.extract(i.id, "Got it. How many visitors a month do you expect, and how many pages does each one read?", s.id);
  assert.equal(found.proposals.updates.length, 2);
  assert.deepEqual(found.proposals.updates.map((u) => [u.target, u.to]), [["revenueModel", "ads"], ["revenueSecondary", "freemium"]]);
  const withBlock = chat.extract(i.id, 'Sure.\n```spark-proposals\n{"updates":[{"target":"revenueModel","to":"Ads","why":"free with ads"},{"target":"revenueSecondary","to":"nonsense","why":"x"}]}\n```', s.id);
  assert.deepEqual(withBlock.proposals.updates.map((u) => [u.target, u.to]), [["revenueModel", "ads"], ["revenueSecondary", "freemium"]], "a model proposal is parsed, an invalid one dropped, the owner's own words fill the gap");
  store.put("records", validateRecord({ ...i, fields: { ...i.fields, revenueModel: "ads", revenueSecondary: "freemium" } }));
  assert.equal(chat.extract(i.id, "ok", s.id).proposals, null, "nothing to propose when it already matches");
}

// CFO math for each model
{
  const m = (model, vals) => revenue.streamRevenue(model, vals).monthly;
  assert.equal(m("ads", { revUsers: 50000, revPageviews: 10, revRpm: 4 }), 2000);
  assert.equal(m("marketplace_commission", { revGmv: 100000, revTakeRate: 12 }), 12000);
  assert.equal(m("freemium", { revFreeUsers: 10000, revConversion: 3, price: 5 }), 1500);
  assert.equal(m("grants_research", { revGrantSize: 300000, revGrantsPerYear: 2 }), 50000);
  assert.equal(m("licensing", { revDeals: 3, revFee: 40000 }), 10000);
  assert.equal(m("usage_based", { revUnits: 1000, revUnitPrice: 2.5 }), 2500);
  assert.equal(m("services", { revHours: 80, revRate: 90 }), 7200);
  assert.equal(m("b2b_contract", { revContracts: 6, revContractValue: 12000 }), 6000);
  assert.equal(m("donations", { revDonors: 40, revAvgGift: 30 }), 1200);
  assert.equal(m("not_monetized_yet", {}), 0);
  const missing = revenue.streamRevenue("ads", { revUsers: 100 });
  assert.equal(missing.monthly, null);
  assert.deepEqual(missing.missing, ["revPageviews", "revRpm"]);
}

// two income streams add up, each with its share
{
  const ads = revenue.streamRevenue("ads", { revUsers: 50000, revPageviews: 10, revRpm: 4 });
  const fm = revenue.streamRevenue("freemium", { revFreeUsers: 10000, revConversion: 3, price: 5 });
  const total = revenue.combine([ads, fm], RAMP);
  const k = revenue.rampSum(RAMP);
  assert.equal(Math.round(k * 100) / 100, 7.8);
  assert.equal(total.monthly, 3500);
  assert.equal(total.year1, 27300);
  assert.deepEqual(total.streams.map((s) => [s.model, s.year1, s.share]), [["ads", 15600, 0.571], ["freemium", 11700, 0.429]]);
  assert.ok(Math.abs(total.streams.reduce((n, s) => n + s.share, 0) - 1) < 0.002);
  const one = revenue.combine([{ model: "subscription", monthly: 100, year1: 500 }, ads], RAMP);
  assert.equal(one.streams[0].year1, 500, "a stream worked out elsewhere keeps its own year 1");
  assert.equal(one.year1, 16100);
}

// sanity checks
{
  assert.equal(revenue.sanity("ads", { revRpm: 4, revPageviews: 10 }).length, 0);
  assert.match(revenue.sanity("ads", { revRpm: 400 })[0], /RPM/);
  assert.match(revenue.sanity("ads", { revRpm: 0.01 })[0], /RPM/);
  assert.match(revenue.sanity("ads", { revPageviews: 900 })[0], /pageviews/);
  assert.match(revenue.sanity("marketplace_commission", { revTakeRate: 60 })[0], /take rate/);
  assert.match(revenue.sanity("freemium", { revConversion: 40 })[0], /upgrading/);
  assert.match(revenue.sanity("grants_research", { revGrantSize: 900000000 })[0], /grant/);
  assert.match(revenue.sanity("grants_research", { revGrantsPerYear: 12 })[0], /grants a year/);
  assert.match(revenue.sanity("licensing", { revFee: 5000000 })[0], /licensing fee/);
  assert.match(revenue.sanity("services", { revRate: 2000, revHours: 400 })[0], /rate/);
  assert.match(revenue.sanity("donations", { revAvgGift: 5000 })[0], /gift/);
  assert.match(revenue.sanity("usage_based", { revUnitPrice: 50 }, { competitorPrices: [2, 3, 4], cur: "$" })[0], /5 times the median competitor price/);
  assert.equal(revenue.sanity("usage_based", { revUnitPrice: 5 }, { competitorPrices: [2, 3, 4] }).length, 0);
  assert.equal(revenue.sanity("not_monetized_yet", {}).length, 0);
}

// the verdict wording fits the model
{
  assert.equal(revenue.verdict("not_monetized_yet", null, { year1Profit: -9000, year1Revenue: 0, fixedCosts: 750 }).label, "Not a business yet");
  assert.match(revenue.verdict("not_monetized_yet", null, { year1Profit: -9000, year1Revenue: 0, fixedCosts: 750 }).text, /^Not a business yet/);
  assert.equal(revenue.verdict("grants_research", null, { year1Profit: 100000, year1Revenue: 600000, fixedCosts: 20000 }).label, "Funded by grants");
  assert.equal(revenue.verdict("grants_research", null, { year1Profit: -1, year1Revenue: 100000, fixedCosts: 20000 }).label, "Not yet");
  assert.equal(revenue.verdict("ads", "freemium", { year1Profit: 5, year1Revenue: 10, fixedCosts: 1 }).label, "Profitable");
}

// the panel question set per model
{
  const q = (a, b) => revenue.questionSet(a, b);
  assert.equal(q("subscription").plain, true, "a plain priced product keeps the usual buyer questions");
  assert.equal(q("subscription").shape, null);
  assert.equal(q("grants_research").kind, "skip");
  assert.match(q("grants_research").reason, /grant officer/);
  assert.equal(q("ads").kind, "usage");
  assert.match(q("ads").shape, /fine_with_ads/);
  assert.doesNotMatch(q("ads").shape, /tooCheap/, "no willingness-to-pay questions for an ads idea");
  assert.match(q("ads").rules, /feel about ads/);
  assert.equal(q("freemium").kind, "freemium");
  assert.match(q("freemium").shape, /stay_free/);
  assert.match(q("freemium").shape, /tooCheap/, "the upgrade price is asked");
  assert.equal(q("licensing").kind, "decision");
  assert.match(q("licensing").rules, /decision-maker/);
  assert.match(q("b2b_contract").rules, /procurement/);
  assert.equal(q("not_monetized_yet").kind, "usage");
  assert.doesNotMatch(q("donations").shape, /tooCheap/);
  const combo = q("ads", "freemium");
  assert.deepEqual(combo.models, ["ads", "freemium"]);
  assert.match(combo.shape, /stance2/);
  assert.match(combo.shape, /tooCheap/);
  assert.match(combo.rules, /both questions briefly/);
  assert.equal(q("grants_research", "ads").models.join(), "ads", "a skipped primary leaves the secondary's panel");
  assert.equal(q("grants_research", "licensing").kind, "decision");
  assert.equal(revenue.priceBased("ads", null), false);
  assert.equal(revenue.priceBased("ads", "freemium"), true);
  assert.equal(revenue.usesUnitEconomics("ads", "subscription"), true);
  assert.equal(revenue.usesUnitEconomics("ads", "freemium"), false);
}

// every model has its own price unit
{
  const units = Object.fromEntries(revenue.MODEL_KEYS.map((k) => [k, revenue.MODELS[k].unitLabel]));
  assert.match(units.subscription, /per month/);
  assert.match(units.one_time, /per item/);
  assert.match(units.ads, /RPM/);
  assert.match(units.marketplace_commission, /take rate/);
  assert.match(units.usage_based, /per unit/);
  assert.match(units.licensing, /per deal/);
  assert.match(units.services, /per hour/);
  assert.match(units.grants_research, /grant size/);
  assert.match(units.donations, /average gift/);
  assert.equal(new Set(Object.values(units)).size, 12);
}

// the idea page's selector shows the same models, words and inputs as the server
{
  const { REV_MODELS } = require("./dist/assets/revenue-ui.js");
  assert.deepEqual(Object.keys(REV_MODELS), revenue.MODEL_KEYS);
  for (const k of revenue.MODEL_KEYS) {
    assert.equal(REV_MODELS[k].label, revenue.MODELS[k].label, k);
    assert.equal(REV_MODELS[k].explain, revenue.MODELS[k].explain, k);
    assert.deepEqual(REV_MODELS[k].inputs.map(([key, label]) => [key, label]), revenue.MODELS[k].inputs.map((i) => [i.key, i.label]), k);
  }
}

console.log("revenue tests passed");
