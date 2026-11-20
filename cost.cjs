"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { fail } = require("./store.cjs");

const PRICES_NOTE = "Prices per 1M tokens as of 2026-11-19, source ollama.com/pricing. Edit them if Ollama changes its rates.";
const DEFAULT_PRICES = {
  "deepseek-v4.1-flash": { input: 0.3, cached: 0.006, output: 1.2, off: { input: 0.15, cached: 0.003, output: 0.6 } },
  "deepseek-v4-pro": { input: 1.32, cached: 0.044, output: 3.96, off: { input: 0.66, cached: 0.022, output: 1.98 } },
  "kimi-k3": { input: 3, cached: 0.3, output: 15 },
  "glm-5.3": { input: 1.4, cached: 0.26, output: 4.4 },
  "gpt-oss:120b": { input: 0.15, cached: 0.014, output: 0.6 },
};
const DEFAULT_BUDGET = 5;
const DEFAULT_TOKENS = { test: { input: 45000, output: 15000 }, research: { input: 40000, output: 10000 } };
const MAX_OUTPUT = 4096;

const isCloudName = (model) => /[:-]cloud$/i.test(String(model || "").trim());
const isCloud = (agent, localTrusted = true) => !!agent && (agent.provider !== "local" || !localTrusted || isCloudName(agent.model));
const baseName = (model) => String(model || "").trim().toLowerCase().replace(/[:-]cloud$/, "");

function isOffPeak(date) {
  const d = new Date(date),
    day = d.getUTCDay(),
    h = d.getUTCHours();
  return day === 0 || day === 6 || h < 12 || h >= 18;
}
function nextOffPeak(date) {
  const d = new Date(date);
  if (isOffPeak(d)) return d;
  const t = new Date(d);
  t.setUTCHours(18, 0, 0, 0);
  return t;
}

function priceFor(agent, prices, localTrusted = true) {
  if (!isCloud(agent, localTrusted)) return { free: true };
  const name = baseName(agent.model),
    p = prices[`${agent.provider}:${name}`] || prices[name];
  return p || null;
}
const money = (v) => Math.round(v * 1e6) / 1e6;
function callCost(tokensIn, tokensOut, price, offPeak) {
  if (!price) return null;
  if (price.free) return 0;
  const p = offPeak && price.off ? price.off : price;
  return money((tokensIn * p.input + tokensOut * p.output) / 1e6);
}

const num = (v, label, max = 100000) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) fail(`${label} must be a number from 0 to ${max}.`);
  return n;
};
function cleanPrice(p, name) {
  if (!p || typeof p !== "object") fail(`Invalid price for ${name}.`);
  const out = { input: num(p.input, "Input price"), cached: num(p.cached ?? 0, "Cached price"), output: num(p.output, "Output price") };
  if (p.off) out.off = { input: num(p.off.input, "Off-peak input price"), cached: num(p.off.cached ?? 0, "Off-peak cached price"), output: num(p.off.output, "Off-peak output price") };
  return out;
}

function validateUsage(u) {
  if (!u || typeof u !== "object") fail("Invalid usage row.");
  const text = (v, n) => String(v ?? "").slice(0, n),
    count = (v) => Math.max(0, Math.floor(Number(v) || 0)),
    cost = u.costUsd === null || u.costUsd === undefined ? null : Number(u.costUsd);
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) fail("Invalid usage cost.");
  if (!text(u.id, 100)) fail("Invalid usage row.");
  return {
    id: text(u.id, 100),
    at: text(u.at, 50),
    provider: text(u.provider, 50),
    model: text(u.model, 200),
    cloud: !!u.cloud,
    stage: text(u.stage, 100),
    runId: text(u.runId, 100),
    tokensIn: count(u.tokensIn),
    tokensOut: count(u.tokensOut),
    costUsd: cost,
    offPeak: !!u.offPeak,
    estimated: !!u.estimated,
    note: text(u.note, 300),
  };
}

