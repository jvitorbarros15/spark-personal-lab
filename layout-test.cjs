"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLayout } = require("./layout.cjs");
const { createServer } = require("./server.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-layout-"));
let layout = createLayout({ directory: dir });
assert.deepEqual(layout.get(), {});

const idea = [{ id: "hero", w: 2, h: "full" }, { id: "charts", w: 2, h: "compact" }, { id: "details", w: 1, h: "full" }];
assert.deepEqual(layout.update({ type: "idea", layout: idea }), { idea });
assert.ok(fs.existsSync(path.join(dir, "ui-layout.json")));
assert.ok(!fs.existsSync(path.join(dir, "ui-layout.json.tmp")));

layout = createLayout({ directory: dir });
assert.deepEqual(layout.get(), { idea }, "survives a restart");
assert.deepEqual(layout.update({ type: "note", layout: [{ id: "details", w: 3, h: "full" }] }).note, [{ id: "details", w: 3, h: "full" }], "one layout per entry type");
assert.deepEqual(layout.get().idea, idea);

for (const bad of [
  { type: "nope", layout: idea },
  { type: "idea", layout: "x" },
  { type: "idea", layout: [{ id: "Hero", w: 1, h: "full" }] },
  { type: "idea", layout: [{ id: "a", w: 4, h: "full" }] },
  { type: "idea", layout: [{ id: "a", w: 1, h: "tall" }] },
  { type: "idea", layout: [{ id: "a", w: 1, h: "full" }, { id: "a", w: 1, h: "full" }] },
  { type: "idea", layout: Array.from({ length: 21 }, (_, i) => ({ id: "c" + i, w: 1, h: "full" })) },
]) assert.throws(() => layout.update(bad), (e) => e.status === 400);
assert.deepEqual(layout.get().idea, idea, "a rejected update changes nothing");

assert.deepEqual(layout.update({ type: "idea", layout: null }).idea, undefined, "reset removes the saved layout");
assert.deepEqual(Object.keys(layout.get()), ["note"]);

fs.writeFileSync(path.join(dir, "ui-layout.json"), JSON.stringify({ idea: [{ id: "x", w: 9, h: "full" }], note: [{ id: "details", w: 1, h: "full" }] }));
assert.deepEqual(Object.keys(createLayout({ directory: dir }).get()), ["note"], "an invalid saved layout is ignored, not fatal");
fs.writeFileSync(path.join(dir, "ui-layout.json"), "{ not json");
assert.throws(() => createLayout({ directory: dir }), /ui-layout\.json/);

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spark-layout-api-")),
    server = createServer({ directory });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (p, method = "GET", data) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
    return { status: r.status, body: await r.json() };
  };
  assert.deepEqual((await api("/api/ui-layout")).body, {});
  const saved = await api("/api/ui-layout", "POST", { type: "idea", layout: idea });
  assert.equal(saved.status, 200);
  assert.deepEqual((await api("/api/state")).body.layouts, { idea });
  assert.equal((await api("/api/ui-layout", "POST", { type: "idea", layout: [{ id: "a", w: 7, h: "full" }] })).status, 400);
  assert.deepEqual((await api("/api/ui-layout", "POST", { type: "idea", layout: null })).body, {});
  await new Promise((r) => server.close(r));
  console.log("Layout tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
