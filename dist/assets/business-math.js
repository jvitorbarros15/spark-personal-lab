"use strict";
const _bmI = typeof I18N !== "undefined" ? I18N : typeof require === "function" ? require("./i18n.js") : null;
const _bmL = (l) => l || (typeof document !== "undefined" && _bmI ? _bmI.lang : "en");
const _bmT = (k, p, l) => (_bmI ? _bmI.translate(_bmL(l), k, p) : k.replace(/\{(\w+)\}/g, (m, n) => (p && p[n] != null ? p[n] : m)));
const BUSINESS_MATH_INPUTS = ["price", "variableCost", "fixedCosts", "hoursPerCustomer", "availableHours"];
const MATH_LABEL_KEYS = { price: "price", variableCost: "variable cost", fixedCosts: "fixed costs", hoursPerCustomer: "hours per customer", availableHours: "available hours" };
const _bmLabel = (k, l) => (MATH_LABEL_KEYS[k] ? _bmT(MATH_LABEL_KEYS[k], undefined, l) : k);
const EPS = 1e-9;
function parseAmount(value, locale) {
  const pt = /^pt/i.test(_bmL(locale));
  let raw = String(value ?? "").trim();
  if (/^[+-]?\d*\.?\d+e[+-]?\d+$/i.test(raw)) raw = String(Number(raw));
  else raw = raw.replace(/[^\d.,+-]/g, "");
  const dot = raw.lastIndexOf("."),
    comma = raw.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) raw = dot > comma ? raw.replace(/,/g, "") : raw.replace(/\./g, "").replace(",", ".");
  else if (comma >= 0) raw = !pt && /^[+-]?\d{1,3}(,\d{3})+$/.test(raw) ? raw.replace(/,/g, "") : raw.replace(/,/g, ".");
  else if (dot >= 0 && pt && /^[+-]?\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  else if (dot >= 0 && !pt && /^[+-]?\d{1,3}(\.\d{3}){2,}$/.test(raw)) raw = raw.replace(/\./g, "");
  if (raw === "") return { blank: true };
  const n = Number(raw);
  return Number.isFinite(n) ? { n } : { blank: true };
}
const cleanDiv = (a, b, round) => {
  const q = a / b,
    r = Math.round(q);
  return round(Math.abs(q - r) < EPS ? r : q);
};
function businessMath(input, locale) {
  const v = {}, missing = [], invalid = [];
  for (const key of BUSINESS_MATH_INPUTS) {
    const p = parseAmount(input?.[key], locale);
    if (p.blank) missing.push(key);
    else if (p.n < 0) invalid.push(key);
    else v[key] = p.n;
  }
  const has = (k) => v[k] !== undefined;
  const contribution = has("price") && has("variableCost") ? Math.round((v.price - v.variableCost) * 1e9) / 1e9 : null;
  const margin = contribution !== null && v.price > 0 ? contribution / v.price : null;
  const breakEven = contribution > 0 && has("fixedCosts") ? cleanDiv(v.fixedCosts, contribution, Math.ceil) : null;
  const capacity = v.hoursPerCustomer > 0 && has("availableHours") ? cleanDiv(v.availableHours, v.hoursPerCustomer, Math.floor) : null;
  const profitAtCapacity = capacity !== null && contribution !== null && has("fixedCosts") ? Math.round((capacity * contribution - v.fixedCosts) * 100) / 100 : null;
  const warnings = [];
  for (const k of invalid) warnings.push(_bmT("{label} cannot be negative.", { label: _bmLabel(k, locale)[0].toUpperCase() + _bmLabel(k, locale).slice(1) }, locale));
  if (contribution !== null && contribution < 0) warnings.push(_bmT("Each sale loses money: price does not cover variable cost.", undefined, locale));
  if (contribution === 0) warnings.push(_bmT("Each sale earns nothing: price only covers variable cost, so fixed costs are never paid back.", undefined, locale));
  if (has("price") && v.price === 0 && has("variableCost")) warnings.push(_bmT("Price is zero, so margin is undefined.", undefined, locale));
  if (breakEven !== null && capacity !== null && breakEven > capacity) warnings.push(_bmT("Break-even needs more customers than you have time for.", undefined, locale));
  if (v.hoursPerCustomer === 0) warnings.push(_bmT("Time per customer must be above zero.", undefined, locale));
  return { missing, invalid, contribution, margin, breakEven, capacity, profitAtCapacity, warnings };
}
// Unit economics below is ported from the founder-cfo skill's unit_economics.py (MIT, Jake Schincariol; see licenses/founder-skill-MIT.txt).
// Differences from the Python tool: volumes are customers per period (a period is one month), not units a day, and the
// what-ifs are price -10%, sales -20% and costs +10% (variable and fixed).
const DEFAULT_RAMP = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.9, 0.9];
const money2 = (v) => Math.round(v * 100) / 100;
function analyseEconomics(s, { price = s.price, volume = 1, costFactor = 1 } = {}) {
  const variable = s.variableCost * costFactor,
    fixed = s.fixedCosts * costFactor,
    contribution = price - variable,
    ramp = s.ramp.map((share) => share * s.capacity * volume),
    plan = ramp[ramp.length - 1],
    breakEven = contribution > 0 ? cleanDiv(fixed, contribution, Math.ceil) : null,
    marginAtPlan = price > 0 && plan > 0 ? (contribution - fixed / plan) / price : null;
  const months = [];
  let cumulative = -s.startup,
    payback = null,
    lowest = -s.startup;
  ramp.forEach((customers, i) => {
    const revenue = customers * price,
      profit = revenue - customers * variable - fixed;
    cumulative += profit;
    lowest = Math.min(lowest, cumulative);
    if (payback === null && cumulative >= 0) payback = i + 1;
    months.push({ month: i + 1, customers: money2(customers), revenue: money2(revenue), profit: money2(profit), cumulative: money2(cumulative) });
  });
  const year1Profit = months.reduce((a, m) => a + m.profit, 0),
    year1Revenue = months.reduce((a, m) => a + m.revenue, 0);
  return { price: money2(price), contribution: money2(contribution), breakEven, marginAtPlan, planCustomers: money2(plan), months, year1Revenue: money2(year1Revenue), year1Profit: money2(year1Profit), year1AfterStartup: money2(year1Profit - s.startup), paybackMonth: payback, cashNeeded: money2(-lowest) };
}
// spec: { price, variableCost, fixedCosts, hoursPerCustomer, availableHours, startup?, ramp? } with every number present.
function unitEconomics(spec) {
  const loc = spec.locale,
    core = businessMath(spec, loc);
  if (core.missing.length || core.invalid.length || core.capacity === null) return { ok: false, missing: core.missing, invalid: core.invalid, warnings: core.warnings };
  const s = { price: Number(spec.price), variableCost: Number(spec.variableCost), fixedCosts: Number(spec.fixedCosts), capacity: core.capacity, startup: Math.max(0, Number(spec.startup) || 0), ramp: Array.isArray(spec.ramp) && spec.ramp.length === 12 && spec.ramp.every((x) => Number.isFinite(Number(x))) ? spec.ramp.map((x) => Math.max(0, Math.min(1, Number(x)))) : DEFAULT_RAMP };
  const base = analyseEconomics(s),
    cases = [[_bmT("Base plan", undefined, loc), base], [_bmT("Price -10%", undefined, loc), analyseEconomics(s, { price: s.price * 0.9 })], [_bmT("Sales -20%", undefined, loc), analyseEconomics(s, { volume: 0.8 })], [_bmT("Costs +10%", undefined, loc), analyseEconomics(s, { costFactor: 1.1 })]];
  const flags = [];
  if (core.contribution <= 0) flags.push(_bmT("Each sale loses money before fixed costs: the price is at or below the variable cost.", undefined, loc));
  if (core.breakEven !== null && core.breakEven > core.capacity) flags.push(_bmT("Break-even needs {breakEven} customers a period but your time allows {capacity}.", { breakEven: core.breakEven, capacity: core.capacity }, loc));
  if (base.year1Profit < 0) flags.push(_bmT("Year 1 loses money on operations.", undefined, loc));
  if (base.paybackMonth === null) flags.push(_bmT("The startup spend is not earned back within year 1.", undefined, loc));
  return {
    ok: true,
    price: s.price,
    ...core,
    marginAtPlan: base.marginAtPlan,
    planCustomers: base.planCustomers,
    startup: s.startup,
    ramp: s.ramp,
    months: base.months,
    year1Revenue: base.year1Revenue,
    year1Profit: base.year1Profit,
    year1AfterStartup: base.year1AfterStartup,
    paybackMonth: base.paybackMonth,
    cashNeeded: base.cashNeeded,
    sensitivity: cases.map(([name, a]) => ({ name, price: a.price, margin: a.price > 0 ? money2((a.contribution / a.price) * 100) / 100 : null, marginAtPlan: a.marginAtPlan, breakEven: a.breakEven, year1Profit: a.year1Profit })),
    flags,
  };
}
function formatMargin(m, locale) {
  if (m === null || m === undefined || !Number.isFinite(m)) return _bmT("not available", undefined, locale);
  return _bmI ? (Math.round(m * 1000) === 0 ? 0 : m).toLocaleString(_bmL(locale), { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 1 }).replace(/\u00a0%/, "%") : String(Math.round(m * 1000) / 10).replace(/^-0$/, "0") + "%";
}
function missingText(m, locale) {
  const names = (list) => list.map((k) => _bmLabel(k, locale)).join(", ");
  return [m.missing.length ? _bmT("Missing: {names}.", { names: names(m.missing) }, locale) : "", m.invalid.length ? _bmT("Cannot be negative: {names}.", { names: names(m.invalid) }, locale) : ""].filter(Boolean).join(" ");
}
if (typeof module !== "undefined") module.exports = { businessMath, unitEconomics, DEFAULT_RAMP, parseAmount, formatMargin, missingText, BUSINESS_MATH_INPUTS };
