"use strict";
const assert = require("node:assert/strict");
const { businessMath } = require("./dist/assets/business-math.js");
const base = { price: "100", variableCost: "30", fixedCosts: "500", hoursPerCustomer: "2", availableHours: "100" };
const run = (over) => businessMath({ ...base, ...over });

assert.deepEqual(run({}), { missing: [], contribution: 70, margin: 0.7, breakEven: 8, capacity: 50, profitAtCapacity: 3000, warnings: [] });

let r = run({ price: "" });
assert.deepEqual(r.missing, ["price"]);
assert.equal(r.contribution, null);
assert.equal(r.breakEven, null);
assert.equal(r.capacity, 50);

assert.deepEqual(businessMath({ currency: "USD" }).missing, ["price", "variableCost", "fixedCosts", "hoursPerCustomer", "availableHours"]);
assert.deepEqual(run({ fixedCosts: "-5" }).missing, ["fixedCosts"]);

r = run({ variableCost: "100" });
assert.equal(r.contribution, 0);
assert.equal(r.breakEven, null);
assert.deepEqual(r.warnings, ["Each sale loses money: price does not cover variable cost."]);

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

console.log("Business math tests passed");
