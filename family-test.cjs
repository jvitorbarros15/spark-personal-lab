"use strict";
const assert = require("node:assert/strict"),
  http = require("node:http"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { EventEmitter } = require("node:events"),
  { spawn } = require("node:child_process");
const { createServer } = require("./server.cjs");
const { createGpuQueue } = require("./gpu-queue.cjs");
const { createCost } = require("./cost.cjs");
const { openStore } = require("./store.cjs");
const { devices } = require("./phone.cjs");
const { parseTunnelUrl, slugOf, cleanPeople, createFamilyAdmin } = require("./family-admin.cjs");
const { createLauncher, childEnv, INSTALL_HELP, backoff } = require("./family.cjs");

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), "spark-family-" + n + "-"));
const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", r));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PUBLIC = "calm-fox-demo.trycloudflare.com";

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
const form = (code) => ({ method: "POST", host: PUBLIC, headers: { origin: "https://" + PUBLIC, "content-type": "application/x-www-form-urlencoded" }, body: "code=" + code });
const jsonOpts = (data, extra = {}) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data), ...extra });

async function launcherTests() {
  const sample = [
    "2026-11-19T12:00:00Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out.",
    "2026-11-19T12:00:02Z INF Requesting new quick Tunnel on trycloudflare.com...",
    "2026-11-19T12:00:03Z INF +--------------------------------------------------------------------------------------------+",
    "2026-11-19T12:00:03Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |",
    "2026-11-19T12:00:03Z INF |  https://Calm-Fox-Demo.trycloudflare.com                                                   |",
  ];
  assert.equal(parseTunnelUrl(sample.join("\n")), "https://calm-fox-demo.trycloudflare.com");
  assert.equal(parseTunnelUrl(sample[0]), null);
  assert.equal(parseTunnelUrl("see https://api.trycloudflare.com/tunnel for docs"), null, "needs a generated multi-word name");
  assert.equal(parseTunnelUrl("https://evil.example/https://a-b.trycloudflare.com.evil.com"), "https://a-b.trycloudflare.com");
  assert.match(INSTALL_HELP, /winget install --id Cloudflare\.cloudflared/);
  assert.deepEqual([0, 1, 2, 10].map(backoff), [1000, 2000, 4000, 30000]);

  const dataDir = tmp("launcher");
  const people = [{ name: "Ana Maria", port: 4301, language: "pt-BR", budgetUsd: 2, localOnly: true }, { name: "Bia", port: 4302, language: "pt-BR", budgetUsd: 1, localOnly: false }];
  const env = childEnv(people[0], { dataDir, ownerName: "Joao", publicHost: PUBLIC, base: { SPARK_DATA_DIR: "owner", SPARK_PORT: "1", PATH: "x" } });
  assert.equal(env.SPARK_DATA_DIR, path.join(dataDir, "people", "ana-maria"));
  assert.equal(env.SPARK_PORT, "4301");
  assert.equal(env.SPARK_LOCAL_ONLY, "1");
  assert.equal(env.SPARK_PUBLIC_HOST, PUBLIC);
  assert.equal(env.PATH, "x");
  assert.equal(childEnv(people[1], { dataDir, ownerName: "J", publicHost: null, base: {} }).SPARK_PUBLIC_HOST, undefined);

  const spawned = [],
    timers = [];
  const fake = (cmd, args, opts) => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.kill = () => setImmediate(() => c.emit("exit", null));
    c.cmd = cmd;
    c.args = args;
    c.env = opts.env;
    spawned.push(c);
    return c;
  };
  const logs = [];
  fs.writeFileSync(path.join(dataDir, "family.json"), JSON.stringify(people));
  const launcher = createLauncher({ dataDir, ownerName: "Joao", people, cloudflared: path.join(os.tmpdir(), "bin", "cloudflared.exe"), spawn: fake, log: (...a) => logs.push(a.join(" ")), setTimer: (fn, ms) => (timers.push({ fn, ms }), { unref() {} }), sparkScript: "server.cjs" });
  launcher.start();
  const sparks = () => spawned.filter((c) => c.cmd === process.execPath),
    tunnels = () => spawned.filter((c) => c.cmd === path.join(os.tmpdir(), "bin", "cloudflared.exe"));
  assert.equal(sparks().length, 2);
  assert.equal(tunnels().length, 2);
  assert.deepEqual(tunnels()[0].args, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4301"]);
  assert.equal(sparks()[0].env.SPARK_PUBLIC_HOST, undefined, "no public host until the tunnel prints its address");
  const status = () => JSON.parse(fs.readFileSync(path.join(dataDir, "family-status.json"), "utf8"));
  assert.equal(status().people[0].running, true);
  assert.equal(status().people[0].url, null);

  tunnels()[0].stderr.emit("data", sample.join("\n") + "\n");
  await sleep(20);
  assert.equal(status().people[0].url, "https://calm-fox-demo.trycloudflare.com");
  assert.equal(sparks().length, 3, "Spark restarts once with the public host");
  assert.equal(sparks()[2].env.SPARK_PUBLIC_HOST, PUBLIC);
  assert.equal(sparks()[2].env.SPARK_DATA_DIR, path.join(dataDir, "people", "ana-maria"));
  assert.equal(status().people[1].url, null, "other people are unaffected");

  sparks()[2].emit("exit", 1);
  assert.equal(status().people[0].running, false);
  assert.equal(timers.at(-1).ms, 1000);
  timers.at(-1).fn();
  assert.equal(sparks().length, 4, "crashed Spark is restarted");
  sparks()[3].emit("exit", 1);
  assert.equal(timers.at(-1).ms, 2000, "backoff doubles after a quick second crash");

  tunnels()[0].emit("exit", 1);
  assert.equal(status().people[0].url, null, "a stopped tunnel clears the address");
  assert.ok(timers.at(-1).ms >= 1000);

  launcher.stop();
  await sleep(30);
  assert.equal(status().people.every((p) => !p.running && !p.url), true);

  const bare = createLauncher({ dataDir, ownerName: "J", people: [people[1]], cloudflared: null, spawn: fake, log() {}, setTimer: () => ({ unref() {} }), sparkScript: "server.cjs" });
  const before = spawned.length;
  bare.start();
  assert.equal(spawned.length - before, 1, "without cloudflared only Spark starts");
  bare.stop();
  await sleep(30);
  rm(dataDir);
}

