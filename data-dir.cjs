"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const LEGACY = path.join(__dirname, "data");

function dataDirectory(env = process.env, platform = process.platform) {
  if (env.SPARK_DATA_DIR) return path.resolve(env.SPARK_DATA_DIR);
  if (platform === "win32")
    return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Spark");
  if (platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "Spark");
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "spark");
}

function migrateLegacyData(directory, legacy = LEGACY) {
  const legacyDb = path.join(legacy, "spark.sqlite");
  if (path.resolve(directory) === path.resolve(legacy)) return null;
  if (fs.existsSync(path.join(directory, "spark.sqlite")) || !fs.existsSync(legacyDb)) return null;
  const existed = fs.existsSync(directory);
  const db = new DatabaseSync(legacyDb);
  try {
    if (db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy)
      throw Error(`Spark data is busy at ${legacyDb}. Close other Spark processes and start again.`);
  } finally {
    db.close();
  }
  try {
    const isDb = (src) => /^spark\.sqlite(-wal|-shm)?$/.test(path.basename(src)) && path.dirname(src) === legacy;
    fs.cpSync(legacy, directory, { recursive: true, filter: (src) => !isDb(src) });
    // spark.sqlite is copied last: its presence marks a completed migration.
    fs.copyFileSync(legacyDb, path.join(directory, "spark.sqlite"));
  } catch (e) {
    if (!existed) fs.rmSync(directory, { recursive: true, force: true });
    throw Error(
      `Could not move Spark data from ${legacy} to ${directory}: ${e.message}. Your original data is unchanged. Fix the problem and start Spark again.`,
    );
  }
  fs.writeFileSync(
    path.join(legacy, "MOVED.txt"),
    `Spark's workspace moved to:\n${directory}\n\nThis folder is no longer used. After checking that Spark shows your data at the new location, you can delete this folder.\n`,
  );
  console.log(`Moved Spark data from ${legacy} to ${directory}. See MOVED.txt in the old folder.`);
  return directory;
}

module.exports = { dataDirectory, migrateLegacyData };
