"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { openStore, validateRecord, validateArchive } = require("./store.cjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-competitor-"));
let store = openStore(dir);
try {
  const idea = validateRecord({ type: "idea", stage: "draft", title: "Idea", fields: { researchQueries: "alternatives to widgets" }, links: [] });
  const competitor = validateRecord({ type: "competitor", stage: "exploring", title: "Rival", fields: { website: "https://example.com", facts: "Offers widgets", pricing: "$10", audience: "Teams", sources: "https://example.com/pricing", researchedOn: "2026-11-18", gaps: "No offline mode" }, links: [idea.id] });
  store.put("records", idea);
  store.put("records", competitor);
  store.close();
  store = openStore(dir);
  assert.deepEqual(store.get("records", competitor.id).fields, competitor.fields);
  assert.deepEqual(store.get("records", competitor.id).links, [idea.id]);
  store.put("records", validateRecord({ ...competitor, fields: { ...competitor.fields, pricing: "$12" } }));
  assert.equal(store.get("records", competitor.id).fields.pricing, "$12");
  const restored = validateArchive(store.archive());
  assert.equal(restored.records.find((r) => r.id === competitor.id).fields.sources, "https://example.com/pricing");
  store.put("records", validateRecord({ ...competitor, deleted: new Date().toISOString() }));
  assert.ok(store.get("records", competitor.id).deleted);
  console.log("PASS: competitor fields, idea links, persistence, updates, archive and trash.");
} finally {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
