"use strict";

const I18N = require("./dist/assets/i18n.js");
const T = (lang, k, p) => I18N.translate(lang, k, p);

const I = (key, label, ask) => ({ key, label, ask });
const MODELS = {
  subscription: { label: "Subscription", explain: "Customers pay a fixed amount every month or year.", unit: "per month", unitLabel: "price per month", priced: true, panel: "buy", inputs: [] },
  one_time: { label: "One-time sale", explain: "Customers pay once for each item.", unit: "per item", unitLabel: "price per item", priced: true, panel: "buy", inputs: [] },
  freemium: { label: "Freemium", explain: "Free for most people; a share of them pay to upgrade.", unit: "per month (paid plan)", unitLabel: "paid plan price per month", priced: true, panel: "freemium", inputs: [I("revFreeUsers", "Free users", "How many free users could you have?"), I("revConversion", "Upgrade rate (%)", "What share of free users would upgrade, in percent?")], needsPrice: true },
  ads: { label: "Ads", explain: "Free to use; money comes from ads shown to visitors.", unit: "per 1,000 pageviews (RPM)", unitLabel: "ad revenue per 1,000 pageviews (RPM)", priced: false, panel: "usage", inputs: [I("revUsers", "Visitors per month", "How many people would visit in a month?"), I("revPageviews", "Pageviews per visitor per month", "How many pages would each visitor view in a month?"), I("revRpm", "Ad RPM (per 1,000 pageviews)", "How much do ads pay per 1,000 pageviews?")] },
  marketplace_commission: { label: "Marketplace commission", explain: "You take a cut of each sale between buyers and sellers.", unit: "take rate (% of each sale)", unitLabel: "take rate (% of each sale)", priced: false, panel: "usage", inputs: [I("revGmv", "Sales through it per month", "How much would be bought and sold through it in a month?"), I("revTakeRate", "Take rate (%)", "What percent of each sale would you keep?")] },
  usage_based: { label: "Pay per use", explain: "Customers pay for what they use, per unit.", unit: "per unit", unitLabel: "price per unit", priced: true, panel: "buy", inputs: [I("revUnits", "Units used per month", "How many units would customers use in a month?"), I("revUnitPrice", "Price per unit", "What would one unit cost?")], priceKey: "revUnitPrice" },
  licensing: { label: "Licensing", explain: "Others pay a fee to use your technology or content.", unit: "per deal", unitLabel: "fee per deal", priced: false, panel: "decision", inputs: [I("revDeals", "Deals per year", "How many licensing deals could you sign in a year?"), I("revFee", "Fee per deal", "What would one deal pay?")] },
  services: { label: "Services", explain: "You sell your time or projects to clients.", unit: "per hour", unitLabel: "rate per hour (or per project)", priced: true, panel: "buy", inputs: [I("revHours", "Billable hours per month", "How many hours a month could you bill?"), I("revRate", "Rate per hour", "What would you charge per hour?")], priceKey: "revRate" },
  b2b_contract: { label: "Business contracts", explain: "Companies sign contracts for a larger recurring or custom deal.", unit: "per contract", unitLabel: "value per contract", priced: false, panel: "decision", inputs: [I("revContracts", "Contracts per year", "How many contracts could you win in a year?"), I("revContractValue", "Value per contract", "What would one contract be worth per year?")] },
  donations: { label: "Donations", explain: "People give what they choose, with no fixed price.", unit: "average gift", unitLabel: "average gift", priced: false, panel: "usage", inputs: [I("revDonors", "Gifts per month", "How many gifts would you get in a month?"), I("revAvgGift", "Average gift", "What would the average gift be?")] },
  grants_research: { label: "Grants and research funding", explain: "Research paid for by grants and partners, not by customers.", unit: "grant size", unitLabel: "grant size", priced: false, panel: "skip", inputs: [I("revGrantSize", "Grant size", "How big would a typical grant be?"), I("revGrantsPerYear", "Grants won per year", "How many grants could you win in a year?")] },
  not_monetized_yet: { label: "Not monetized yet", explain: "No plan to earn money yet, so it is not a business until that changes.", unit: "none", unitLabel: "no price", priced: false, panel: "usage", inputs: [] },
};
const MODEL_KEYS = Object.keys(MODELS);
const INPUT_KEYS = [...new Set(MODEL_KEYS.flatMap((m) => MODELS[m].inputs.map((i) => i.key)))];
const FIELD_KEYS = ["revenueModel", "revenueSecondary", "revenueNotes", ...INPUT_KEYS];
const UNIT_MODELS = ["subscription", "one_time"];

