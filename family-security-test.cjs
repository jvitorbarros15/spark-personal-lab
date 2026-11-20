"use strict";
const assert = require("node:assert/strict"),
  http = require("node:http"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawn } = require("node:child_process");
const { createServer } = require("./server.cjs");
const { openStore } = require("./store.cjs");
const { devices } = require("./phone.cjs");
const { createFamilyAdmin } = require("./family-admin.cjs");
const family = require("./family.cjs");

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), "spark-famsec-" + n + "-"));
const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", r));
const rm = (d) => {
  try {
    fs.rmSync(d, { recursive: true, force: true });
  } catch {}
};
const PUBLIC = "calm-fox-demo.trycloudflare.com";
const near = () => new Date().toISOString();
const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push(["ok", name]);
  } catch (e) {
    results.push(["FAIL", name]);
    console.error("FAIL " + name + "\n", e);
    process.exitCode = 1;
  }
};

function client(server) {
  const port = server.address().port;
  return (route, { method = "GET", host = "127.0.0.1:" + port, headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port, path: route, method, headers: { host, ...headers } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, data }));
      });
      req.on("error", reject);
      req.end(body);
    });
}
const post = (data, extra = {}) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data), ...extra });
const familyOf = (extra = {}) => ({ name: "Ana", ownerName: "Joao", language: "pt-BR", budgetUsd: 1, localOnly: false, ...extra });
const usageRow = (id, costUsd) => ({ id, at: near(), provider: "openai", model: "gpt-x", cloud: true, stage: "chat", runId: "", tokensIn: 1, tokensOut: 1, costUsd, offPeak: false, estimated: false });
const close = (server) => new Promise((r) => server.close(r));

