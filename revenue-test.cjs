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
  assert.throws(() => idea({ revenueModel: "freemium", revConversion: "140" }), /cannot be above 100/);
  assert.throws(() => idea({ revenueModel: "marketplace_commission", revTakeRate: "101" }), /cannot be above 100/);
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
  store.put("messages", { id: "m2", sessionId: s.id, role: "user", text: "How many visitors do you think it needs?", status: "complete", round: 2, agent: null, error: "", usage: null, created: new Date().toISOString(), context: "" });
  assert.equal(chat.extract(i.id, "About ten thousand a month.", s.id).proposals, null, "a message that is not about money proposes nothing");
  store.put("messages", { id: "m3", sessionId: s.id, role: "user", text: "Free with ads please", status: "complete", round: 3, agent: null, error: "", usage: null, created: new Date().toISOString(), context: "" });
  store.put("messages", { id: "m4", sessionId: s.id, role: "assistant", text: "ok", status: "complete", round: 3, agent: null, error: "", usage: null, created: new Date().toISOString(), context: "", proposals: { updates: [{ id: "u1", target: "revenueModel", to: "ads", status: "rejected" }], branches: [] } });
  assert.equal(chat.extract(i.id, "Noted.", s.id).proposals, null, "a rejected model is not proposed again until the owner mentions money again");
  store.put("messages", { id: "m5", sessionId: s.id, role: "user", text: "Actually I do want ads", status: "complete", round: 4, agent: null, error: "", usage: null, created: new Date().toISOString(), context: "" });
  assert.equal(chat.extract(i.id, "Noted.", s.id).proposals.updates[0].to, "ads", "mentioning money again allows it");
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

// break-even in each model's own unit, worked from its revenue formula
{
  const be = (m, vals, fixed) => revenue.breakEven(m, vals, fixed);
  assert.deepEqual(be("ads", { revUsers: 100, revPageviews: 3, revRpm: 4 }, 45), { unit: "visitors per month", value: 3750 });
  assert.deepEqual(be("ads", { revUsers: 1, revPageviews: 10, revRpm: 3 }, 45), { unit: "visitors per month", value: 1500 });
  assert.equal(be("ads", { revUsers: 100, revPageviews: 3, revRpm: 0 }, 45).value, null, "ads that pay nothing never break even");
  assert.equal(be("ads", { revUsers: 100, revPageviews: 3, revRpm: 4 }, 0).value, 0, "no costs, nothing to cover");
  assert.deepEqual(be("marketplace_commission", { revGmv: 1, revTakeRate: 10 }, 500), { unit: "sales (GMV) per month", value: 5000 });
  assert.equal(be("marketplace_commission", { revGmv: 1, revTakeRate: 0 }, 500).value, null);
  assert.deepEqual(be("grants_research", { revGrantSize: 50000, revGrantsPerYear: 1 }, 1000), { unit: "grants per year", value: 1 }, "12,000 a year of costs is one 50,000 grant");
  assert.equal(be("grants_research", { revGrantSize: 5000, revGrantsPerYear: 1 }, 1000).value, 3);
  assert.deepEqual(be("freemium", { revFreeUsers: 1, revConversion: 5, price: 10 }, 100), { unit: "free users", value: 200 });
  assert.deepEqual(be("usage_based", { revUnits: 1, revUnitPrice: 0.5 }, 100), { unit: "units per month", value: 200 });
  assert.equal(be("ads", { revUsers: 100 }, 45), null, "missing inputs give no figure");
  for (const m of ["subscription", "one_time", "not_monetized_yet"]) assert.equal(be(m, {}, 45), null);
  const PT = require("./dist/assets/i18n-pt.js");
  for (const u of revenue.BREAK_EVEN_UNITS) assert.ok(PT[u], "pt-BR unit: " + u);
}

// the grill's focus follows the revenue model
{
  const ads = revenue.grillFocus("ads", null);
  assert.match(ads, /traffic/);
  assert.match(ads, /Do not ask "who exactly pays"/);
  assert.match(ads, /Visitors per month|How many people would visit/);
  assert.match(revenue.grillFocus("not_monetized_yet", null), /who funds it/);
  assert.match(revenue.grillFocus("grants_research", null), /funders/);
  assert.doesNotMatch(revenue.grillFocus("subscription", null), /who exactly pays/);
  assert.doesNotMatch(revenue.grillFocus("ads", "freemium"), /who exactly pays/, "a paid second stream keeps the usual questions");
}

console.log("revenue tests passed");