function createCost({ directory, store, providers, localModel, clock = () => new Date(), budgetUsd, localOnly = false, gpu = null }) {
  const file = path.join(directory, "cost-settings.json");
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw Error("Cannot read data/cost-settings.json. Fix the JSON before starting Spark.");
  }
  const settings = () => ({ budget: budgetUsd ?? saved.budget ?? DEFAULT_BUDGET, prices: saved.prices || DEFAULT_PRICES, pricesNote: PRICES_NOTE });
  function update(data) {
    if (!data || typeof data !== "object") fail("Invalid cost settings.");
    const next = { ...saved };
    if (data.budget !== undefined && budgetUsd !== undefined) fail("The owner sets this budget.", 403);
    if (data.budget !== undefined) next.budget = num(data.budget, "The monthly budget", 100000);
    if (data.prices !== undefined) {
      if (!data.prices || typeof data.prices !== "object" || Object.keys(data.prices).length > 200) fail("Invalid price table.");
      next.prices = Object.fromEntries(Object.entries(data.prices).map(([k, v]) => [baseName(k.slice(0, 200)), cleanPrice(v, k)]));
    }
    const temporary = file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2));
    fs.renameSync(temporary, file);
    saved = next;
    return settings();
  }

  const month = (d = clock()) => new Date(d).toISOString().slice(0, 7);
  const trusted = () => providers.localTrusted?.() ?? true;
  const cloudAgent = (a) => isCloud(a, trusted());
  const J = (k) => `json_extract(json,'$.${k}')`;
  const AGG = `COUNT(*) calls, SUM(${J("tokensIn")}) tin, SUM(${J("tokensOut")}) tout, SUM(${J("costUsd")}) cost, SUM(${J("costUsd")} IS NULL) unknown`;
  const bucket = (r) => ({ calls: r.calls, tokensIn: r.tin || 0, tokensOut: r.tout || 0, costUsd: money(r.cost || 0), unknown: r.unknown || 0 });
  const monthRows = (group, m) =>
    Object.fromEntries(store.db.prepare(`SELECT ${group} k, ${AGG} FROM usage WHERE ${J("cloud")}=1 AND ${J("at")} LIKE ? GROUP BY k`).all(m + "%").map((r) => [r.k, bucket(r)]));
  function summary() {
    const s = settings(),
      m = month(),
      total = store.db.prepare(`SELECT ${AGG} FROM usage WHERE ${J("cloud")}=1 AND ${J("at")} LIKE ?`).get(m + "%"),
      byRun = Object.fromEntries(
        store.db.prepare(`SELECT ${J("runId")} k, ${AGG}, SUM(${J("cloud")}=1) cloudCalls FROM usage WHERE ${J("runId")}<>'' GROUP BY k`).all().map((r) => [r.k, { ...bucket(r), cloudCalls: r.cloudCalls || 0 }]),
      );
    return {
      month: m,
      spent: money(total.cost || 0),
      unknownCalls: total.unknown || 0,
      budget: s.budget,
      byModel: monthRows(J("model"), m),
      byFeature: monthRows(`COALESCE(NULLIF(substr(${J("stage")},1,instr(${J("stage")}||':',':')-1),''),'other')`, m),
      byRun,
      settings: s,
    };
  }
  const spent = () => money(store.db.prepare(`SELECT SUM(${J("costUsd")}) cost FROM usage WHERE ${J("cloud")}=1 AND ${J("at")} LIKE ?`).get(month() + "%").cost || 0);
  const sum = (list, key) => list.reduce((a, r) => a + (r[key] || 0), 0);

  function localFallback() {
    if (!trusted()) fail("No truly local model: the local endpoint is not Ollama on 127.0.0.1:11434 and is not marked as local and private in Settings, so Spark treats it as a cloud route.", 409);
    const m = localModel?.();
    if (!m?.model) fail("This needs a local model. Choose a local planner model in Settings.", 409);
    return { provider: "local", model: m.model };
  }
  const estimateTokens = (messages) => Math.ceil(messages.reduce((a, m) => a + String(m.content || "").length, 0) / 4);

  function record(row) {
    return store.put("usage", validateUsage({ id: crypto.randomUUID(), at: clock().toISOString(), ...row }));
  }

  let reserved = 0;
  async function generate(agent, messages, signal, onDelta, rest = {}, meta = {}) {
    const s = settings();
    const offPeak = isOffPeak(clock());
    let use = agent,
      note = "",
      held = 0;
    if (cloudAgent(use)) {
      if (localOnly) note = "local only: used local model";
      else if (meta.private) note = "private: used local model";
      else if (rest.schema) note = "structured output needs a local model: used local model";
      else {
        const price = priceFor(use, s.prices, trusted());
        if (!price) note = `no price set for ${use.model}: used local model`;
        else if (!price.free) {
          const estimate = callCost(estimateTokens(messages), rest.maxTokens || MAX_OUTPUT, price, offPeak);
          const total = spent() + reserved;
          if (total + estimate > s.budget) note = `budget: used local model (month-to-date $${total.toFixed(2)} + estimate $${estimate.toFixed(2)} would pass the $${s.budget} cap)`;
          else reserved += held = estimate;
        }
      }
      if (note) use = { ...agent, ...localFallback() };
    }
    meta.note?.(note);
    const cloud = cloudAgent(use);
    let result,
      streamed = 0;
    try {
      const call = (hold) =>
        providers.generate(use, messages, hold ? (signal ? AbortSignal.any([signal, hold]) : hold) : signal, (d) => {
          streamed += String(d ?? "").length;
          onDelta(d);
        }, rest);
      result = gpu && !cloud ? await gpu.run(call, signal) : await call();
    } catch (e) {
      if (cloud && streamed > 0) {
        const tokensIn = estimateTokens(messages),
          tokensOut = Math.ceil(streamed / 4);
        record({ provider: use.provider, model: use.model, cloud, stage: meta.stage || "", runId: meta.runId || "", tokensIn, tokensOut, costUsd: callCost(tokensIn, tokensOut, priceFor(use, s.prices, trusted()), offPeak), offPeak, estimated: true, note });
      }
      throw e;
    } finally {
      reserved -= held;
    }
    const
      reported = !!result.usage,
      tokensIn = result.usage?.input ?? estimateTokens(messages),
      tokensOut = result.usage?.output ?? Math.ceil(String(result.text || "").length / 4),
      costUsd = callCost(tokensIn, tokensOut, priceFor(use, s.prices, trusted()), offPeak);
    record({ provider: use.provider, model: use.model, cloud, stage: meta.stage || "", runId: meta.runId || "", tokensIn, tokensOut, costUsd, offPeak, estimated: !reported, note });
    return { ...result, usage: result.usage || { input: tokensIn, output: tokensOut }, costUsd, fellBack: !!note, note, used: { provider: use.provider, model: use.model, cloud } };
  }

  function estimateRun({ kind, stageModels, models, private: isPrivate = false, caps = {}, at = clock() }) {
    const s = settings(),
      past = {};
    for (const r of store.db.prepare(`SELECT ${J("runId")} id, SUM(${J("tokensIn")}) input, SUM(${J("tokensOut")}) output FROM usage WHERE ${J("stage")} LIKE ? AND ${J("runId")}<>'' GROUP BY id`).all(kind + ":%"))
      if (store.get("jobs", r.id)?.status === "done") past[r.id] = { input: r.input || 0, output: r.output || 0 };
    const history = Object.values(past),
      base = history.length ? { input: sum(history, "input") / history.length, output: sum(history, "output") / history.length } : DEFAULT_TOKENS[kind] || DEFAULT_TOKENS.test,
      calls = caps.calls || 0,
      tokens = {
        input: Math.round(calls ? Math.min(base.input, calls * 12000) : base.input),
        output: Math.round(calls ? Math.min(base.output, calls * MAX_OUTPUT) : base.output),
      };
    const each = { input: tokens.input / stageModels.length, output: tokens.output / stageModels.length };
    let now = 0,
      off = 0,
      unknown = false;
    for (const role of stageModels) {
      const agent = models[role];
      if (!agent || isPrivate || localOnly || (role === "planner" && cloudAgent(agent))) continue;
      const price = priceFor(agent, s.prices, trusted());
      if (!price) {
        unknown = true;
        continue;
      }
      now += callCost(each.input, each.output, price, isOffPeak(at));
      off += callCost(each.input, each.output, price, true);
    }
    const cheaperLater = !isOffPeak(at);
    return {
      tokensIn: tokens.input,
      tokensOut: tokens.output,
      basis: history.length ? `average of ${history.length} past ${kind} run${history.length === 1 ? "" : "s"}` : "typical run",
      costNowUsd: unknown ? null : money(now),
      costOffPeakUsd: unknown ? null : money(off),
      offPeakNow: !cheaperLater,
      nextOffPeak: nextOffPeak(at).toISOString(),
      private: isPrivate,
    };
  }

  return { settings, update, summary, generate, estimateRun, record, spent, cloudBlocked: () => localOnly || (budgetUsd !== undefined && spent() >= settings().budget), wrap: (p) => ({ ...p, generate }) };
}

module.exports = { createCost, validateUsage, isCloud, isCloudName, isOffPeak, nextOffPeak, priceFor, callCost, DEFAULT_PRICES, DEFAULT_BUDGET, PRICES_NOTE };
