"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { fail } = require("./store.cjs");
const { devices } = require("./phone.cjs");

const LINK_TTL_MS = 24 * 3600 * 1000,
  STATUS_FRESH_MS = 45000,
  OWNER_PORT = 4173;
const TUNNEL_URL = /https:\/\/([a-z0-9]+(?:-[a-z0-9]+)+)\.trycloudflare\.com/i;

function parseTunnelUrl(text) {
  const m = String(text).match(TUNNEL_URL);
  return m ? `https://${m[1].toLowerCase()}.trycloudflare.com` : null;
}
const hostOf = (url) => new URL(url).host;
const slugOf = (name) =>
  String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

function cleanPerson(p) {
  if (!p || typeof p !== "object") fail("Invalid person.");
  const name = typeof p.name === "string" ? p.name.trim() : "";
  if (!name || name.length > 60) fail("Enter a name up to 60 characters.");
  if (!slugOf(name)) fail("The name needs at least one letter or number.");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slugOf(name))) fail("That name is reserved by Windows. Use a different name.");
  const port = Number(p.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === OWNER_PORT) fail("Port must be a whole number from 1024 to 65535, and not 4173.");
  const language = p.language === undefined || p.language === "" ? "pt-BR" : p.language;
  if (typeof language !== "string" || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) fail("Language must look like pt-BR or en.");
  const budgetUsd = p.budgetUsd === undefined || p.budgetUsd === "" ? 1 : Number(p.budgetUsd);
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0 || budgetUsd > 1000) fail("Monthly budget must be from 0 to 1000 dollars.");
  if (p.localOnly !== undefined && typeof p.localOnly !== "boolean") fail("Invalid local-only setting.");
  return { name, port, language, budgetUsd, localOnly: p.localOnly === true };
}
function cleanPeople(list) {
  if (!Array.isArray(list) || list.length > 20) fail("family.json must be a list of up to 20 people.");
  const people = list.map(cleanPerson),
    slugs = new Set(),
    ports = new Set();
  for (const p of people) {
    const s = slugOf(p.name);
    if (slugs.has(s)) fail(`Two people share the folder name "${s}". Use different names.`);
    if (ports.has(p.port)) fail(`Port ${p.port} is used twice.`);
    slugs.add(s);
    ports.add(p.port);
  }
  return people;
}

function createFamilyAdmin({ directory, clock = () => new Date() }) {
  const configFile = path.join(directory, "family.json"),
    statusFile = path.join(directory, "family-status.json");
  const readJson = (file, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return fallback;
      throw Error(`Cannot read ${file}. Fix the JSON.`);
    }
  };
  const people = () => cleanPeople(readJson(configFile, []));
  function save(list) {
    const clean = cleanPeople(list),
      temporary = configFile + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(clean, null, 2));
    fs.renameSync(temporary, configFile);
    return clean;
  }
  const personDir = (p) => path.join(directory, "people", slugOf(p.name));
  const find = (slug) => people().find((p) => slugOf(p.name) === slug) || fail("Person not found.", 404);

  function spend(dir) {
    const file = path.join(dir, "spark.sqlite");
    if (!fs.existsSync(file)) return 0;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout=2000");
      const month = clock().toISOString().slice(0, 7);
      const row = db.prepare("SELECT SUM(json_extract(json,'$.costUsd')) c FROM usage WHERE json_extract(json,'$.cloud')=1 AND json_extract(json,'$.at') LIKE ?").get(month + "%");
      return Math.round((row.c || 0) * 1e6) / 1e6;
    } catch {
      return null;
    } finally {
      db.close();
    }
  }
  function deviceCount(dir) {
    const file = path.join(dir, "pairing.sqlite");
    if (!fs.existsSync(file)) return 0;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare("SELECT COUNT(*) n FROM devices WHERE expires>?").get(+clock()).n;
    } catch {
      return 0;
    } finally {
      db.close();
    }
  }
  const lastUsed = (dir) => {
    try {
      return fs.readFileSync(path.join(dir, "last-used.txt"), "utf8").trim() || null;
    } catch {
      return null;
    }
  };
  function status() {
    const s = readJson(statusFile, {}),
      fresh = s.updatedAt && clock() - new Date(s.updatedAt) < STATUS_FRESH_MS,
      byPort = Object.fromEntries((fresh ? s.people || [] : []).map((x) => [x.slug, x]));
    return {
      launcherRunning: !!fresh,
      cloudflared: fresh ? !!s.cloudflared : null,
      people: people().map((p) => {
        const slug = slugOf(p.name),
          live = byPort[slug],
          dir = personDir(p);
        return { ...p, slug, running: !!live?.running, url: live?.running ? live.url || null : null, lastUsed: lastUsed(dir), spentUsd: spend(dir), devices: deviceCount(dir) };
      }),
    };
  }
  function pairing(p) {
    const dir = personDir(p);
    fs.mkdirSync(dir, { recursive: true });
    return devices(path.join(dir, "pairing.sqlite"), () => +clock());
  }
  function pairLink(slug) {
    const p = find(slug),
      live = status().people.find((x) => x.slug === slug);
    if (!live?.url) fail(`${p.name}'s link needs a running tunnel. Run Start Family first, then try again.`, 409);
    const registry = pairing(p);
    try {
      registry.clearInvites();
      const code = registry.invite(LINK_TTL_MS);
      return { link: `${live.url}/pair?code=${code}`, expires: new Date(+clock() + LINK_TTL_MS).toISOString() };
    } finally {
      registry.close();
    }
  }
  function revoke(slug) {
    const registry = pairing(find(slug));
    try {
      return { revoked: registry.revokeAll() };
    } finally {
      registry.close();
    }
  }
  function upsert(slug, data) {
    const list = people(),
      next = cleanPerson(data),
      i = slug ? list.findIndex((p) => slugOf(p.name) === slug) : -1;
    if (slug && i < 0) fail("Person not found.", 404);
    if (i >= 0) list[i] = next;
    else list.push(next);
    save(list);
    return next;
  }
  function remove(slug) {
    revoke(slug);
    save(people().filter((p) => slugOf(p.name) !== slug));
    return { ok: true };
  }
  return { people, status, pairLink, revoke, upsert, remove, personDir, configFile, statusFile };
}
module.exports = { createFamilyAdmin, cleanPeople, cleanPerson, parseTunnelUrl, hostOf, slugOf, LINK_TTL_MS, TUNNEL_URL };