async function main() {
  await test("import cannot reset the budget (replace, merge, restore, store upsert)", async () => {
    const dir = tmp("import");
    const seed = openStore(dir);
    seed.put("usage", usageRow("u1", 0.9));
    seed.close();
    const server = createServer({ directory: dir, family: familyOf() });
    await listen(server);
    const c = client(server);
    const spent = async () => JSON.parse((await c("/api/cost")).data).spent;
    assert.equal(await spent(), 0.9);
    const archive = JSON.parse((await c("/api/export")).data);
    for (const mode of ["replace", "merge"]) {
      const forged = { ...archive, usage: archive.usage.map((u) => ({ ...u, costUsd: 0 })) };
      const r = await c("/api/import", post({ archive: forged, mode }));
      assert.equal(r.status, 200, r.data);
      assert.equal(await spent(), 0.9, "spent survives " + mode + " import");
    }
    const name = JSON.parse((await c("/api/backups")).data).backups[0];
    const file = path.join(dir, "backups", name),
      backup = JSON.parse(fs.readFileSync(file, "utf8"));
    backup.usage = backup.usage.map((u) => ({ ...u, costUsd: 0 }));
    fs.writeFileSync(file, JSON.stringify(backup));
    const restored = await c("/api/backups/restore", post({ name }));
    assert.equal(restored.status, 200, restored.data);
    assert.equal(await spent(), 0.9, "spent survives restore");
    await close(server);
    const store = openStore(dir);
    store.importArchive({ ...archive, usage: [usageRow("u1", 0)] }, "merge");
    assert.equal(store.get("usage", "u1").costUsd, 0.9, "store never overwrites an existing usage row");
    store.close();
    rm(dir);
  });

  await test("revokeAll drops unredeemed invites and pairLink clears older ones", async () => {
    const dir = tmp("invites");
    const registry = devices(path.join(dir, "p.sqlite"));
    const code = registry.invite(60000);
    registry.revokeAll();
    assert.equal(registry.redeem(code), null, "revoked invite is dead");
    registry.close();

    const admin = createFamilyAdmin({ directory: dir });
    fs.writeFileSync(path.join(dir, "family.json"), JSON.stringify([{ name: "Ana", port: 4301 }]));
    fs.writeFileSync(path.join(dir, "family-status.json"), JSON.stringify({ updatedAt: new Date().toISOString(), cloudflared: true, people: [{ slug: "ana", name: "Ana", running: true, url: "https://" + PUBLIC }] }));
    const first = admin.pairLink("ana").link.split("code=")[1];
    const second = admin.pairLink("ana").link.split("code=")[1];
    const check = devices(path.join(dir, "people", "ana", "pairing.sqlite"));
    assert.equal(check.redeem(first), null, "older link is dead after a new one");
    assert.ok(check.redeem(second));
    check.close();
    rm(dir);
  });

  await test("removing a person revokes their devices", async () => {
    const dir = tmp("remove");
    fs.writeFileSync(path.join(dir, "family.json"), JSON.stringify([{ name: "Ana", port: 4301 }]));
    const pdir = path.join(dir, "people", "ana");
    fs.mkdirSync(pdir, { recursive: true });
    const registry = devices(path.join(pdir, "pairing.sqlite"));
    const secret = registry.redeem(registry.invite(60000));
    const pending = registry.invite(60000);
    assert.ok(registry.valid(secret));
    createFamilyAdmin({ directory: dir }).remove("ana");
    assert.equal(registry.valid(secret), false, "device cookie dead after removal");
    assert.equal(registry.redeem(pending), null);
    registry.close();
    rm(dir);
  });

  await test("failed pairing attempts from strangers cannot lock out a valid code", async () => {
    const dir = tmp("lockout");
    const server = createServer({ directory: dir, family: familyOf(), publicHost: PUBLIC });
    await listen(server);
    const c = client(server);
    const form = (code, ip) => ({ method: "POST", host: PUBLIC, headers: { origin: "https://" + PUBLIC, "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": ip }, body: "code=" + code });
    for (let i = 0; i < 25; i++) assert.equal((await c("/pair", form("wrong" + i, "9.9.9." + i))).status, 403);
    const registry = devices(path.join(dir, "pairing.sqlite"));
    const code = registry.invite(60000);
    registry.close();
    const ok = await c("/pair", form(code, "1.2.3.4"));
    assert.equal(ok.status, 303, "real code still redeems");
    for (let i = 0; i < 6; i++) await c("/pair", form("nope", "7.7.7.7"));
    assert.equal((await c("/pair", form("nope", "7.7.7.7"))).status, 429, "the same client is still throttled");
    await close(server);
    rm(dir);
  });

  await test("child env is an allowlist", async () => {
    const base = { PATH: "p", SystemRoot: "C:\\Windows", TEMP: "t", USERPROFILE: "u", OLLAMA_HOST: "127.0.0.1:11434", OPENAI_API_KEY: "a", ANTHROPIC_API_KEY: "b", GEMINI_API_KEY: "c", OLLAMA_API_KEY: "d", OPENALEX_API_KEY: "e", LOCAL_API_KEY: "f", LOCAL_BASE_URL: "g", GITHUB_TOKEN: "h", AWS_SECRET_ACCESS_KEY: "i", SPARK_DATA_DIR: "owner" };
    const env = family.childEnv({ name: "Ana", port: 4301, budgetUsd: 1 }, { dataDir: tmp("env"), ownerName: "J", publicHost: null, base });
    for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OLLAMA_API_KEY", "OPENALEX_API_KEY", "LOCAL_API_KEY", "LOCAL_BASE_URL", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY"]) assert.equal(env[k], undefined, k);
    assert.notEqual(env.SPARK_DATA_DIR, "owner");
    for (const k of ["PATH", "SystemRoot", "TEMP", "USERPROFILE", "OLLAMA_HOST"]) assert.equal(env[k], base[k], k);
    assert.equal(env.SPARK_FAMILY_NAME, "Ana");
  });

  await test("public host without a family name is refused", async () => {
    assert.throws(() => createServer({ directory: tmp("nofam"), publicHost: PUBLIC }), /family/i);
    const dir = tmp("nofam-proc");
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, "server.cjs")], { env: { ...process.env, SPARK_DATA_DIR: dir, SPARK_PORT: String(4500 + Math.floor(Math.random() * 90)), SPARK_PUBLIC_HOST: PUBLIC, SPARK_FAMILY_NAME: "" }, stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      child.stdout.on("data", (d) => (text += d));
      child.stderr.on("data", (d) => (text += d));
      child.on("exit", (code) => resolve({ code, text }));
      setTimeout(() => (child.kill(), resolve({ code: null, text })), 3000);
    });
    assert.equal(out.code, 1, out.text);
    assert.match(out.text, /SPARK_FAMILY_NAME/);
    rm(dir);
  });

  await test("tunnel-header guard applies on family instances before the tunnel URL is known", async () => {
    const dir = tmp("guard");
    const server = createServer({ directory: dir, family: familyOf() });
    await listen(server);
    const c = client(server);
    assert.equal((await c("/api/state")).status, 200);
    assert.equal((await c("/api/state", { headers: { "cf-connecting-ip": "1.2.3.4" } })).status, 403);
    assert.equal((await c("/api/state", { headers: { "x-forwarded-for": "1.2.3.4" } })).status, 403);
    await close(server);
    rm(dir);
  });

  await test("family members cannot set the voice local URL", async () => {
    const dir = tmp("voice");
    const server = createServer({ directory: dir, family: familyOf() });
    await listen(server);
    const c = client(server);
    const before = JSON.parse((await c("/api/voice/settings")).data).localBase;
    await c("/api/voice/settings", post({ localBase: "http://127.0.0.1:9999/v1", localModel: "x" }));
    assert.equal(JSON.parse((await c("/api/voice/settings")).data).localBase, before);
    await close(server);
    rm(dir);
  });

  await test("no Windows username or host paths leak", async () => {
    assert.notEqual(family.ownerNameOf([], {}), os.userInfo().username);
    assert.equal(family.ownerNameOf(["node", "family.cjs", "--owner", "Joao"], {}), "Joao");
    const dir = tmp("leak");
    const server = createServer({ directory: dir, family: familyOf() });
    await listen(server);
    const c = client(server);
    const idea = JSON.parse((await c("/api/records", post({ type: "idea", stage: "draft", title: "Bakery", body: "x", fields: {} }))).data);
    const res = await c(`/api/ideas/${idea.id}/founder-export`, post({}));
    assert.equal(res.status, 200, res.data);
    assert.ok(!res.data.includes(dir) && !res.data.includes(dir.replace(/\\/g, "\\\\")), "no host path in founder export");
    assert.ok(!JSON.parse(res.data).folder);
    await close(server);
    rm(dir);
  });

  await test("cloudflared is resolved to an absolute path outside the working folder", async () => {
    const repo = tmp("repo"),
      bin = tmp("bin"),
      name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
    fs.writeFileSync(path.join(repo, name), "");
    fs.writeFileSync(path.join(bin, name), "");
    const found = family.resolveCloudflared({ PATH: [repo, bin].join(path.delimiter) }, repo);
    assert.equal(found, path.join(bin, name));
    assert.ok(path.isAbsolute(found));
    assert.equal(family.resolveCloudflared({ PATH: repo }, repo), null);
    rm(repo);
    rm(bin);
  });

  await test("family import resets generated-record trust", async () => {
    const dir = tmp("trust");
    const server = createServer({ directory: dir, family: familyOf() });
    await listen(server);
    const c = client(server);
    const archive = JSON.parse((await c("/api/export")).data);
    const rec = { id: "r-gen", type: "idea", stage: "draft", title: "Generated", body: "", category: "", fields: { price: "9" }, links: [], origin: { by: "assistant", runId: "x" }, reviewed: "2026-01-01T00:00:00.000Z" };
    const imp = await c("/api/import", post({ archive: { ...archive, records: [rec] }, mode: "merge" }));
    assert.equal(imp.status, 200, imp.data);
    const state = JSON.parse((await c("/api/state")).data);
    const got = state.records.find((r) => r.id === "r-gen");
    assert.equal(got.reviewed, null);
    assert.equal(got.fields.price ?? "", "", "evidence field blanked until accepted");
    await close(server);
    rm(dir);
  });

  await test("launcher stops a removed person and does not restart them", async () => {
    const dir = tmp("reconcile"),
      killed = [],
      spawned = [];
    const people = [{ name: "Ana", port: 4301, language: "pt-BR", budgetUsd: 1, localOnly: false }, { name: "Bia", port: 4302, language: "pt-BR", budgetUsd: 1, localOnly: false }];
    fs.writeFileSync(path.join(dir, "family.json"), JSON.stringify(people));
    const { EventEmitter } = require("node:events");
    const fake = (cmd, args, opts) => {
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stderr = new EventEmitter();
      c.env = opts.env;
      c.kill = () => (killed.push(c.env?.SPARK_FAMILY_NAME || "tunnel"), setImmediate(() => c.emit("exit", null)));
      spawned.push(c);
      return c;
    };
    const timers = [];
    const launcher = family.createLauncher({ dataDir: dir, ownerName: "J", people, cloudflared: null, spawn: fake, log() {}, setTimer: (fn) => (timers.push(fn), { unref() {} }), sparkScript: "server.cjs" });
    launcher.start();
    assert.equal(spawned.length, 2);
    fs.writeFileSync(path.join(dir, "family.json"), JSON.stringify([people[1]]));
    launcher.reconcile();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(killed, ["Ana"]);
    timers.splice(0).forEach((fn) => fn());
    assert.equal(spawned.length, 2, "no restart for the removed person");
    launcher.stop();
    rm(dir);
  });

  for (const [s, n] of results) console.log(s.padEnd(5), n);
  if (!process.exitCode) console.log("PASS: family security tests.");
}
main().then(() => process.exit(process.exitCode || 0));
