"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { dataDirectory, migrateLegacyData } = require("./data-dir.cjs");

assert.equal(dataDirectory({ SPARK_DATA_DIR: "rel/dir" }), path.resolve("rel/dir"));
assert.equal(dataDirectory({ LOCALAPPDATA: "C:\\L" }, "win32"), path.join("C:\\L", "Spark"));
assert.equal(dataDirectory({ XDG_DATA_HOME: "/x" }, "linux"), path.join("/x", "spark"));
assert.equal(dataDirectory({}, "darwin"), path.join(os.homedir(), "Library", "Application Support", "Spark"));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "spark-data-dir-"));
const open = [];
try {
  const legacy = path.join(root, "legacy"),
    target = path.join(root, "new");
  fs.mkdirSync(path.join(legacy, "attachments"), { recursive: true });
  const writer = new DatabaseSync(path.join(legacy, "spark.sqlite"));
  open.push(writer);
  writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('kept')");
  fs.writeFileSync(path.join(legacy, "attachments", "abc"), "bytes");
  fs.writeFileSync(path.join(legacy, "secrets.json"), '{"openai":"key"}');
  const before = fs.readFileSync(path.join(legacy, "secrets.json"));

  assert.equal(migrateLegacyData(target, legacy), target);
  writer.close();
  open.pop();

  const copied = new DatabaseSync(path.join(target, "spark.sqlite"));
  open.push(copied);
  assert.equal(copied.prepare("SELECT v FROM t").get().v, "kept");
  copied.close();
  open.pop();
  assert.equal(fs.readFileSync(path.join(target, "attachments", "abc"), "utf8"), "bytes");
  assert.equal(fs.readFileSync(path.join(target, "secrets.json"), "utf8"), '{"openai":"key"}');
  assert.match(fs.readFileSync(path.join(legacy, "MOVED.txt"), "utf8"), new RegExp(target.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")));
  assert.ok(fs.existsSync(path.join(legacy, "spark.sqlite")));
  assert.deepEqual(fs.readFileSync(path.join(legacy, "secrets.json")), before);

  assert.equal(migrateLegacyData(target, legacy), null);

  const occupied = path.join(root, "occupied"), noDb = path.join(root, "nodb");
  fs.mkdirSync(occupied);
  fs.writeFileSync(path.join(occupied, "spark.sqlite"), "existing");
  assert.equal(migrateLegacyData(occupied, legacy), null);
  assert.equal(fs.readFileSync(path.join(occupied, "spark.sqlite"), "utf8"), "existing");
  assert.equal(migrateLegacyData(noDb, path.join(root, "absent")), null);
  assert.equal(fs.existsSync(noDb), false);
} finally {
  for (const db of open) db.close();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Data directory tests passed");
