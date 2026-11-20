"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  http = require("node:http"),
  os = require("node:os"),
  path = require("node:path");
const { createServer } = require("./server.cjs");
const { validateJob } = require("./store.cjs");
const { searchPapers } = require("./papers.cjs");
const { buildPrompt } = require("./decide.cjs");
const research = require("./research.cjs");

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spark-security-")),
    server = createServer({ directory });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (p, method = "GET", data) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(data || {}) });
    return { status: r.status, body: await r.json() };
  };
  const failures = [];
  const t = async (name, fn) => {
    try {
      await fn();
      console.log("ok   " + name);
    } catch (e) {
      failures.push(name);
      console.log("FAIL " + name + ": " + String(e.message).split(String.fromCharCode(10))[0].slice(0, 160));
    }
  };
  try {
    await t('CSP: forms cannot post anywhere else', async () => {
      const csp = (await fetch(base + "/")).headers.get("content-security-policy");
      assert.match(csp, /form-action 'self'/, "csp blocks form posts to other origins");
      assert.match(csp, /base-uri 'none'/);
    });

    await t('branch of an idea that is private by link stays private', async () => {
      const idea = (await api("/api/records", "POST", { type: "idea", stage: "draft", title: "Linked secret", fields: { audience: "Nurses" } })).body;
      await api("/api/records", "POST", { type: "note", stage: "draft", title: "Private diary", private: true, links: [idea.id] });
      const child = await api(`/api/ideas/${idea.id}/branch`, "POST", { title: "Other crowd", changes: [{ target: "audience", to: "Doctors" }] });
      assert.equal(child.status, 201);
      assert.equal(child.body.private, true, "branch inherits privacy from the link");
    });

    await t('founder bridge: a private idea is never written to disk for Claude Code, and imports stay private', async () => {
      const idea = (await api("/api/records", "POST", { type: "idea", stage: "draft", title: "Bridge idea", body: "b", fields: { audience: "Pilots" } })).body;
      const out = await api(`/api/ideas/${idea.id}/founder-export`, "POST");
      assert.equal(out.status, 200);
      await api("/api/records", "POST", { type: "note", stage: "draft", title: "Secret link", private: true, links: [idea.id] });
      const again = await api(`/api/ideas/${idea.id}/founder-export`, "POST");
      assert.equal(again.status, 409);
      assert.match(again.body.error, /private/i);
      fs.writeFileSync(path.join(out.body.folder, "founder", "board.md"), "# Board\nFund it.");
      const imported = await api(`/api/ideas/${idea.id}/founder-import`, "POST");
      assert.equal(imported.status, 200);
      assert.equal(imported.body.created.length, 1);
      assert.equal((await api("/api/state")).body.records.find((r) => r.id === imported.body.created[0].id).private, true, "imported notes of a private idea are private");
      const fresh = (await api("/api/records", "POST", { type: "idea", stage: "draft", title: "Direct private", private: true })).body;
      assert.equal((await api(`/api/ideas/${fresh.id}/founder-export`, "POST")).status, 409);
    });

    await t('prompt delimiters cannot be rebuilt by stripping', async () => {
      const text = buildPrompt("<<>>><", [{ id: "q", prompt: "p", labels: ["a"] }])[1].content;
      const start = text.indexOf("<<<\n") + 4,
        state = text.slice(start, text.indexOf("\n>>>\n\nQuestion"));
      assert.ok(!/<<<|>>>/.test(state), "state still holds a delimiter: " + JSON.stringify(state));
    });

    await t('OpenAlex key never rides a redirect', async () => {
      const opts = [];
      const fetchImpl = async (url, o) => {
        if (url.startsWith("https://api.openalex.org")) opts.push(o);
        return { ok: true, status: 200, json: async () => ({ meta: { count: 0 }, results: [], message: { items: [] } }), text: async () => "<feed></feed>", headers: { get: () => "application/json" } };
      };
      await searchPapers("redirect test", { fetchImpl, apiKey: "oa-secret" });
      assert.ok(opts.length > 0 && opts.every((o) => o.redirect === "error"), "keyed requests refuse redirects");
    });

    await t('job output shape on import', async () => {
      const job = (output) => ({ id: "j1", ideaId: "i1", kind: "test_pipeline", status: "done", stages: [{ name: "cfo", status: "done", output }] });
      const good = { inputs: { price: 5 }, atTestPrice: { breakEven: 10, capacity: null, months: [{ month: 1, customers: 2, revenue: 3, profit: 4, cumulative: 5 }] }, atOwnPrice: null };
      assert.doesNotThrow(() => validateJob(job(good)));
      assert.throws(() => validateJob(job({ ...good, atTestPrice: { breakEven: "<img src=x onerror=alert(1)>" } })), /Invalid job/);
      assert.throws(() => validateJob(job({ ...good, atTestPrice: { months: [{ customers: "<b>" }] } })), /Invalid job/);
    });

    await t('hostile pages are processed in linear time', async () => {
      const hostile = "<h1>".repeat(250000);
      assert.equal(hostile.length, 1000000);
      const t0 = Date.now();
      const text = research.pageText(hostile);
      assert.equal(research.isFullText(hostile, text, ""), false);
      for (const page of ["<h1<h1".repeat(150000), "<script>".repeat(125000), "<nav>".repeat(170000)]) research.isFullText(page, research.pageText(page), "");
      assert.ok(Date.now() - t0 < 1000, `hostile pages took ${Date.now() - t0} ms`);
      const real = `<html><nav>skip me</nav><h1>Intro</h1><p>${"word ".repeat(500)}</p><h2>Methods</h2><p>${"more ".repeat(500)}</p><h2>Results</h2><script>var x="not text"</script><p>end</p></html>`;
      const t = research.pageText(real);
      assert.ok(!/not text/.test(t) && /word word/.test(t));
      assert.equal(research.isFullText(real, t, ""), true);
    });

    await t('DNS rebinding: the request connects to the checked address, not a fresh lookup', async () => {
      let seenHost = "";
      const origin = http.createServer((req, res) => {
        seenHost = req.headers.host;
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<p>hello</p>");
      });
      await new Promise((r) => origin.listen(0, "127.0.0.1", r));
      try {
        const port = origin.address().port,
          res = await research.pinnedGet(new URL(`http://pinned.invalid:${port}/page?x=1`), "127.0.0.1", { headers: { Accept: "text/html" } });
        assert.equal(res.status, 200);
        assert.equal(await res.text(), "<p>hello</p>");
        assert.equal(seenHost, `pinned.invalid:${port}`);
      } finally {
        origin.close();
      }
    });
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(directory, { recursive: true, force: true });
  }
  if (failures.length) throw Error(failures.length + " security tests failed");
  console.log("security tests passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