function parse(v) {
  const s = String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (MODEL_KEYS.includes(s)) return s;
  const byLabel = MODEL_KEYS.find((k) => MODELS[k].label.toLowerCase().replace(/[\s-]+/g, "_") === s);
  return byLabel || "";
}

const RULES = [
  ["ads", /\b(ads|advertis\w*|adsense|ad[- ]supported|sponsor(?:s|ed|ship)?)\b/g],
  ["freemium", /\b(freemium|free (?:tier|plan|version)|paid (?:plan|tier|version|upgrade)|premium (?:plan|tier|version)|pro plan|upgrade|remove ads|without ads|ad[- ]free)\b/g],
  ["grants_research", /\b(grants?|grant[- ]funded|nsf|nih|research funding|fellowships?)\b/g],
  ["donations", /\b(donat\w+|patreon|crowdfund\w*|pay what you want)\b/g],
  ["marketplace_commission", /\b(commissions?|take rate|marketplace|cut of each)\b/g],
  ["usage_based", /\b(pay[- ]per[- ]use|per use|usage[- ]based|per api call|per request|metered|per unit)\b/g],
  ["one_time", /\b(one[- ]time|pay once|single purchase|lifetime deal)\b/g],
  ["licensing", /\b(licens\w+|royalt\w+)\b/g],
  ["b2b_contract", /\b(b2b|enterprise contracts?|procurement|sell to (?:companies|businesses))\b/g],
  ["services", /\b(consult\w+|freelanc\w+|hourly|agency|per project|done[- ]for[- ]you|services)\b/g],
  ["subscription", /\b(subscri\w+|monthly (?:fee|plan)|per month|recurring)\b/g],
  ["not_monetized_yet", /\b(not monet[iz]ed|no (?:revenue|monet[iz]ation)|just for fun|hobby|(?:want it|keep it|stay|stays|completely|totally|just|it'?s) free|free forever|free for (?:everyone|everybody|all)|don'?t (?:want|plan) to (?:charge|make money))\b/g],
  ["grants_research", /\b(research project|this is research|scientific research|basic research)\b/g],
];

function fromText(text) {
  const t = String(text ?? "").toLowerCase();
  const first = new Map();
  for (const [model, re] of RULES) {
    re.lastIndex = 0;
    const m = re.exec(t);
    if (m && (!first.has(model) || m.index < first.get(model))) first.set(model, m.index);
  }
  if (first.size > 1 && first.has("not_monetized_yet")) first.delete("not_monetized_yet");
  const found = [...first].sort((a, b) => a[1] - b[1]).map(([m]) => m);
  if (!found.length) return null;
  return { model: found[0], secondary: found[1] || null };
}

function parseNum(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function validateFields(fields, lang = "en") {
  for (const k of ["revenueModel", "revenueSecondary"]) {
    const v = String(fields?.[k] ?? "").trim();
    if (v && !MODEL_KEYS.includes(v)) return k === "revenueModel" ? T(lang, "Choose one of the listed revenue models for how it makes money.") : T(lang, "Choose one of the listed revenue models for the second stream.");
  }
  if (fields?.revenueSecondary && !fields.revenueModel) return T(lang, "Pick the main revenue model before a second one.");
  if (fields?.revenueModel && fields.revenueModel === fields.revenueSecondary) return T(lang, "The second stream must differ from the main one.");
  for (const k of INPUT_KEYS) {
    const v = String(fields?.[k] ?? "").trim();
    if (v && parseNum(v) === null) return T(lang, '"{field}" must be a number of zero or more.', { field: k });
    if (["revConversion", "revTakeRate"].includes(k) && parseNum(v) > 100) return T(lang, '"{field}" is a percent and cannot be above 100.', { field: k });
  }
  return "";
}

function streamRevenue(model, vals, lang = "en") {
  const need = (keys) => keys.filter((k) => vals[k] === undefined);
  const out = (keys, f, formula) => {
    const missing = need(keys);
    return { model, missing, monthly: missing.length ? null : Math.round(f() * 100) / 100, formula };
  };
  switch (model) {
    case "ads": return out(["revUsers", "revPageviews", "revRpm"], () => (vals.revUsers * vals.revPageviews * vals.revRpm) / 1000, T(lang, "visitors x pageviews each x RPM / 1,000"));
    case "marketplace_commission": return out(["revGmv", "revTakeRate"], () => (vals.revGmv * vals.revTakeRate) / 100, T(lang, "sales through it x take rate"));
    case "freemium": return out(["revFreeUsers", "revConversion", "price"], () => (vals.revFreeUsers * vals.revConversion * vals.price) / 100, T(lang, "free users x upgrade rate x paid price"));
    case "grants_research": return out(["revGrantSize", "revGrantsPerYear"], () => (vals.revGrantSize * vals.revGrantsPerYear) / 12, T(lang, "grant size x grants a year / 12"));
    case "licensing": return out(["revDeals", "revFee"], () => (vals.revDeals * vals.revFee) / 12, T(lang, "deals a year x fee / 12"));
    case "usage_based": return out(["revUnits", "revUnitPrice"], () => vals.revUnits * vals.revUnitPrice, T(lang, "units x price per unit"));
    case "services": return out(["revHours", "revRate"], () => vals.revHours * vals.revRate, T(lang, "billable hours x rate"));
    case "b2b_contract": return out(["revContracts", "revContractValue"], () => (vals.revContracts * vals.revContractValue) / 12, T(lang, "contracts a year x value / 12"));
    case "donations": return out(["revDonors", "revAvgGift"], () => vals.revDonors * vals.revAvgGift, T(lang, "gifts a month x average gift"));
    default: return { model, missing: [], monthly: 0, formula: T(lang, "no revenue") };
  }
}

const rampSum = (ramp) => ramp.reduce((a, b) => a + b, 0);

function combine(streams, ramp) {
  const k = rampSum(ramp);
  const rows = streams.map((s) => ({ model: s.model, formula: s.formula || "", monthly: s.monthly, year1: s.year1 ?? Math.round(s.monthly * k * 100) / 100 }));
  const total = rows.reduce((a, r) => a + r.year1, 0);
  const monthly = rows.reduce((a, r) => a + r.monthly, 0);
  return { streams: rows.map((r) => ({ ...r, share: total > 0 ? Math.round((r.year1 / total) * 1000) / 1000 : null })), monthly: Math.round(monthly * 100) / 100, year1: Math.round(total * 100) / 100 };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

function sanity(model, vals, { competitorPrices = [], cur = "" } = {}, lang = "en") {
  const out = [],
    m = (v) => cur + Math.round(v * 100) / 100,
    comp = median(competitorPrices.filter((x) => x > 0));
  const far = (v, key) => {
    if (comp !== null && v > comp * 5) out.push(T(lang, key, { value: m(v), median: m(comp) }));
  };
  switch (model) {
    case "ads":
      if (vals.revRpm !== undefined && (vals.revRpm > 50 || vals.revRpm < 0.1)) out.push(T(lang, "An ad RPM of {value} is outside what sites usually earn (about {low} to {high} per 1,000 pageviews).", { value: m(vals.revRpm), low: cur + "1", high: cur + "30" }));
      if (vals.revPageviews !== undefined && vals.revPageviews > 300) out.push(T(lang, "{value} pageviews per visitor a month is far above a typical site (under 100).", { value: vals.revPageviews }));
      break;
    case "marketplace_commission":
      if (vals.revTakeRate !== undefined && (vals.revTakeRate > 30 || vals.revTakeRate < 0.5)) out.push(T(lang, "A take rate of {value}% is outside what marketplaces usually keep (about 2% to 30%).", { value: vals.revTakeRate }));
      break;
    case "freemium":
      if (vals.revConversion !== undefined && vals.revConversion > 15) out.push(T(lang, "{value}% of free users upgrading is far above the usual 1% to 5%.", { value: vals.revConversion }));
      if (vals.price !== undefined) far(vals.price, "The paid plan price {value} is more than 5 times the median competitor price ({median}).");
      break;
    case "grants_research":
      if (vals.revGrantSize !== undefined && vals.revGrantSize > 3000000) out.push(T(lang, "A grant of {value} is larger than almost any single research grant (most are {low} to {high}).", { value: m(vals.revGrantSize), low: cur + "10,000", high: cur + "2,000,000" }));
      if (vals.revGrantsPerYear !== undefined && vals.revGrantsPerYear > 5) out.push(T(lang, "Winning {value} grants a year is far more than a small team usually lands.", { value: vals.revGrantsPerYear }));
      break;
    case "licensing":
      if (vals.revFee !== undefined && vals.revFee > 1000000) out.push(T(lang, "A licensing fee of {value} per deal needs a proven, in-demand technology.", { value: m(vals.revFee) }));
      if (vals.revDeals !== undefined && vals.revDeals > 20) out.push(T(lang, "{value} licensing deals a year is a lot for a new business.", { value: vals.revDeals }));
      break;
    case "usage_based":
      if (vals.revUnitPrice !== undefined) far(vals.revUnitPrice, "The price per unit {value} is more than 5 times the median competitor price ({median}).");
      break;
    case "services":
      if (vals.revRate !== undefined && vals.revRate > 500) out.push(T(lang, "A rate of {value} an hour is above what most services charge.", { value: m(vals.revRate) }));
      if (vals.revRate !== undefined) far(vals.revRate, "The hourly rate {value} is more than 5 times the median competitor price ({median}).");
      if (vals.revHours !== undefined && vals.revHours > 160) out.push(T(lang, "{value} billable hours a month is more than one person can bill.", { value: vals.revHours }));
      break;
    case "b2b_contract":
      if (vals.revContractValue !== undefined) far(vals.revContractValue, "The contract value {value} is more than 5 times the median competitor price ({median}).");
      if (vals.revContracts !== undefined && vals.revContracts > 50) out.push(T(lang, "{value} contracts a year is a lot for a new business.", { value: vals.revContracts }));
      break;
    case "donations":
      if (vals.revAvgGift !== undefined && vals.revAvgGift > 500) out.push(T(lang, "An average gift of {value} is far above typical (about {low} to {high}).", { value: m(vals.revAvgGift), low: cur + "20", high: cur + "100" }));
      break;
    default:
  }
  return out;
}

const BENCHMARKS = {
  ads: "Typical display ad RPM is about $1 to $10 per 1,000 pageviews, and up to $20 to $30 for niche or finance audiences. Fill rate is rarely 100%.",
  marketplace_commission: "Marketplaces usually keep 5% to 30% of each sale (payments about 3%, app stores 15% to 30%, services marketplaces 10% to 20%).",
  freemium: "Freemium products usually convert 1% to 5% of free users to paid.",
  grants_research: "Research grants range from $10,000 (small foundations) to $200,000 to $2,000,000 (national research councils) over several years. Success rates are often 10% to 20%.",
  licensing: "Licensing fees vary widely; early technology often gets an upfront fee plus a royalty of 2% to 10% of sales.",
  services: "Freelance and consulting rates run from about $30 to $250 an hour depending on the field.",
  usage_based: "Price per unit should sit near what competitors charge for the same unit.",
  b2b_contract: "Small business contracts run in the thousands a year; enterprise contracts run higher but take 6 to 12 months to close.",
  donations: "Average online gifts are about $20 to $100, and only a small share of users give.",
  not_monetized_yet: "No money is modelled.",
};

const WHO = {
  buy: "a customer who decides whether to buy it themselves",
  freemium: "a person who would use the free version and decide whether to upgrade",
  usage: "a person who would use it for free and decide how they feel about the way it makes money",
  decision: "a decision-maker at an organisation that would sign (a procurement lead, a budget holder or a technical lead), not an individual consumer",
  skip: "",
};

const STANCES = {
  ads: ["fine_with_ads", "tolerate_ads", "would_leave"],
  donations: ["would_give", "might_give", "would_not_give"],
  marketplace_commission: ["fine_with_fee", "wants_lower_fee", "would_go_elsewhere"],
  not_monetized_yet: ["would_use_often", "try_once", "not_for_me"],
  freemium: ["stay_free", "upgrade", "leave"],
  licensing: ["would_sign", "would_pilot", "would_pass"],
  b2b_contract: ["would_sign", "would_pilot", "would_pass"],
  usage_based: ["would_use", "maybe", "would_not"],
};
const STANCE_ALL = [...new Set([...Object.values(STANCES).flat(), "would_buy", "maybe", "would_not"])];
const ASK = {
  buy: (m) => `Would you buy it (${MODELS[m].unitLabel})?`,
  freemium: () => "Would you use the free version, and would you stay free or upgrade? Answer the four price questions for the paid plan per month.",
  ads: () => "Would you use it regularly, and how would you feel about ads in it? stance is one of fine_with_ads, tolerate_ads, would_leave. Do not answer any price questions.",
  donations: () => "Would you use it, and would you ever give money to support it? stance is one of would_give, might_give, would_not_give.",
  marketplace_commission: () => "Would you buy or sell through it, and how do you feel about it keeping a cut of each sale? stance is one of fine_with_fee, wants_lower_fee, would_go_elsewhere.",
  not_monetized_yet: () => "Would you use it regularly? stance is one of would_use_often, try_once, not_for_me. Do not answer any price questions.",
  decision: (m) => `As the decision-maker: would you take a meeting or pilot this (${MODELS[m].unitLabel})? stance is one of would_sign, would_pilot, would_pass.`,
};

function panelKind(m) {
  return MODELS[m]?.panel || "buy";
}

function questionSet(primary, secondary, lang = "en") {
  const models = [primary, secondary].filter(Boolean).filter((m) => panelKind(m) !== "skip");
  if (!models.length) return { kind: "skip", models: [], reason: primary === "grants_research" ? T(lang, "Nobody here buys it from a shelf: a grant officer decides this, so a simulated buyer panel would say nothing useful. Fund it by finding the grants that fit, and judge it on the research case.") : T(lang, "Nobody here buys it from a shelf: a simulated buyer panel does not apply.") };
  const kinds = models.map(panelKind);
  const askFor = (m) => {
    const k = panelKind(m);
    return k === "buy" ? ASK.buy(m) : k === "freemium" ? ASK.freemium() : k === "decision" ? ASK.decision(m) : (ASK[m] || ASK.not_monetized_yet)(m);
  };
  const asks = models.map(askFor);
  const priced = models.some((m) => MODELS[m].priced);
  const stances = models.map((m) => STANCES[m] || ["would_buy", "maybe", "would_not"]);
  const plain = models.length === 1 && kinds[0] === "buy";
  const intro = models.length === 1 ? `Each person is ${WHO[kinds[0]]}. ${asks[0]}` : `Each person is ${WHO[kinds[0]]}. Ask both questions briefly. First: ${asks[0]} Second: ${asks[1]} Keep each reason to one sentence.`;
  const shape = plain ? null : `{
  "id": "<buyer id>",
  "buys": "yes" | "no" (yes = they would ${kinds[0] === "decision" ? "take the meeting or pilot it" : kinds[0] === "buy" ? "buy it" : "use it"}),
  "confidence": 1 to 5,
  "reason_code": one of price / habit / need / trust / quality / convenience / timing / values / other,
  "reason": "why, in one or two sentences, in your own voice",
  "objection": "the doubt that weighs most for you, in your own words",
  "wouldFlipIf": "the one thing that would change this answer, or empty",
  "stance": ${stances[0] ? stances[0].map((s) => `"${s}"`).join(" | ") : '"" (empty)'}${models.length > 1 ? `,\n  "stance2": ${stances[1] ? stances[1].map((s) => `"${s}"`).join(" | ") : '"" (empty)'} (your answer to the second question)` : ""}${priced ? `,\n  "prices": { "tooCheap": ..., "bargain": ..., "expensive": ..., "tooExpensive": ... } (all numbers, for the ${models.find((m) => MODELS[m].priced) === "freemium" ? "paid plan, per month" : MODELS[models.find((m) => MODELS[m].priced)].unitLabel}; use null if the question does not apply)` : ""}
}`;
  const rules = plain ? null : "You are simulating a panel for a founder who wants to know, before spending money, how the right people would react. Each answer is only useful if it is honest. These answers are simulated, so they are useful for finding objections, not for proving demand. Answer every person independently and do not be agreeable. Do not invent facts about the business beyond the pitch. " + intro;
  return { kind: kinds[0], kinds, models, priced, plain, intro, shape, rules };
}

const priceBased = (primary, secondary) => [primary, secondary].filter(Boolean).some((m) => MODELS[m]?.priced);
const usesUnitEconomics = (primary, secondary) => [primary, secondary].filter(Boolean).some((m) => UNIT_MODELS.includes(m));

function describe(primary, secondary, lang = "en") {
  const p = MODELS[primary],
    s = secondary ? MODELS[secondary] : null;
  if (!p) return "";
  return s ? T(lang, "{label} ({explain}), plus {label2} ({explain2}).", { label: T(lang, p.label), explain: T(lang, p.explain), label2: T(lang, s.label), explain2: T(lang, s.explain) }) : T(lang, "{label} ({explain}).", { label: T(lang, p.label), explain: T(lang, p.explain) });
}

function guidance(primary, secondary) {
  const lines = [`HOW IT MAKES MONEY: ${describe(primary, secondary)}`];
  const adv = {
    ads: "Ads need traffic, so judge reach and how often people come back, not a price per customer.",
    marketplace_commission: "A marketplace needs both buyers and sellers; judge how it gets liquidity and what share it can keep.",
    grants_research: "Judge it as research funded by grants or partners: the case for funding, not profit or consumer demand.",
    licensing: "Judge it on who would license it and for how much per deal.",
    donations: "Judge it on whether supporters would give and how often.",
    not_monetized_yet: "It has no revenue plan yet; say plainly what it would take to become a business.",
    b2b_contract: "Judge it on the buyers inside organisations and the length of the sale.",
    services: "Judge it on hours, rate and the owner's capacity.",
    usage_based: "Judge it on how much people use it and the price per unit.",
    freemium: "Judge it on how many free users it can attract and how many would upgrade.",
  }[primary];
  if (adv) lines.push(adv);
  if (!priced(primary) && !(secondary && priced(secondary))) lines.push("Do not ask for a consumer subscription price: this idea does not charge one.");
  return lines.join(" ");
}
function priced(m) {
  return !!MODELS[m]?.priced;
}

const BREAK_EVEN = {
  ads: ["revUsers", "visitors per month"],
  marketplace_commission: ["revGmv", "sales (GMV) per month"],
  freemium: ["revFreeUsers", "free users"],
  usage_based: ["revUnits", "units per month"],
  services: ["revHours", "billable hours per month"],
  licensing: ["revDeals", "deals per year"],
  b2b_contract: ["revContracts", "contracts per year"],
  donations: ["revDonors", "gifts per month"],
  grants_research: ["revGrantsPerYear", "grants per year"],
};
const BREAK_EVEN_UNITS = Object.values(BREAK_EVEN).map((x) => x[1]);

function breakEven(model, vals, fixedMonthly, lang = "en") {
  const scale = BREAK_EVEN[model];
  if (!scale) return null;
  const big = 1e6,
    r = streamRevenue(model, { ...vals, [scale[0]]: big }, lang);
  if (r.monthly === null) return null;
  const per = r.monthly / big;
  return { unit: T(lang, scale[1]), value: !(fixedMonthly > 0) ? 0 : per > 0 ? Math.ceil(+(fixedMonthly / per).toFixed(6)) : null };
}

const FOCUS = {
  ads: "traffic, the audience and what ads pay",
  not_monetized_yet: "who funds it and what keeps it running",
  grants_research: "which funders and how big the grants are",
  donations: "who would give and how often",
  marketplace_commission: "how many sales go through it and what share is kept",
  licensing: "who would license it and for how much",
  b2b_contract: "who inside the organisations signs and how long the sale takes",
  services: "hours, rate and capacity",
  usage_based: "how much it is used and the price per unit",
  freemium: "how many free users and how many upgrade",
};

function grillFocus(primary, secondary) {
  const models = [primary, secondary].filter(Boolean),
    lines = [guidance(primary, secondary)],
    asks = models.flatMap((m) => MODELS[m]?.inputs || []).map((i) => i.ask);
  if (asks.length) lines.push(`Ask for the numbers this model needs: ${asks.join(" ")}`);
  if (!priced(primary) && !(secondary && priced(secondary))) lines.push(`Do not ask "who exactly pays": ask about ${models.map((m) => FOCUS[m]).filter(Boolean).join(" and ")}.`);
  return lines.join(" ");
}

function inputMeanings(models) {
  return models.flatMap((m) => MODELS[m]?.inputs || []).map((i) => `${i.key} = ${i.label}`).join("; ");
}

function verdict(primary, secondary, { year1Profit, year1Revenue, fixedCosts, label: ownLabel }, lang = "en") {
  const m = (v) => Math.round(v);
  if (primary === "not_monetized_yet" && !secondary)
    return { label: "Not a business yet", text: T(lang, "Not a business yet: there is no revenue plan, so nothing to profit from. It would cost about {cost} a month to run. Decide how it could make money, or keep it as a free project.", { cost: m(fixedCosts) }) };
  if (primary === "grants_research" && !secondary) {
    const covers = year1Revenue >= fixedCosts * 12;
    const p = { revenue: m(year1Revenue), costs: m(fixedCosts * 12) };
    return { label: covers ? "Funded by grants" : "Not yet", text: covers ? T(lang, "Funded by grants, not profit: the modelled grants ({revenue} in year 1) cover the running costs ({costs} a year). This is a research project; success is winning the grants.", p) : T(lang, "A research project, not a business yet: the modelled grants ({revenue} in year 1) do not cover the running costs ({costs} a year). Judge it on the research case and the grants you can win.", p) };
  }
  return { label: year1Profit > 0 ? "Profitable" : "Not yet", text: year1Profit > 0 ? T(lang, "Year 1 operating profit {profit} on revenue of {revenue}.", { profit: m(year1Profit), revenue: m(year1Revenue) }) : T(lang, "Year 1 operating loss {loss} on revenue of {revenue}.", { loss: m(-year1Profit), revenue: m(year1Revenue) }) };
}

module.exports = { MODELS, MODEL_KEYS, INPUT_KEYS, FIELD_KEYS, UNIT_MODELS, parse, fromText, parseNum, STANCE_ALL, validateFields, streamRevenue, combine, sanity, BENCHMARKS, questionSet, priceBased, usesUnitEconomics, describe, guidance, inputMeanings, verdict, breakEven, BREAK_EVEN_UNITS, grillFocus, rampSum, WHO };
