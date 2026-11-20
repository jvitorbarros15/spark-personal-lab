"use strict";
const os = require("node:os"),
  path = require("node:path");

function dataDirectory(env = process.env, platform = process.platform) {
  if (env.SPARK_DATA_DIR) return path.resolve(env.SPARK_DATA_DIR);
  if (platform === "win32")
    return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Spark");
  if (platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "Spark");
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "spark");
}

module.exports = { dataDirectory };
