"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { fail, validateRecord, needsReview } = require("./store.cjs");

const IDEA_LABELS = { solution: "What it is", audience: "Who it is for", payment: "How it earns money", alternatives: "What people do today", nextStep: "Next step", price: "Price", currency: "Currency", variableCost: "Variable cost per sale", fixedCosts: "Fixed costs", hoursPerCustomer: "Hours per customer", availableHours: "Hours available" };
const SKIP_DIRS = new Set(["answers", "cards", "briefs"]);
const SKIP_FILES = new Set(["idea.md", "pitch.md", "brief.md"]);
const MAX_FILES = 30,
  MAX_BYTES = 500000;
const COMMANDS = ["/founder-board", "/founder-competitors", "/founder-consumer --quick", "/founder-pricing", "/founder-marketing"];

const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40).replace(/^-|-$/g, "") || "idea";
const clip = (v, max) => String(v ?? "").trim().slice(0, max);

function createFounder({ directory, store, dealPersonas }) {
  const root = path.join(directory, "founder");
  const ideaOf = (id) => {
    const idea = store.get("records", id);
    if (!idea || idea.deleted || idea.type !== "idea") fail("Idea not found.", 404);
    return idea;
  };
  const slugOf = (idea) => `${slugify(idea.title)}-${idea.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 6)}`;
  const linked = (idea, type) => store.list("records").filter((r) => r.type === type && !r.deleted && (r.links.includes(idea.id) || idea.links.includes(r.id)));

  function profile(idea) {
    for (const r of linked(idea, "note")) {
      if (!r.title.startsWith("Customer profile") || needsReview(r)) continue;
      try {
        const c = JSON.parse(r.body);
        dealPersonas(c, { n: 1 });
        return c;
      } catch {}
    }
    return null;
  }

  function exportIdea(id) {
    const idea = ideaOf(id),
      folder = path.join(root, slugOf(idea)),
      lines = [`# ${idea.title}`, ""];
    if (idea.body.trim()) lines.push(idea.body.trim(), "");
    for (const [k, label] of Object.entries(IDEA_LABELS)) if (String(idea.fields[k] ?? "").trim()) lines.push(`**${label}:** ${idea.fields[k].trim()}`, "");
    const md = lines.join("\n"),
      customer = profile(idea),
      files = [];
    const dir = path.join(folder, "founder");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "idea.md"), md);
    files.push(path.join(dir, "idea.md"));
    if (customer) {
      fs.writeFileSync(path.join(dir, "customer.json"), JSON.stringify(customer, null, 2));
      files.push(path.join(dir, "customer.json"));
    }
    return {
      folder,
      files,
      customer: !!customer,
      commands: [`cd "${folder}"`, "claude", ...COMMANDS],
      note: "Run these yourself in a terminal, from that folder: the skills read and write its founder/ subfolder. Spark never starts Claude Code. When the skills finish, come back and press Import.",
    };
  }

  function collect(folder) {
    const found = [];
    const walk = (dir, depth) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.isSymbolicLink()) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (depth < 2 && !SKIP_DIRS.has(e.name)) walk(full, depth + 1);
          continue;
        }
        const md = e.name.endsWith(".md") && !SKIP_FILES.has(e.name),
          panel = e.name === "results.json" && path.basename(dir) === "panel";
        if ((md || panel) && fs.statSync(full).size <= MAX_BYTES) found.push({ full, name: e.name, dir });
      }
    };
    walk(folder, 0);
    return found.slice(0, MAX_FILES);
  }

  function importIdea(id) {
    const idea = ideaOf(id),
      folder = path.join(root, slugOf(idea));
    if (!fs.existsSync(folder)) fail("Export the idea first, then run the skills in that folder.", 404);
    const runId = crypto.randomUUID(),
      made = [],
      skipped = [];
    const existing = linked(idea, "note");
    for (const f of collect(folder)) {
      const isPanel = f.name === "results.json",
        skill = isPanel ? "founder-consumer" : "founder-" + f.name.replace(/\.md$/, "").replace(/^results$/, "consumer").replace(/[^\w-]/g, "").slice(0, 30);
      let raw = fs.readFileSync(f.full, "utf8"),
        title = "";
      if (isPanel) {
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          skipped.push({ file: path.relative(folder, f.full), reason: "not valid JSON" });
          continue;
        }
        const rate = [data.buyRate, data.buy_rate, data.tally?.buyRate].find((v) => typeof v === "number");
        raw = `Simulated customer panel run in Claude Code. Not real customers; an upper bound, not evidence of demand.${rate !== undefined ? `\nBuy rate: ${Math.round((rate <= 1 ? rate * 100 : rate))}%` : ""}\n\n${JSON.stringify(data, null, 2)}`;
        title = "Customer panel results (Claude Code, simulated)";
      } else title = `${f.name.replace(/\.md$/, "").replace(/^./, (c) => c.toUpperCase())} from Claude Code (simulated)`;
      const body = clip(raw, 100000);
      if (existing.some((r) => r.title === title && r.body === body)) {
        skipped.push({ file: path.relative(folder, f.full), reason: "already imported" });
        continue;
      }
      const rec = store.put(
        "records",
        validateRecord({ type: "note", stage: "draft", title, body, links: [idea.id], origin: { by: "simulation", runId, stage: skill, model: "Claude Code" }, reviewed: null }),
      );
      existing.push(rec);
      made.push({ id: rec.id, title, file: path.relative(folder, f.full) });
    }
    if (made.length) store.backup();
    return { folder, created: made, skipped };
  }

  return { exportIdea, importIdea, slugOf };
}
module.exports = { createFounder, slugify, IDEA_LABELS, clip };