async function queueTests() {
  const dir = tmp("queue");
  const a = createGpuQueue({ directory: dir, pollMs: 10 }),
    b = createGpuQueue({ directory: dir, pollMs: 10 });
  let active = 0,
    peak = 0;
  const order = [];
  const job = (name) => async () => {
    active++;
    peak = Math.max(peak, active);
    order.push(name);
    await sleep(40);
    active--;
    return name;
  };
  const first = a.run(job("a1"));
  await sleep(60);
  const rest = [b.run(job("b1"))];
  await sleep(5);
  rest.push(a.run(job("a2")));
  await sleep(5);
  rest.push(b.run(job("b2")));
  await sleep(40);
  assert.ok(a.waiting() + b.waiting() >= 1, "waiting callers are counted");
  assert.deepEqual(await Promise.all([first, ...rest]), ["a1", "b1", "a2", "b2"]);
  assert.equal(peak, 1, "never more than one model call at a time");
  assert.deepEqual(order, ["a1", "b1", "a2", "b2"], "first come, first served across queues");
  assert.equal(a.waiting() + b.waiting(), 0);
  assert.equal(fs.readdirSync(dir).length, 0, "tickets are removed");

  fs.writeFileSync(path.join(dir, "000000000000001-999999-dead.ticket"), "");
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(path.join(dir, "000000000000001-999999-dead.ticket"), old, old);
  assert.equal(await a.run(async () => "ok"), "ok", "a crashed holder's stale ticket is ignored");

  const slow = a.run(() => sleep(300));
  await sleep(50);
  const ac = new AbortController();
  const waiting = b.run(async () => "never", ac.signal);
  setTimeout(() => ac.abort(new Error("Cancelled")), 40);
  await assert.rejects(waiting, /Cancelled/);
  await slow;
  assert.equal(b.waiting(), 0);
  const capped = createGpuQueue({ directory: dir, pollMs: 10, maxHoldMs: 80 }),
    waiter = createGpuQueue({ directory: dir, pollMs: 10 });
  let aborted = false;
  const hung = capped.run((hold) => new Promise((_, no) => hold.addEventListener("abort", () => ((aborted = true), no(hold.reason)))));
  await sleep(20);
  const next = waiter.run(async () => "after");
  await assert.rejects(hung, /The local model took too long. Retry./);
  assert.equal(await next, "after", "a hung call no longer blocks the queue");
  assert.ok(aborted, "the hung call is aborted");
  assert.equal(fs.readdirSync(dir).length, 0, "the ticket is released");
  rm(dir);
}

