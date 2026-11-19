"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createServer } = require("./server.cjs");
const { slugify } = require("./founder.cjs");

async function main() {
  assert.equal(slugify("Quantum algorithms: for telescopes!"), "quantum-algorithms-for-telescopes");
  assert.ok(!/child_process/.test(fs.readFileSync(path.join(__dirname, "founder.cjs"), "utf8")));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spark-founder-")),
    server = createServer({ directory });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (p, method = "GET", data) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(data || {}) });
    return { status: r.status, body: await r.json() };
  };
  const idea = (await api("/api/records", "POST", { type: "idea", stage: "draft", title: "Quantum telescope tool", body: "Notes here", fields: { solution: "Filters", audience: "Astronomers", price: "9" } })).body;
  assert.equal((await api("/api/ideas/nope/founder-export", "POST")).status, 404);
  assert.equal((await api(`/api/ideas/${idea.id}/founder-import`, "POST")).status, 404);

  let out = (await api(`/api/ideas/${idea.id}/founder-export`, "POST")).body;
  assert.ok(out.folder.startsWith(path.join(directory, "founder", "quantum-telescope-tool-")));
  const nested = path.join(out.folder, "founder");
  assert.ok(!fs.existsSync(path.join(out.folder, "idea.md")));
  const md = fs.readFileSync(path.join(nested, "idea.md"), "utf8");
  assert.match(md, /# Quantum telescope tool/);
  assert.match(md, /\*\*Who it is for:\*\* Astronomers/);
  assert.equal(out.customer, false);
  assert.ok(!fs.existsSync(path.join(nested, "customer.json")));
  assert.deepEqual(out.commands.slice(0, 2), [`cd "${out.folder}"`, "claude"]);
  for (const c of ["/founder-board", "/founder-consumer --quick", "/founder-pricing"]) assert.ok(out.commands.includes(c));

  const profile = { business: "Scope", target: "Astronomers", segments: [{ name: "A", share: 1, income: [1000, 2000] }], behaviours: [{ name: "B", share: 1 }], objections: ["No"] };
  const draft = (await api("/api/records", "POST", { type: "note", stage: "draft", title: "Customer profile (simulated draft)", body: JSON.stringify(profile), links: [idea.id], origin: { by: "simulation" } })).body;
  assert.equal((await api(`/api/ideas/${idea.id}/founder-export`, "POST")).body.customer, false);
  await api(`/api/assistant/review`, "POST", { action: "accept", ids: [draft.id] });
  out = (await api(`/api/ideas/${idea.id}/founder-export`, "POST")).body;
  assert.equal(out.customer, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(nested, "customer.json"), "utf8")), profile);

  fs.mkdirSync(path.join(nested, "panel", "answers"), { recursive: true });
  fs.writeFileSync(path.join(nested, "board.md"), "# Board\nVerdict: FUND IF pilot");
  fs.writeFileSync(path.join(out.folder, "competitors.md"), "# Competitors\nAstroSoft");
  fs.writeFileSync(path.join(nested, "panel", "results.json"), JSON.stringify({ buyRate: 0.35, bySegment: [] }));
  fs.writeFileSync(path.join(nested, "panel", "answers", "P001.md"), "should be skipped");
  fs.writeFileSync(path.join(nested, "pitch.md"), "skipped");

  const imp = (await api(`/api/ideas/${idea.id}/founder-import`, "POST")).body;
  assert.deepEqual(imp.created.map((x) => x.file).sort(), [path.join("founder", "board.md"), path.join("founder", "panel", "results.json"), "competitors.md"].sort());
  const notes = server.store.list("records").filter((r) => imp.created.some((c) => c.id === r.id));
  assert.equal(notes.length, 3);
  for (const n of notes) {
    assert.equal(n.origin.by, "simulation");
    assert.equal(n.origin.model, "Claude Code");
    assert.equal(n.reviewed, null);
    assert.deepEqual(n.links, [idea.id]);
    assert.deepEqual(n.fields, {});
  }
  assert.deepEqual(notes.map((n) => n.origin.stage).sort(), ["founder-board", "founder-competitors", "founder-consumer"]);
  assert.match(notes.find((n) => n.origin.stage === "founder-consumer").body, /Buy rate: 35%/);
  const again = (await api(`/api/ideas/${idea.id}/founder-import`, "POST")).body;
  assert.equal(again.created.length, 0);
  assert.equal(again.skipped.filter((s) => s.reason === "already imported").length, 3);
  await new Promise((r) => server.close(r));
  console.log("founder bridge tests passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
