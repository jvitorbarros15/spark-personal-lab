"use strict";
const BUSINESS_MATH_INPUTS = ["price", "variableCost", "fixedCosts", "hoursPerCustomer", "availableHours"];
const MATH_LABELS = { price: "price", variableCost: "variable cost", fixedCosts: "fixed costs", hoursPerCustomer: "hours per customer", availableHours: "available hours" };
const EPS = 1e-9;
function parseAmount(value) {
  let raw = String(value ?? "").trim();
  if (/^\d+,\d{1,2}$/.test(raw)) raw = raw.replace(",", ".");
  if (raw === "") return { blank: true };
  const n = Number(raw);
  return Number.isFinite(n) ? { n } : { blank: true };
}
const cleanDiv = (a, b, round) => {
  const q = a / b,
    r = Math.round(q);
  return round(Math.abs(q - r) < EPS ? r : q);
};
function businessMath(input) {
  const v = {}, missing = [], invalid = [];
  for (const key of BUSINESS_MATH_INPUTS) {
    const p = parseAmount(input?.[key]);
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
  for (const k of invalid) warnings.push(`${MATH_LABELS[k][0].toUpperCase() + MATH_LABELS[k].slice(1)} cannot be negative.`);
  if (contribution !== null && contribution < 0) warnings.push("Each sale loses money: price does not cover variable cost.");
  if (contribution === 0) warnings.push("Each sale earns nothing: price only covers variable cost, so fixed costs are never paid back.");
  if (has("price") && v.price === 0 && has("variableCost")) warnings.push("Price is zero, so margin is undefined.");
  if (breakEven !== null && capacity !== null && breakEven > capacity) warnings.push("Break-even needs more customers than you have time for.");
  if (v.hoursPerCustomer === 0) warnings.push("Time per customer must be above zero.");
  return { missing, invalid, contribution, margin, breakEven, capacity, profitAtCapacity, warnings };
}
function formatMargin(m) {
  if (m === null || m === undefined || !Number.isFinite(m)) return "n/a";
  return String(Math.round(m * 1000) / 10).replace(/^-0$/, "0") + "%";
}
function missingText(m) {
  const names = (list) => list.map((k) => MATH_LABELS[k] || k).join(", ");
  return [m.missing.length ? `Missing: ${names(m.missing)}.` : "", m.invalid.length ? `Cannot be negative: ${names(m.invalid)}.` : ""].filter(Boolean).join(" ");
}
if (typeof module !== "undefined") module.exports = { businessMath, formatMargin, missingText, BUSINESS_MATH_INPUTS };
