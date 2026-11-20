"use strict";
// Starts one Spark per family member on 127.0.0.1 and, if cloudflared is installed, one quick tunnel each.
const fs = require("node:fs"),
  path = require("node:path"),
  childProcess = require("node:child_process");
const { dataDirectory } = require("./data-dir.cjs");
const { createFamilyAdmin, parseTunnelUrl, hostOf, slugOf } = require("./family-admin.cjs");

const INSTALL_HELP = [
  "cloudflared is not installed, so nobody can reach Spark from outside this computer yet.",
  "Install it once (Windows 10/11):",
  "  winget install --id Cloudflare.cloudflared",
  "Then close this window and run Start Family again. Spark never downloads it for you.",
  "Continuing with local-only instances (each person's Spark on 127.0.0.1 only).",
].join("\n");

const backoff = (attempt) => Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));

const ENV_ALLOW = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "USERPROFILE", "HOME", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "OLLAMA_HOST", "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_NO_WARNINGS", "SSL_CERT_FILE"]);

function childEnv(person, { dataDir, ownerName, publicHost, base = process.env }) {
  const env = {};
  for (const [key, value] of Object.entries(base)) if (ENV_ALLOW.has(key.toUpperCase())) env[key] = value;
  Object.assign(env, {
    SPARK_DATA_DIR: path.join(dataDir, "people", slugOf(person.name)),
    SPARK_PORT: String(person.port),
    SPARK_FAMILY_NAME: person.name,
    SPARK_OWNER_NAME: ownerName,
    SPARK_LANGUAGE: person.language || "pt-BR",
    SPARK_BUDGET_USD: String(person.budgetUsd ?? 1),
    SPARK_LOCAL_ONLY: person.localOnly ? "1" : "0",
    SPARK_GPU_QUEUE: path.join(dataDir, "gpu-queue"),
  });
  if (publicHost) env.SPARK_PUBLIC_HOST = publicHost;
  return env;
}

const ownerNameOf = (argv, env) => {
  const flag = argv.indexOf("--owner");
  return (flag > 0 && argv[flag + 1]) || env.SPARK_OWNER_NAME || "the owner";
};

