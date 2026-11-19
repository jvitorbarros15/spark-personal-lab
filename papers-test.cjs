"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { searchPapers } = require("./papers.cjs");
const { providerManager } = require("./providers.cjs");

const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const work = {
  id: "https://openalex.org/W1",
  title: "Meal planning study",
  publication_year: 2022,
  doi: "https://doi.org/10.1/abc",
  authorships: Array.from({ length: 7 }, (_, i) => ({ author: { display_name: "Author " + i } })),
  primary_location: { source: { display_name: "Journal of Food" }, landing_page_url: "https://example.com/p" },
  open_access: { oa_url: "https://example.com/oa.pdf" },
  abstract_inverted_index: { Meal: [0], planning: [1, 3], helps: [2] },
};

(async () => {
  let called;
  const r = await searchPapers("meal planning", {
    page: 2,
    fetchImpl: async (url, opts) => {
      called = url;
      assert.ok(opts.signal);
      return { ok: true, json: async () => ({ meta: { count: 42 }, results: [work] }) };
    },
  });
  assert.equal(called, "https://api.openalex.org/works?search=meal%20planning&per-page=10&page=2");
  assert.equal(r.total, 42);
  assert.equal(r.page, 2);
  assert.equal(r.source, "OpenAlex");
  assert.ok(!Number.isNaN(Date.parse(r.fetched)));
  const p = r.results[0];
  assert.equal(p.authors.length, 5);
  assert.equal(p.year, 2022);
  assert.equal(p.venue, "Journal of Food");
  assert.equal(p.url, "https://doi.org/10.1/abc");
  assert.equal(p.abstract, "Meal planning helps planning");
  assert.equal(p.openAccessUrl, "https://example.com/oa.pdf");

  const bare = await searchPapers("x", { fetchImpl: ok({ meta: { count: 1 }, results: [{ id: "https://openalex.org/W2", title: "No abstract", abstract_inverted_index: null, open_access: { oa_url: "javascript:alert(1)" } }] }) });
  assert.equal(bare.results[0].abstract, null);
  assert.equal(bare.results[0].venue, null);
  assert.equal(bare.results[0].openAccessUrl, null);
  assert.equal(bare.results[0].url, "https://openalex.org/W2");

  const none = await searchPapers("zzz", { fetchImpl: ok({ meta: { count: 0 }, results: [] }) });
  assert.deepEqual(none.results, []);
  assert.equal(none.total, 0);

  await assert.rejects(searchPapers("x", { fetchImpl: async () => ({ ok: false, status: 500 }) }), (e) => e.status === 502 && /OpenAlex unavailable/.test(e.message));
  await assert.rejects(searchPapers("x", { fetchImpl: async () => { throw new Error("offline"); } }), (e) => e.status === 502 && /offline/.test(e.message));

  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => realSetTimeout(fn, 0);
  try {
    await assert.rejects(
      searchPapers("x", { fetchImpl: (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) }),
      (e) => e.status === 502 && /timed out/.test(e.message),
    );
  } finally {
    global.setTimeout = realSetTimeout;
  }
  const savedEnv = process.env.OPENALEX_API_KEY;
  delete process.env.OPENALEX_API_KEY;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-papers-test-"));
    const manager = providerManager(dir);
    assert.equal(manager.openAlexStatus().configured, false);
    const seen = [];
    const capture = async (url) => {
      seen.push(url);
      return { ok: true, json: async () => ({ meta: { count: 0 }, results: [] }) };
    };
    await searchPapers("meal planning", { fetchImpl: capture, apiKey: manager.openAlexKey() });
    assert.equal(seen[0], "https://api.openalex.org/works?search=meal%20planning&per-page=10&page=1");

    assert.deepEqual(manager.update({ provider: "openalex", key: "oa-test-key" }), { configured: true, source: "local secrets file" });
    assert.equal(manager.openAlexStatus().configured, true);
    await searchPapers("meal planning", { fetchImpl: capture, apiKey: manager.openAlexKey() });
    assert.equal(seen[1], "https://api.openalex.org/works?search=meal%20planning&per-page=10&page=1&api_key=oa-test-key");
    assert.ok(!JSON.stringify(manager.status()).includes("oa-test-key"));
    process.env.OPENALEX_API_KEY = "env-test-key";
    assert.equal(manager.openAlexKey(), "env-test-key");
    assert.equal(manager.openAlexStatus().source, "environment");
    delete process.env.OPENALEX_API_KEY;

    manager.update({ provider: "openalex", key: "" });
    assert.equal(manager.openAlexStatus().configured, false);
    await searchPapers("meal planning", { fetchImpl: capture, apiKey: manager.openAlexKey() });
    assert.equal(seen[2], seen[0]);
  } finally {
    if (savedEnv !== undefined) process.env.OPENALEX_API_KEY = savedEnv;
  }
  console.log("Papers tests passed");
})().catch((e) => { console.error(e); process.exitCode = 1; });
