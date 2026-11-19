"use strict";
const assert = require("node:assert/strict"),
  http = require("node:http"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createServer } = require("./server.cjs");
const { ROLES } = require("./providers.cjs");
const { validateSession } = require("./store.cjs");
const frame = (obj) => "data: " + JSON.stringify(obj) + "\n\n";
async function main() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "spark-integration-"),
  );
  const requests = [],
    attempts = new Map();
  let active = 0,
    peak = 0;
  const upstream = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
      return;
    }
    const body = JSON.parse(raw);
    requests.push(body);
    const n = (attempts.get(body.model) || 0) + 1;
    attempts.set(body.model, n);
    if (body.model === "fails-once" && n === 1) {
      res.writeHead(503);
      res.end();
      return;
    }
    active++;
    peak = Math.max(peak, active);
    let finished = false;
    res.on("close", () => {
      if (!finished) {
        active--;
        finished = true;
      }
    });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      frame({
        choices: [
          {
            delta: { content: "Reply from " + body.model },
            finish_reason: null,
          },
        ],
      }),
    );
    if (body.model === "slow") return;
    setTimeout(() => {
      if (!finished) {
        res.write(
          frame({
            choices: [{ delta: { content: "." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 20, completion_tokens: 5 },
          }),
        );
        res.end("data: [DONE]\n\n");
      }
    }, 25);
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  let server = createServer({
    directory,
    testBases: { local: `http://127.0.0.1:${upstream.address().port}/v1` },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = "GET", data, headers = {}) =>
    fetch(base + url, {
      method,
      headers: {
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const json = async (url, method = "GET", data) => {
    const res = await request(url, method, data),
      value = await res.json();
    assert.ok(res.ok, JSON.stringify(value));
    return value;
  };
  const events = async (data) => {
    const res = await request("/api/chat", "POST", data);
    assert.equal(res.status, 200);
    return (await res.text()).trim().split("\n").map(JSON.parse);
  };
  const agent = (id, model = id) => ({
    id,
    name: id,
    role: id === "B" ? "skeptic" : "builder",
    provider: "local",
    model,
    instruction: "",
  });
  const session = (overrides) =>
    json("/api/sessions", "POST", {
      title: "Testing",
      mode: "parallel",
      agents: [agent("A"), agent("B")],
      contextIds: [],
      rounds: 1,
      localOnly: true,
      ...overrides,
    });
  try {
    assert.equal((await request("/")).status, 200);
    assert.equal((await request("/assets/app.js?x=1")).status, 200);
    assert.equal((await request("/assets/style.css", "HEAD")).status, 200);
    assert.equal((await request("/missing")).status, 404);
    assert.equal(
      (
        await request("/api/state", "GET", undefined, {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    const badHost = await new Promise((resolve, reject) => {
      http
        .get(
          base + "/api/state",
          { headers: { Host: "evil.example" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        )
        .on("error", reject);
    });
    assert.equal(badHost, 403);
    assert.equal(
      (
        await request("/api/state", "GET", undefined, {
          "Sec-Fetch-Site": "cross-site",
        })
      ).status,
      403,
    );
    assert.equal((await request("/data/secrets.json")).status, 404);
    assert.equal((await json("/api/state")).records.length, 0);
    assert.equal(
      (await request("/api/records", "POST", { type: "invalid", title: "x" }))
        .status,
      400,
    );
    const record = await json("/api/records", "POST", {
      type: "problem",
      stage: "exploring",
      title: "Real pain",
      body: "Evidence",
      fields: { people: "Independent workers" },
      links: [],
    });
    const newestBackup = async () => (await json("/api/backups")).backups[0];
    const afterCreate = await newestBackup();
    await json("/api/records/" + record.id, "PATCH", { title: "Updated pain" });
    await json("/api/records/" + record.id, "PATCH", { title: "Typing pause" });
    assert.equal(await newestBackup(), afterCreate, "Edits within five minutes should not write another backup.");
    await json("/api/records/" + record.id, "DELETE");
    assert.notEqual(await newestBackup(), afterCreate, "Deletes should back up immediately.");
    assert.ok((await json("/api/state")).records[0].deleted);
    await json("/api/records/" + record.id, "PATCH", { deleted: null });
    const file = await json("/api/attachments", "POST", {
      recordId: record.id,
      name: "evidence.txt",
      contentBase64: Buffer.from("Selected attachment evidence").toString(
        "base64",
      ),
    });
    const selected = await json("/api/context", "POST", { ids: [record.id] });
    assert.match(selected.text, /Selected attachment evidence/);
    assert.ok(
      !(await json("/api/context", "POST", { ids: [] })).text.includes(
        "Selected attachment evidence",
      ),
    );
    await json("/api/providers", "POST", {
      provider: "openai",
      key: "private-test-secret",
    });
    assert.ok(
      !JSON.stringify(await json("/api/providers")).includes(
        "private-test-secret",
      ),
    );
    const exp = await json("/api/export");
    assert.equal(exp.attachments.length, 1);
    assert.ok(!JSON.stringify(exp).includes("private-test-secret"));
    const invalid = { ...exp, records: [...exp.records, { type: "bogus" }] };
    assert.equal(
      (
        await request("/api/import", "POST", {
          archive: invalid,
          mode: "replace",
        })
      ).status,
      400,
    );
    assert.equal((await json("/api/state")).records[0].deleted, null);
    const mathFields = { currency: "USD", price: "100", variableCost: "30", fixedCosts: "500", hoursPerCustomer: "2", availableHours: "100" };
    const idea = await json("/api/records", "POST", { type: "idea", stage: "draft", title: "Math idea", fields: mathFields, links: [] });
    assert.deepEqual((await json("/api/state")).records.find((r) => r.id === idea.id).fields, mathFields);
    const s = await session({ contextIds: [record.id] });
    let sent = await events({
      sessionId: s.id,
      prompt: "Independent proposals.",
    });
    assert.equal(
      sent.filter(
        (e) => e.event === "message_done" && e.message.status === "complete",
      ).length,
      2,
    );
    assert.ok(peak >= 2, "Participants should run concurrently.");
    const firstInputs = requests.slice(0, 2);
    assert.ok(
      firstInputs.every(
        (r) => !JSON.stringify(r.messages).includes("Reply from"),
      ),
    );
    assert.ok(
      firstInputs.every((r) =>
        JSON.stringify(r.messages).includes("Selected attachment evidence"),
      ),
    );
    const stored = (await json("/api/state")).messages.filter(
      (m) => m.sessionId === s.id,
    );
    assert.equal(stored.length, 3);
    const exact = await json("/api/message-context", "POST", {
      id: stored.find((m) => m.agent?.id === "A").id,
    });
    assert.deepEqual(
      exact.messages,
      firstInputs.find((r) => r.model === "A").messages,
    );
    for (const role of ["boardOffer", "boardMonopoly", "boardProduct", "competitorScout", "cfo", "launchLead"]) {
      assert.ok(ROLES[role].length < 1200, role);
      const founder = await session({
        agents: [{ ...agent("A"), role }],
        mode: "solo",
      });
      await events({ sessionId: founder.id, prompt: "Review." });
      assert.ok(requests.at(-1).messages[0].content.includes(ROLES[role]), role);
    }
    const count = requests.length;
    sent = await events({ sessionId: s.id, prompt: "Only B.", agentId: "B" });
    assert.equal(requests.length, count + 1);
    assert.equal(requests.at(-1).model, "B");
    const team = await session({ mode: "team", rounds: 2 });
    const begin = requests.length;
    sent = await events({ sessionId: team.id, prompt: "Discuss." });
    assert.equal(sent.filter((e) => e.event === "message_done").length, 4);
    assert.ok(JSON.stringify(requests[begin + 2]).includes("PRIOR ROUND"));
    assert.ok(JSON.stringify(requests[begin + 2]).includes("Reply from B"));
    sent = await events({
      sessionId: team.id,
      action: "synthesize",
      moderator: agent("Moderator", "A"),
    });
    assert.equal(
      sent.find((e) => e.event === "message_done").message.agent.role,
      "moderator",
    );
    const flaky = await session({
      agents: [agent("Good"), agent("Flaky", "fails-once")],
    });
    sent = await events({ sessionId: flaky.id, prompt: "Test failures." });
    const failed = sent.find(
        (e) => e.event === "message_done" && e.message.status === "failed",
      ).message,
      priorCount = requests.length;
    sent = await events({
      sessionId: flaky.id,
      action: "retry",
      messageId: failed.id,
    });
    assert.equal(requests.length, priorCount + 1);
    assert.equal(
      sent.find((e) => e.event === "message_done").message.status,
      "complete",
    );
    assert.equal(
      sent.find((e) => e.event === "message_done").message.id,
      failed.id,
    );
    assert.equal(
      (
        await request("/api/chat", "POST", {
          sessionId: flaky.id,
          action: "retry",
          messageId: failed.id,
        })
      ).status,
      400,
    );
    const restricted = await session({
      agents: [{ ...agent("Cloud"), provider: "openai" }],
    });
    assert.equal(
      (
        await request("/api/chat", "POST", {
          sessionId: restricted.id,
          prompt: "Must stay local",
        })
      ).status,
      400,
    );
    const slow = await session({
      mode: "solo",
      agents: [agent("Slow", "slow")],
    });
    const response = await request("/api/chat", "POST", {
        sessionId: slow.id,
        prompt: "Wait",
      }),
      reader = response.body.getReader();
    let partial = "",
      runId;
    while (!runId) {
      const chunk = await reader.read();
      partial += new TextDecoder().decode(chunk.value);
      for (const line of partial.split("\n").filter(Boolean)) {
        try {
          const e = JSON.parse(line);
          if (e.event === "start") runId = e.runId;
        } catch {}
      }
    }
    assert.equal(
      (
        await request("/api/sessions/" + slow.id, "PATCH", {
          title: "No edits during run",
        })
      ).status,
      409,
    );
    await json("/api/runs/" + runId + "/cancel", "POST", {});
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      partial += new TextDecoder().decode(chunk.value);
    }
    assert.match(partial, /cancelled/);
    const backup = await json("/api/export");
    assert.ok(backup.messages.some((m) => m.status === "cancelled"));
    await json("/api/import", "POST", { archive: backup, mode: "merge" });
    assert.ok((await json("/api/backups")).backups.length <= 20);
    const databaseFile = path.join(directory, "spark.sqlite");
    assert.ok(fs.statSync(databaseFile).size > 0);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server = createServer({
      directory,
      testBases: { local: `http://127.0.0.1:${upstream.address().port}/v1` },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    assert.ok(
      (await json("/api/state")).records.some((r) => r.id === record.id),
    );
    assert.ok((await json("/api/state")).messages.length > 0);
    assert.equal(
      (await request("/api/attachments/" + file.id + "/download")).status,
      200,
    );
    assert.equal(
      validateSession({
        title: "x",
        agents: [],
        contextIds: [],
        mode: "team",
        rounds: 2.8,
      }).rounds,
      2,
    );
    const beforeExtraReply = await json("/api/export");
    await events({sessionId: s.id, prompt: "A reply after the snapshot", agentId: "A"});
    await json("/api/import", "POST", {archive: beforeExtraReply, mode: "replace"});
    assert.equal((await json("/api/state")).messages.filter(m => m.sessionId === s.id).length, beforeExtraReply.messages.filter(m => m.sessionId === s.id).length);
    await json("/api/import", "POST", {mode: "merge", archive: {version: 1, records: [
      {id: "untouched", type: "ideas", title: "Sample", description: "", demo: true},
      {id: "mine", type: "ideas", title: "Personal", description: "My notes", stage: "Exploring", demo: false}
    ]}});
    const migrated = (await json("/api/state")).records;
    assert.ok(migrated.some(r => r.id === "legacy-mine" && r.body === "My notes"));
    assert.ok(!migrated.some(r => r.id === "legacy-untouched"));
    console.log(
      "PASS: HTTP routes, origin/host guards, empty start, SQLite durability, CRUD/trash, context/files, backups/import, parallel isolation, targeted replies, team rounds, synthesis, failure/retry and cancellation.",
    );
  } finally {
    for (const r of server.runs.values()) r.controller.abort();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
    assert.ok(
      path
        .resolve(directory)
        .startsWith(
          path.resolve(os.tmpdir()) + path.sep + "spark-integration-",
        ),
    );
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