function resolveCloudflared(env = process.env, cwd = process.cwd()) {
  const ext = process.platform === "win32" ? ".exe" : "",
    inside = (dir, parent) => {
      const rel = path.relative(path.resolve(parent), path.resolve(dir));
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  for (const dir of String(env[pathKey] || "").split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir) || inside(dir, cwd) || inside(dir, __dirname)) continue;
    const file = path.join(dir, "cloudflared" + ext);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function lines(stream, onLine) {
  let rest = "";
  stream?.on("data", (chunk) => {
    rest += chunk;
    const parts = rest.split(/\r?\n/);
    rest = parts.pop();
    parts.forEach(onLine);
  });
}

function createLauncher({ dataDir, ownerName, people, cloudflared, spawn = childProcess.spawn, log = console.log, setTimer = setTimeout, now = () => new Date(), sparkScript = path.join(__dirname, "server.cjs") }) {
  const admin = createFamilyAdmin({ directory: dataDir }),
    statusFile = path.join(dataDir, "family-status.json");
  const state = people.map((person) => ({ person, slug: slugOf(person.name), url: null, spark: null, tunnel: null, sparkFails: 0, tunnelFails: 0, sparkStartedAt: 0, stopping: false }));
  let stopped = false,
    heartbeat = null;

  function writeStatus() {
    const body = { updatedAt: now().toISOString(), cloudflared: !!cloudflared, people: state.map((s) => ({ slug: s.slug, name: s.person.name, port: s.person.port, running: !!s.spark, url: s.url })) };
    const temporary = statusFile + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(body, null, 2));
    fs.renameSync(temporary, statusFile);
  }

  function startSpark(s) {
    if (stopped || s.removed || s.spark) return;
    fs.mkdirSync(path.join(dataDir, "people", s.slug), { recursive: true });
    const child = spawn(process.execPath, [sparkScript], { env: childEnv(s.person, { dataDir, ownerName, publicHost: s.url ? hostOf(s.url) : null }), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    s.spark = child;
    s.sparkStartedAt = Date.now();
    const tag = `[${s.person.name}]`;
    lines(child.stdout, (l) => log(tag, l));
    lines(child.stderr, (l) => /ExperimentalWarning|trace-warnings/.test(l) || log(tag, l));
    child.on("error", (e) => log(tag, "could not start:", e.message));
    child.on("exit", (code) => {
      s.spark = null;
      writeStatus();
      if (stopped || s.removed) return;
      if (s.restartForUrl) {
        s.restartForUrl = false;
        return startSpark(s);
      }
      s.sparkFails = Date.now() - s.sparkStartedAt > 60000 ? 1 : s.sparkFails + 1;
      const wait = backoff(s.sparkFails - 1);
      log(tag, `Spark stopped (code ${code}). Restarting in ${Math.round(wait / 1000)}s.`);
      setTimer(() => startSpark(s), wait).unref?.();
    });
    writeStatus();
  }

  function onUrl(s, url) {
    if (url === s.url) return;
    s.url = url;
    s.tunnelFails = 0;
    log(`[${s.person.name}] address: ${url}`);
    if (s.spark) {
      s.restartForUrl = true;
      s.spark.kill();
    } else startSpark(s);
    writeStatus();
    setTimer(() => printLink(s), 1500).unref?.();
  }
  function printLink(s) {
    if (stopped || !s.url) return;
    try {
      const { link } = admin.pairLink(s.slug);
      log(`[${s.person.name}] pairing link (one use, valid 24 hours): ${link}`);
    } catch (e) {
      log(`[${s.person.name}] no pairing link yet: ${e.message}`);
    }
  }

  function startTunnel(s) {
    if (stopped || s.removed || !cloudflared) return;
    const child = spawn(cloudflared, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${s.person.port}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    s.tunnel = child;
    const started = Date.now(),
      look = (l) => {
        const url = parseTunnelUrl(l);
        if (url) onUrl(s, url);
      };
    lines(child.stdout, look);
    lines(child.stderr, look);
    child.on("error", (e) => log(`[${s.person.name}] cloudflared could not start: ${e.message}`));
    child.on("exit", (code) => {
      s.tunnel = null;
      s.url = null;
      writeStatus();
      if (stopped || s.removed) return;
      s.tunnelFails = Date.now() - started > 60000 ? 1 : s.tunnelFails + 1;
      const wait = backoff(s.tunnelFails - 1);
      log(`[${s.person.name}] tunnel stopped (code ${code}). Restarting in ${Math.round(wait / 1000)}s. The address will change.`);
      setTimer(() => startTunnel(s), wait).unref?.();
    });
  }

  function reconcile() {
    let current;
    try {
      current = new Set(admin.people().map((p) => slugOf(p.name)));
    } catch {
      return;
    }
    for (const s of state)
      if (!s.removed && !current.has(s.slug)) {
        s.removed = true;
        s.spark?.kill();
        s.tunnel?.kill();
        log(`[${s.person.name}] removed from the list: stopped.`);
      }
  }

  function start() {
    for (const s of state) {
      startSpark(s);
      startTunnel(s);
    }
    heartbeat = setInterval(() => (reconcile(), writeStatus()), 15000);
    heartbeat.unref?.();
    writeStatus();
  }
  function stop() {
    stopped = true;
    clearInterval(heartbeat);
    for (const s of state) {
      s.spark?.kill();
      s.tunnel?.kill();
    }
    for (const s of state) {
      s.spark = null;
      s.url = null;
    }
    writeStatus();
  }
  return { start, stop, state, writeStatus, reconcile };
}

function detectCloudflared(spawnSync = childProcess.spawnSync, env = process.env) {
  const file = resolveCloudflared(env);
  if (!file) return null;
  const r = spawnSync(file, ["--version"], { windowsHide: true });
  return !r.error && r.status === 0 ? file : null;
}

if (require.main === module) {
  const dataDir = dataDirectory();
  const ownerName = ownerNameOf(process.argv, process.env);
  let people;
  try {
    people = createFamilyAdmin({ directory: dataDir }).people();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  if (!people.length) {
    console.error(`No people yet. Add them in Spark under Settings > Family, or create ${path.join(dataDir, "family.json")}:\n[{"name":"Ana","port":4201,"language":"pt-BR","budgetUsd":1,"localOnly":false}]`);
    process.exit(1);
  }
  fs.mkdirSync(path.join(dataDir, "gpu-queue"), { recursive: true });
  const cloudflared = detectCloudflared();
  if (!cloudflared) console.log(INSTALL_HELP);
  const launcher = createLauncher({ dataDir, ownerName, people, cloudflared });
  const quit = () => {
    launcher.stop();
    setTimeout(() => process.exit(0), 300);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  console.log(`Starting ${people.length} Spark instance${people.length === 1 ? "" : "s"}. Press Ctrl+C to stop.\nAddresses and pairing links appear below; Settings > Family in your own Spark shows them too.`);
  launcher.start();
}
module.exports = { createLauncher, childEnv, ownerNameOf, resolveCloudflared, detectCloudflared, parseTunnelUrl, backoff, INSTALL_HELP };
