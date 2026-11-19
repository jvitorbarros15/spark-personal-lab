"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createServer } = require("./server.cjs");
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spark-backup-"));
  const server = createServer({ directory, backupInterval: 300 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, data) => {
    const res = await fetch(base + url, {
      method,
      headers: data === undefined ? {} : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    assert.ok(res.ok, `${method} ${url} ${res.status}`);
    return res.json();
  };
  const newest = async () => (await call("GET", "/api/backups")).backups[0];
  const record = await call("POST", "/api/records", { type: "idea", stage: "draft", title: "First", fields: {}, links: [] });
  const afterCreate = await newest();
  assert.ok(afterCreate, "A new entry should back up immediately.");
  await call("PATCH", "/api/records/" + record.id, { title: "Typing" });
  await call("PATCH", "/api/records/" + record.id, { title: "Typing more" });
  assert.equal(await newest(), afterCreate, "Edits inside the window should wait.");
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.notEqual(await newest(), afterCreate, "The last edit should get a trailing backup.");
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  console.log("PASS: edit backups are throttled, with a trailing backup after the window.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
