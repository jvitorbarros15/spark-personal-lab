"use strict";
const BUSINESS_MATH_INPUTS = ["price", "variableCost", "fixedCosts", "hoursPerCustomer", "availableHours"];
function businessMath(input) {
  const v = {}, missing = [];
  for (const key of BUSINESS_MATH_INPUTS) {
    const raw = String(input?.[key] ?? "").trim();
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n) || n < 0) missing.push(key);
    else v[key] = n;
  }
  const has = (k) => v[k] !== undefined;
  const contribution = has("price") && has("variableCost") ? v.price - v.variableCost : null;
  const margin = contribution !== null && v.price > 0 ? contribution / v.price : null;
  const breakEven = contribution > 0 && has("fixedCosts") ? Math.ceil(v.fixedCosts / contribution) : null;
  const capacity = v.hoursPerCustomer > 0 && has("availableHours") ? Math.floor(v.availableHours / v.hoursPerCustomer) : null;
  const profitAtCapacity = capacity !== null && contribution !== null && has("fixedCosts") ? capacity * contribution - v.fixedCosts : null;
  const warnings = [];
  if (contribution !== null && contribution <= 0) warnings.push("Each sale loses money: price does not cover variable cost.");
  if (breakEven !== null && capacity !== null && breakEven > capacity) warnings.push("Break-even needs more customers than you have time for.");
  if (v.hoursPerCustomer === 0) warnings.push("Time per customer must be above zero.");
  return { missing, contribution, margin, breakEven, capacity, profitAtCapacity, warnings };
}
if (typeof module !== "undefined") module.exports = { businessMath };