async function costTests() {
  const dir = tmp("cost"),
    queue = tmp("cost-queue");
  const store = openStore(dir);
  const calls = [];
  let active = 0,
    peak = 0;
  const providers = {
    localTrusted: () => true,
    async generate(agent) {
      calls.push(agent);
      active++;
      peak = Math.max(peak, active);
      await sleep(30);
      active--;
      return { text: "hi", usage: { input: 10, output: 10 } };
    },
  };
  const make = (extra) => createCost({ directory: dir, store, providers, localModel: () => ({ provider: "local", model: "gemma" }), ...extra });
  const cloud = { provider: "openai", model: "gpt-x" };
  const owner = make({});
  assert.equal(owner.settings().budget, 5, "default budget unchanged");
  const family = make({ budgetUsd: 1, localOnly: true, gpu: createGpuQueue({ directory: queue, pollMs: 10 }) });
  assert.equal(family.settings().budget, 1);
  assert.throws(() => family.update({ budget: 50 }), /owner sets this budget/);
  const r = await family.generate(cloud, [{ role: "user", content: "x" }], undefined, undefined, {}, {});
  assert.equal(r.fellBack, true);
  assert.match(r.note, /local only/);
  assert.equal(calls.at(-1).provider, "local", "cloud models are off when localOnly");
  const other = make({ budgetUsd: 1, localOnly: true, gpu: createGpuQueue({ directory: queue, pollMs: 10 }) });
  await Promise.all([family.generate(cloud, [{ role: "user", content: "a" }]), other.generate(cloud, [{ role: "user", content: "b" }]), family.generate({ provider: "local", model: "gemma" }, [{ role: "user", content: "c" }])]);
  assert.equal(peak, 1, "two instances share one model slot");
  const capped = make({ budgetUsd: 0 });
  const priced = await capped.generate({ provider: "openai", model: "gpt-oss:120b" }, [{ role: "user", content: "x" }]);
  assert.match(priced.note, /budget/, "the per-person cap routes to the local model");
  store.close();
  rm(dir);
  rm(queue);
}

