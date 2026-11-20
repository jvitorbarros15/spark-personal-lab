"use strict";
const fs = require("node:fs");

function readJson(file, message) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw Error(message);
    return {};
  }
}

function writeJson(file, value, options) {
  const temporary = file + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), options);
  fs.renameSync(temporary, file);
}

module.exports = { readJson, writeJson };
