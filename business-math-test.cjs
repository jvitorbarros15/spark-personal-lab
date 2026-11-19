"use strict";
const assert = require("node:assert/strict");
const { businessMath, formatMargin, missingText } = require("./dist/assets/business-math.js");
const base = { price: "100", variableCost: "30", fixedCosts: "500", hoursPerCustomer: "2", availableHours: "100" };
const run = (over) => businessMath({ ...base, ...over });

assert.deepEqual(run({}), { missing: [], invalid: [], contribution: 70, margin: 0.7, breakEven: 8, capacity: 50, profitAtCapacity: 3000, warnings: [] });

let r = run({ price: "" });
assert.deepEqual(r.missing, ["price"]);
assert.equal(r.contribution, null);
assert.equal(r.breakEven, null);
assert.equal(r.capacity, 50);

assert.deepEqual(businessMath({ currency: "USD" }).missing, ["price", "variableCost", "fixedCosts", "hoursPerCustomer", "availableHours"]);
r = run({ fixedCosts: "-5" });
assert.deepEqual(r.missing, []);
assert.deepEqual(r.invalid, ["fixedCosts"]);
assert.equal(r.breakEven, null);
assert.deepEqual(r.warnings, ["Fixed costs cannot be negative."]);
assert.equal(missingText(r), "Cannot be negative: fixed costs.");
assert.equal(missingText(run({ price: "", hoursPerCustomer: "" })), "Missing: price, hours per customer.");

r = run({ variableCost: "100" });
assert.equal(r.contribution, 0);
assert.equal(r.margin, 0);
assert.equal(r.breakEven, null);
assert.deepEqual(r.warnings, ["Each sale earns nothing: price only covers variable cost, so fixed costs are never paid back."]);

r = run({ price: "50", variableCost: "100" });
assert.equal(r.contribution, -50);
assert.equal(r.breakEven, null);
assert.equal(r.warnings.length, 1);

r = run({ hoursPerCustomer: "0" });
assert.equal(r.capacity, null);
assert.equal(r.profitAtCapacity, null);
assert.deepEqual(r.warnings, ["Time per customer must be above zero."]);

r = run({ price: "10", variableCost: "0", hoursPerCustomer: "3", availableHours: "10" });
assert.equal(r.breakEven, 50);
assert.equal(r.capacity, 3);
assert.equal(r.profitAtCapacity, -470);
assert.deepEqual(r.warnings, ["Break-even needs more customers than you have time for."]);

assert.equal(run({ price: "  100 ", variableCost: " 30" }).contribution, 70);
assert.equal(run({ price: "abc" }).contribution, null);

// floating point must not tip a whole division over the edge
r = businessMath({ price: "0.4", variableCost: "0.1", fixedCosts: "0.3", hoursPerCustomer: "0.1", availableHours: "0.3" });
assert.equal(r.contribution, 0.3);
assert.equal(r.breakEven, 1);
assert.equal(r.capacity, 3);
assert.equal(r.profitAtCapacity, 0.6);
r = businessMath({ price: "19.99", variableCost: "4.99", fixedCosts: "1500", hoursPerCustomer: "0.75", availableHours: "120" });
assert.equal(r.contribution, 15);
assert.equal(r.breakEven, 100);
assert.equal(r.capacity, 160);
assert.equal(r.profitAtCapacity, 900);

// a comma decimal is read as a decimal, not dropped
assert.equal(run({ price: "12,5", variableCost: "2,5" }).contribution, 10);
assert.equal(run({ price: "1,000" }).contribution, null);

// zero price: margin is undefined, never NaN or Infinity
r = run({ price: "0", variableCost: "0" });
assert.equal(r.margin, null);
assert.ok(r.warnings.includes("Price is zero, so margin is undefined."));
for (const x of [r, run({ price: "0" }), run({ hoursPerCustomer: "0" })]) for (const k of ["contribution", "margin", "breakEven", "capacity", "profitAtCapacity"]) assert.ok(x[k] === null || Number.isFinite(x[k]), k);

// zero fixed costs break even at zero customers
assert.equal(run({ fixedCosts: "0" }).breakEven, 0);

assert.equal(formatMargin(0.7), "70%");
assert.equal(formatMargin(0.7234), "72.3%");
assert.equal(formatMargin(1 / 3), "33.3%");
assert.equal(formatMargin(-0.3), "-30%");
assert.equal(formatMargin(null), "n/a");
assert.equal(formatMargin(NaN), "n/a");

console.log("Business math tests passed");