async function serverTests() {
  // Owner's default behaviour is unchanged.
  const ownerDir = tmp("owner");
  const owner = createServer({ directory: ownerDir });
  await listen(owner);
  const o = client(owner),
    op = owner.address().port;
  assert.equal(owner.pairing, null);
  assert.equal((await o("/api/state")).status, 200, "no login on localhost");
  assert.equal((await o("/api/state", { host: PUBLIC })).status, 403, "unknown host rejected without publicHost");
  assert.equal((await o("/api/state", { host: "localhost:" + op })).status, 200);
  assert.equal((await o("/api/state", { headers: { origin: "https://" + PUBLIC } })).status, 403);
  assert.equal((await o("/api/state", { headers: { origin: "http://127.0.0.1:" + op } })).status, 200);
  assert.equal((await o("/pair")).status, 404, "no pairing route on the owner's instance");
  assert.equal((await o("/api/state", { headers: { "cf-connecting-ip": "1.2.3.4" } })).status, 200, "tunnel headers only matter when a public host is set");
  assert.deepEqual(JSON.parse((await o("/api/family/self")).data), { family: false });
  assert.equal(JSON.parse((await o("/api/family")).data).people.length, 0);

  // Family instances A and B.
  const dirA = tmp("ana"),
    dirB = tmp("bia"),
    queue = tmp("shared-queue");
  let now = Date.parse("2026-11-19T12:00:00Z");
  const clock = () => new Date(now);
  const familyOf = (name, extra = {}) => ({ name, ownerName: "Joao", language: "pt-BR", budgetUsd: 1, localOnly: false, gpuQueue: queue, ...extra });
  const A = createServer({ directory: dirA, family: familyOf("Ana"), publicHost: PUBLIC, clock });
  const B = createServer({ directory: dirB, family: familyOf("Bia", { localOnly: true, budgetUsd: 3 }), publicHost: "other-fox-demo.trycloudflare.com" });
  await listen(A);
  await listen(B);
  const a = client(A),
    b = client(B);
  assert.throws(() => createServer({ directory: tmp("bad"), publicHost: "evil.com:80" }), /hostname/);

  // Host and Origin guard with a public host.
  assert.equal((await a("/api/family/self")).status, 200);
  assert.equal((await a("/api/state", { host: "evil.example" })).status, 403);
  assert.equal((await a("/api/state", { host: PUBLIC + ":4173" })).status, 403);
  assert.equal((await a("/api/state", { host: "other-fox-demo.trycloudflare.com" })).status, 403);
  assert.equal((await a("/api/state", { host: PUBLIC, headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await a("/api/state", { host: PUBLIC, headers: { origin: "http://127.0.0.1:" + A.address().port } })).status, 403);
  assert.equal((await a("/api/state", { host: PUBLIC, headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await a("/api/state", { headers: { origin: "https://" + PUBLIC } })).status, 403, "public origin on a local host is refused");
  assert.equal((await a("/api/state", { headers: { "cf-connecting-ip": "1.2.3.4" } })).status, 403, "tunnel traffic with a local Host is refused");

  // Auth required for the public host; localhost still works.
  assert.equal((await a("/api/state")).status, 200, "owner on localhost needs no login");
  assert.equal((await a("/api/state", { host: PUBLIC })).status, 401);
  assert.equal((await a("/api/records", { host: PUBLIC, method: "POST", headers: { origin: "https://" + PUBLIC, "content-type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await a("/app.js", { host: PUBLIC })).status, 401);
  assert.equal((await a("/assets/app.js", { host: PUBLIC })).status, 401);
  assert.equal((await a("/assets/style.css", { host: PUBLIC })).status, 200, "only the pairing page's stylesheet is open");
  const landing = await a("/", { host: PUBLIC });
  assert.equal(landing.status, 303);
  assert.equal(landing.headers.location, "/pair");
  const pairPage = await a("/pair?code=abc_DEF-123", { host: PUBLIC });
  assert.equal(pairPage.status, 200);
  assert.match(pairPage.data, /value="abc_DEF-123"/);
  assert.match(pairPage.data, /Conectar/, "pairing page follows the person's language");
  assert.doesNotMatch((await a('/pair?code="><script>', { host: PUBLIC })).data, /<script>/);

  // Pairing link flow.
  const code = A.pairing.invite(24 * 3600 * 1000);
  assert.equal((await a("/pair", { method: "POST", host: PUBLIC, headers: { "content-type": "application/x-www-form-urlencoded" }, body: "code=" + code })).status, 403, "origin required");
  const paired = await a("/pair", form(code));
  assert.equal(paired.status, 303);
  const cookieHeader = paired.headers["set-cookie"][0];
  assert.match(cookieHeader, /^__Host-spark=[A-Za-z0-9_-]{32}; Secure; HttpOnly; SameSite=Strict; Path=\//);
  const cookie = cookieHeader.split(";")[0];
  assert.equal((await a("/pair", form(code))).status, 403, "a code works once");
  assert.equal((await a("/api/state", { host: PUBLIC, headers: { cookie } })).status, 200);
  assert.equal((await a("/api/state", { host: PUBLIC, headers: { cookie: "__Host-spark=" + "x".repeat(32) } })).status, 401);
  assert.equal((await a("/api/state", { headers: { cookie } })).status, 200);
  const sent = await a("/api/state", { host: PUBLIC, headers: { cookie } });
  assert.equal(JSON.parse(sent.data).records.length, 0);
  const own = (data, route) => a(route, jsonOpts(data, { host: PUBLIC, headers: { cookie, origin: "https://" + PUBLIC, "content-type": "application/json" } }));
  assert.equal((await own({ prices: { "gpt-x": { in: 0, out: 0, free: true } } }, "/api/cost/settings")).status, 403, "a family member cannot rewrite prices or budget");
  assert.equal((await own({ provider: "openai", key: "sk-test" }, "/api/providers")).status, 403, "a family member cannot change provider keys");
  assert.equal((await own({ groqKey: "k", groqConsent: true, target: "groq" }, "/api/voice/settings")).status, 200);
  assert.equal(JSON.parse((await a("/api/voice/settings", { host: PUBLIC, headers: { cookie } })).data).target, "local");
  assert.equal(fs.existsSync(path.join(dirA, "secrets.json")), false, "no key was saved");
  assert.equal((await a("/api/state", { headers: { "x-forwarded-host": "x" } })).status, 403, "forwarded headers with a local Host are refused");
  assert.equal((await a("/api/state", { headers: { "cf-ipcountry": "BR" } })).status, 403, "any cf header with a local Host is refused");
  await sleep(50);
  assert.ok(fs.existsSync(path.join(dirA, "last-used.txt")), "last use is recorded for the owner's page");

  // Expiry: a 24 hour link is dead after 24 hours; a 10 minute code after 10 minutes.
  const expiring = A.pairing.invite(24 * 3600 * 1000);
  now += 23 * 3600 * 1000;
  assert.equal((await a("/pair", form(expiring))).status, 303, "still valid inside 24 hours");
  const late = A.pairing.invite(24 * 3600 * 1000);
  now += 24 * 3600 * 1000 + 1000;
  assert.equal((await a("/pair", form(late))).status, 403, "expired after 24 hours");
  const short = A.pairing.invite();
  now += 11 * 60000;
  assert.equal((await a("/pair", form(short))).status, 403, "default codes last 10 minutes");

  // Revocation.
  const fresh = A.pairing.invite(24 * 3600 * 1000);
  const second = (await a("/pair", form(fresh))).headers["set-cookie"][0].split(";")[0];
  assert.equal((await a("/api/state", { host: PUBLIC, headers: { cookie: second } })).status, 200);
  assert.ok(A.pairing.revokeAll() >= 1);
  assert.equal((await a("/api/state", { host: PUBLIC, headers: { cookie: second } })).status, 401);
  assert.equal((await a("/api/state", { host: PUBLIC, headers: { cookie } })).status, 401);

  // Rate limit on attempts, even for a valid code once blocked.
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await a("/pair", form("wrong" + i))).status);
  assert.ok(statuses.includes(403) && statuses.at(-1) === 429, "five failed attempts in ten minutes lock pairing: " + statuses);
  const blocked = await a("/pair", form(A.pairing.invite(60000)));
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers["retry-after"]);

  // Family instances hide owner-only routes and apply per-person settings.
  assert.equal((await a("/api/family")).status, 404);
  assert.equal((await a("/api/family/people/ana/pair", jsonOpts({}))).status, 404);
  const self = JSON.parse((await b("/api/family/self")).data);
  assert.deepEqual(self, { family: true, name: "Bia", ownerName: "Joao", language: "pt-BR", budgetUsd: 3, localOnly: true, queued: 0 });
  assert.equal(JSON.parse((await b("/api/cost")).data).budget, 3);
  assert.equal((await b("/api/cost/settings", jsonOpts({ budget: 99 }))).status, 403);
  const voice = JSON.parse((await b("/api/voice/settings", jsonOpts({ target: "groq", fallback: true }))).data);
  assert.equal(voice.target, "local", "voice stays on the local model for family instances");
  assert.equal(JSON.parse((await o("/api/cost")).data).budget, 5, "owner budget untouched");

  // Two instances are isolated.
  const rec = await a("/api/records", jsonOpts({ type: "problem", stage: "exploring", title: "Ana's private pain", fields: {}, links: [] }));
  assert.equal(rec.status, 201);
  assert.equal(JSON.parse((await a("/api/state")).data).records.length, 1);
  assert.equal(JSON.parse((await b("/api/state")).data).records.length, 0);
  assert.equal(JSON.parse((await o("/api/state")).data).records.length, 0);
  assert.notEqual(dirA, dirB);
  const bCode = B.pairing.invite(60000);
  const bHost = "other-fox-demo.trycloudflare.com";
  const bPaired = await b("/pair", { method: "POST", host: bHost, headers: { origin: "https://" + bHost, "content-type": "application/x-www-form-urlencoded" }, body: "code=" + bCode });
  assert.equal(bPaired.status, 303);
  const bCookie = bPaired.headers["set-cookie"][0].split(";")[0];
  assert.equal((await a("/api/state", { host: PUBLIC, headers: { cookie: bCookie } })).status, 401, "one person's login does not open another's notebook");

  A.close();
  B.close();
  owner.close();

  // Owner-side Family page API reads status and people read-only.
  const adminDir = tmp("admin"),
    peopleRoot = path.join(adminDir, "people", "ana");
  fs.mkdirSync(peopleRoot, { recursive: true });
  const personServer = createServer({ directory: peopleRoot, clock: () => new Date() });
  const { validateUsage } = require("./cost.cjs");
  const month = new Date().toISOString();
  personServer.store.put("usage", validateUsage({ id: "u1", at: month, provider: "openai", model: "m", cloud: true, costUsd: 0.25 }));
  personServer.store.put("usage", validateUsage({ id: "u2", at: "2020-01-01T00:00:00Z", provider: "openai", model: "m", cloud: true, costUsd: 9 }));
  personServer.close();
  await sleep(50);
  fs.writeFileSync(path.join(adminDir, "family.json"), JSON.stringify([{ name: "Ana", port: 4201, language: "pt-BR", budgetUsd: 1, localOnly: false }]));
  const writeStatus = (url, running = true, at = new Date()) => fs.writeFileSync(path.join(adminDir, "family-status.json"), JSON.stringify({ updatedAt: at.toISOString(), cloudflared: true, people: [{ slug: "ana", name: "Ana", port: 4201, running, url }] }));
  const O = createServer({ directory: adminDir });
  await listen(O);
  const ow = client(O);
  writeStatus("https://calm-fox-demo.trycloudflare.com");
  const view = JSON.parse((await ow("/api/family")).data);
  assert.equal(view.launcherRunning, true);
  assert.equal(view.people[0].url, "https://calm-fox-demo.trycloudflare.com");
  assert.equal(view.people[0].running, true);
  assert.equal(view.people[0].spentUsd, 0.25, "month-to-date spend only");
  assert.equal(view.people[0].devices, 0);
  const pair = JSON.parse((await ow("/api/family/people/ana/pair", jsonOpts({}))).data);
  const link = new URL(pair.link);
  assert.equal(link.origin, "https://calm-fox-demo.trycloudflare.com");
  assert.equal(link.pathname, "/pair");
  assert.ok(Date.parse(pair.expires) - Date.now() > 23.9 * 3600000);
  const registry = devices(path.join(peopleRoot, "pairing.sqlite"));
  assert.ok(registry.redeem(link.searchParams.get("code")), "the owner's link works on the person's instance");
  assert.equal(registry.redeem(link.searchParams.get("code")), null);
  registry.close();
  assert.equal(JSON.parse((await ow("/api/family")).data).people[0].devices, 1);
  assert.deepEqual(JSON.parse((await ow("/api/family/people/ana/revoke", jsonOpts({}))).data), { revoked: 1 });
  assert.equal(JSON.parse((await ow("/api/family")).data).people[0].devices, 0);
  assert.equal((await ow("/api/family/people/nobody/pair", jsonOpts({}))).status, 404);

  writeStatus("https://calm-fox-demo.trycloudflare.com", true, new Date(Date.now() - 120000));
  const stale = JSON.parse((await ow("/api/family")).data);
  assert.equal(stale.launcherRunning, false);
  assert.equal(stale.people[0].running, false, "a stale status file means stopped");
  assert.equal((await ow("/api/family/people/ana/pair", jsonOpts({}))).status, 409);

  const added = await ow("/api/family/people", jsonOpts({ name: "Beatriz Souza", port: 4202, language: "pt-BR", budgetUsd: 2.5, localOnly: true }));
  assert.equal(added.status, 201);
  assert.equal((await ow("/api/family/people", jsonOpts({ name: "Beatriz Souza", port: 4203 }))).status, 400, "duplicate folder name");
  assert.equal((await ow("/api/family/people", jsonOpts({ name: "X", port: 4202 }))).status, 400, "duplicate port");
  assert.equal((await ow("/api/family/people", jsonOpts({ name: "Y", port: 4173 }))).status, 400, "the owner's port is reserved");
  assert.equal((await ow("/api/family/people/beatriz-souza", jsonOpts({ name: "Beatriz Souza", port: 4202, budgetUsd: 4 }))).status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(adminDir, "family.json"), "utf8"));
  assert.equal(saved[1].budgetUsd, 4);
  assert.equal(saved[1].language, "pt-BR");
  assert.equal((await ow("/api/family/people/beatriz-souza", { method: "DELETE" })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(adminDir, "family.json"), "utf8")).length, 1);
  assert.equal(slugOf("José  Ávila!"), "jose-avila");
  assert.throws(() => cleanPeople([{ name: "CON", port: 4300 }]), /reserved/);
  assert.equal(childEnv({ name: "Ana", port: 4201 }, { dataDir: "d", ownerName: "o", base: { GROQ_API_KEY: "g", OPENAI_API_KEY: "o" } }).GROQ_API_KEY, undefined, "the owner's Groq key stays with the owner");
  assert.throws(() => cleanPeople([{ name: "!!!", port: 4300 }]), /letter or number/);
  assert.equal(createFamilyAdmin({ directory: tmp("empty") }).people().length, 0);
  O.close();

  for (const d of [ownerDir, dirA, dirB, queue, adminDir]) rm(d);
}

async function processTests() {
  const dir = tmp("proc");
  const run = (env) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, "server.cjs")], { env: { ...process.env, SPARK_DATA_DIR: fs.mkdtempSync(path.join(dir, "d-")), ...env }, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (out += c));
      child.on("exit", (code) => resolve({ code, out }));
      setTimeout(() => resolve({ code: null, out, child }), 2500);
    });
  const bad = await run({ SPARK_PORT: "80" });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /SPARK_PORT/);
  const port = 4390 + Math.floor(Math.random() * 90);
  const ok = await run({ SPARK_PORT: String(port) });
  assert.match(ok.out, new RegExp("http://127\\.0\\.0\\.1:" + port));
  const res = await new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port, path: "/api/family/self" }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => resolve(d)); }).on("error", reject));
  assert.deepEqual(JSON.parse(res), { family: false });
  ok.child.kill();
  const fam = await run({ SPARK_PORT: String(port + 1), SPARK_FAMILY_NAME: "Ana", SPARK_OWNER_NAME: "Joao", SPARK_PUBLIC_HOST: PUBLIC });
  const body = await new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port: port + 1, path: "/api/family/self" }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => resolve(d)); }).on("error", reject));
  assert.equal(JSON.parse(body).ownerName, "Joao");
  fam.child.kill();
  await sleep(300);
  rm(dir);
}

async function main() {
  await launcherTests();
  await queueTests();
  await costTests();
  await serverTests();
  await processTests();
  console.log("PASS: family launcher, GPU queue, per-person limits, public-host guard, pairing links, expiry, revocation, rate limit, isolation and owner defaults.");
}
main().then(() => process.exit(process.exitCode || 0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
