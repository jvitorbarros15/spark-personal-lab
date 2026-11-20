"use strict";
const assert = require("node:assert/strict"),
  os = require("node:os"),
  path = require("node:path");
const { dataDirectory } = require("./data-dir.cjs");

assert.equal(dataDirectory({ SPARK_DATA_DIR: "rel/dir" }), path.resolve("rel/dir"));
assert.equal(dataDirectory({ LOCALAPPDATA: "C:\L" }, "win32"), path.join("C:\L", "Spark"));
assert.equal(dataDirectory({ XDG_DATA_HOME: "/x" }, "linux"), path.join("/x", "spark"));
assert.equal(dataDirectory({}, "darwin"), path.join(os.homedir(), "Library", "Application Support", "Spark"));

console.log("Data directory tests passed");
