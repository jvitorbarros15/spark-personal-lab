"use strict";
const assert = require("node:assert/strict");
const { businessMath, unitEconomics, DEFAULT_RAMP, parseAmount, formatMargin, missingText } = require("./dist/assets/business-math.js");
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
assert.deepEqual(parseAmount("2,5"), { n: 2.5 });
assert.deepEqual(parseAmount("1,000"), { blank: true }, "never read as 1.0");

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
assert.equal(formatMargin(null), "not available");
assert.equal(formatMargin(NaN), "not available");

// unit economics (ported from founder-cfo)
const ue = (over = {}) => unitEconomics({ ...base, startup: "200", ...over });
let u = ue();
assert.equal(u.ok, true);
assert.equal(u.contribution, 70);
assert.equal(u.breakEven, 8);
assert.equal(u.capacity, 50);
assert.equal(u.months.length, 12);
assert.deepEqual(u.ramp, DEFAULT_RAMP);
assert.equal(u.planCustomers, 45);
assert.ok(Math.abs(u.marginAtPlan - (70 - 500 / 45) / 100) < 1e-9, "profit margin at plan volume after fixed costs");
assert.deepEqual(u.months[0], { month: 1, customers: 10, revenue: 1000, profit: 200, cumulative: 0 }, "10 customers x 70 - 500 = 200 profit; cumulative after 200 startup is 0");
assert.equal(u.paybackMonth, 1);
assert.equal(u.cashNeeded, 200, "cash needed is the startup spend when no month loses money");
assert.equal(u.year1Profit, u.months.reduce((a, m) => a + m.profit, 0));
assert.equal(u.year1AfterStartup, u.year1Profit - 200);
assert.deepEqual(u.sensitivity.map((x) => x.name), ["Base plan", "Price -10%", "Sales -20%", "Costs +10%"]);
assert.equal(u.sensitivity[1].price, 90);
assert.equal(u.sensitivity[1].breakEven, 9, "ceil(500 / 60)");
assert.equal(u.sensitivity[3].breakEven, 9, "variable 33, fixed 550: ceil(550 / 67)");
assert.ok(u.sensitivity[2].year1Profit < u.year1Profit, "sales -20% lowers year 1 profit");
assert.deepEqual(u.flags, []);

u = ue({ fixedCosts: "5000", startup: "10000" });
assert.ok(u.cashNeeded > 10000, "monthly losses dig a deeper hole than the startup spend");
assert.ok(u.flags.some((f) => /Year 1 loses money/.test(f)));
assert.ok(u.flags.some((f) => /Break-even needs 72 customers/.test(f)));
assert.equal(u.paybackMonth, null);
assert.ok(u.flags.some((f) => /not earned back within year 1/.test(f)));
u = ue({ price: "20", variableCost: "30" });
assert.equal(u.breakEven, null);
assert.ok(u.flags.some((f) => /loses money/.test(f)));
assert.ok(u.months.every((m) => Number.isFinite(m.profit)));
assert.equal(ue({ ramp: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }).planCustomers, 50);
assert.deepEqual(ue({ ramp: [1, 2] }).ramp, DEFAULT_RAMP, "a ramp that is not 12 numbers falls back");
assert.equal(unitEconomics({ ...base, price: "" }).ok, false);
assert.deepEqual(unitEconomics({ ...base, price: "" }).missing, ["price"]);
for (const k of ["contribution", "margin", "marginAtPlan", "breakEven", "profitAtCapacity", "year1Profit", "cashNeeded"]) assert.ok(u[k] === null || Number.isFinite(u[k]), k);

console.log("Business math tests passed");
