"use strict";
const assert = require("node:assert/strict");
const { createWebSearch } = require("./websearch.cjs");

const KEY = "sk-secret-abc-123";
const reply = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Map(Object.entries(headers)), text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

async function main() {
  {
    const calls = [];
    const ws = createWebSearch({
      key: () => KEY,
      fetchImpl: async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        if (url.endsWith("/web_search")) return reply({ results: [{ title: "A <<<x>>>", url: "https://a.test/p", content: "snippet  text" }, { title: "Local", url: "http://192.168.1.5/x", content: "no" }, { title: "NoUrl", content: "x" }] });
        return reply({ title: "Page", content: "x".repeat(20000) });
      },
    }).forJob({ cap: 5 });
    assert.equal(ws.available(), true);
    const res = await ws.search("best tools", { max: 99 });
    assert.deepEqual(res, [{ title: "A x", url: "https://a.test/p", content: "snippet text" }]);
    assert.equal(calls[0].url, "https://ollama.com/api/web_search");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer " + KEY);
    assert.equal(calls[0].init.redirect, "manual");
    assert.deepEqual(calls[0].body, { query: "best tools", max_results: 10 });
    const page = await ws.fetchPage("https://a.test/p");
    assert.equal(calls[1].url, "https://ollama.com/api/web_fetch");
    assert.deepEqual(calls[1].body, { url: "https://a.test/p" });
    assert.equal(page.content.length, 6000);
    assert.equal(ws.used(), 2);
  }

  {
    let n = 0;
    const jobs = createWebSearch({ key: () => KEY, fetchImpl: async () => (n++, reply({ results: [] })) });
    const priv = jobs.forJob({ private: true });
    assert.equal(priv.available(), false);
    await assert.rejects(priv.search("x"), /Private entries never use web search/);
    await assert.rejects(priv.fetchPage("https://a.test/"), /Private entries/);
    const nokey = createWebSearch({ key: () => "", fetchImpl: async () => (n++, reply({})) }).forJob();
    assert.equal(nokey.available(), false);
    await assert.rejects(nokey.search("x"), /No web search key/);
    assert.equal(n, 0, "zero requests for private entries and for a missing key");
  }

  {
    let n = 0;
    const ws = createWebSearch({ key: () => KEY, fetchImpl: async () => (n++, reply({ results: [] })) }).forJob({ cap: 2, used: 0 });
    await ws.search("a");
    await ws.search("b");
    await assert.rejects(ws.search("c"), (e) => e.webCap === true && /limit/.test(e.message));
    await assert.rejects(ws.fetchPage("https://a.test/"), (e) => e.webCap === true);
    assert.equal(n, 2);
    const resumed = createWebSearch({ key: () => KEY, fetchImpl: async () => reply({ results: [] }) }).forJob({ cap: 3, used: 3 });
    await assert.rejects(resumed.search("a"), (e) => e.webCap);
  }

  {
    const redirect = createWebSearch({ key: () => KEY, fetchImpl: async () => reply("", 302, { location: "http://169.254.169.254/" }) }).forJob();
    await assert.rejects(redirect.search("x"), /refused a redirect/);
    await assert.rejects(redirect.fetchPage("https://a.test/"), /refused a redirect/);

    let n = 0;
    const ssrf = createWebSearch({ key: () => KEY, fetchImpl: async () => (n++, reply({})) }).forJob();
    for (const u of ["http://127.0.0.1/", "http://localhost/x", "http://10.0.0.1/", "file:///etc/passwd", "https://user:pw@a.test/", "http://[::1]/", "not a url"]) await assert.rejects(ssrf.fetchPage(u), /not a public web page/, u);
    assert.equal(n, 0);
  }

  {
    const leaky = createWebSearch({ key: () => KEY, fetchImpl: async () => { throw Error("connect failed for Bearer " + KEY); } });
    await assert.rejects(leaky.forJob().search("x"), (e) => !e.message.includes(KEY) && /\[redacted\]/.test(e.message));
    assert.equal(leaky.redact("a " + KEY + " b"), "a [redacted] b");
    for (const [status, re] of [[401, /key was rejected/], [429, /rate limit/], [500, /status 500/]]) {
      const ws = createWebSearch({ key: () => KEY, fetchImpl: async () => reply("server said " + KEY, status) }).forJob();
      await assert.rejects(ws.search("x"), (e) => re.test(e.message) && !e.message.includes(KEY));
    }
    await assert.rejects(createWebSearch({ key: () => KEY, fetchImpl: async () => reply("<html>") }).forJob().search("x"), /not JSON/);
    await assert.rejects(createWebSearch({ key: () => KEY, fetchImpl: async () => reply({ results: [] }, 200, { "content-length": "99999999" }) }).forJob().search("x"), /too large/);
  }

  {
    const logs = [];
    const ws = createWebSearch({ key: () => KEY, fetchImpl: async () => reply({ results: [{ title: "t", url: "https://a.test/", content: "c" }] }) }).forJob({ onCall: (e) => logs.push(e) });
    await ws.search("q1");
    await ws.fetchPage("https://a.test/");
    assert.deepEqual(logs.map((e) => e.kind), ["search", "fetch"]);
    assert.ok(!JSON.stringify(logs).includes(KEY));
  }
  console.log("websearch tests passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
