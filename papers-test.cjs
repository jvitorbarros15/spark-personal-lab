"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { searchPapers } = require("./papers.cjs");
const { providerManager } = require("./providers.cjs");

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const xml = (text) => ({ ok: true, status: 200, text: async () => text });
const status = (code) => ({ ok: false, status: code, json: async () => ({}), text: async () => "" });
const routed = (handlers) => {
  const calls = [];
  const f = async (url, opts) => {
    calls.push(url);
    assert.ok(opts.signal);
    assert.equal(opts.headers["User-Agent"], "Spark/2.0 (local research notebook)");
    const key = Object.keys(handlers).find((k) => url.startsWith(k));
    if (!key) throw new Error("unexpected url " + url);
    const h = handlers[key];
    return typeof h === "function" ? h(url) : h;
  };
  f.calls = calls;
  return f;
};
const OA = "https://api.openalex.org/works";
const CR = "https://api.crossref.org/works?";
const CRDOI = "https://api.crossref.org/works/";
const AX = "https://export.arxiv.org/api/query";

const work = {
  id: "https://openalex.org/W1",
  title: "Meal planning study",
  publication_year: 2022,
  doi: "https://doi.org/10.1/ABC",
  authorships: Array.from({ length: 7 }, (_, i) => ({ author: { display_name: "Author " + i } })),
  primary_location: { source: { display_name: "Journal of Food" }, landing_page_url: "https://example.com/p" },
  open_access: { oa_url: "https://example.com/oa.pdf" },
  abstract_inverted_index: { Meal: [0], planning: [1, 3], helps: [2] },
};
const crossrefItem = (doi, title, extra = {}) => ({
  DOI: doi,
  title: [title],
  author: [{ given: "Ada", family: "Lovelace" }, { given: "Alan", family: "Turing" }],
  issued: { "date-parts": [[2021]] },
  "container-title": ["Journal X"],
  ...extra,
});
const entry = (id, title, { authors = ["A One"], doi = "", summary = "Sum." } = {}) =>
  `<entry><id>http://arxiv.org/abs/${id}v2</id><published>2020-05-01T00:00:00Z</published><title>${title}</title><summary>${summary}</summary>${authors.map((a) => `<author><name>${a}</name></author>`).join("")}${doi ? `<arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">${doi}</arxiv:doi>` : ""}</entry>`;
const feed = (entries, total = entries.length) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><opensearch:totalResults>${total}</opensearch:totalResults>${entries.join("")}</feed>`;
const emptyFeed = feed([]);

(async () => {
  {
    const f = routed({
      [OA]: json({ meta: { count: 42 }, results: Array.from({ length: 10 }, (_, i) => ({ ...work, id: "W" + i, doi: "https://doi.org/10.1/abc" + i, title: "Meal planning study " + i })) }),
      [CRDOI]: (url) => json({ message: { title: ["Meal planning study " + /abc(\d)/.exec(url)[1]] } }),
    });
    const r = await searchPapers("meal planning", { page: 2, fetchImpl: f });
    assert.equal(f.calls[0], "https://api.openalex.org/works?search=meal%20planning&per-page=10&page=2");
    assert.equal(r.total, 42);
    assert.equal(r.page, 2);
    assert.equal(r.source, "OpenAlex");
    assert.deepEqual(r.sourcesTried, [{ name: "OpenAlex", ok: true, count: 10 }]);
    assert.ok(!Number.isNaN(Date.parse(r.fetched)));
    const p = r.results[0];
    assert.equal(p.authors.length, 5);
    assert.equal(p.year, 2022);
    assert.equal(p.venue, "Journal of Food");
    assert.equal(p.url, "https://doi.org/10.1/abc0");
    assert.equal(p.abstract, "Meal planning helps planning");
    assert.equal(p.openAccessUrl, "https://example.com/oa.pdf");
    assert.deepEqual(p.sources, ["OpenAlex"]);
    assert.deepEqual(p.verified, { by: "crossref", doi: "10.1/abc0" });
    assert.equal(r.results.length, 10);
    assert.ok(f.calls.every((u) => !u.startsWith(CR) && !u.startsWith(AX)));
  }

  {
    const f = routed({
      [OA]: status(429),
      [CR]: json({ message: { "total-results": 900, items: [crossrefItem("10.5/Quantum.1", "Quantum computing for astronomy", { abstract: "<jats:title>Abstract</jats:title><jats:p>We study <jats:italic>qubits</jats:italic> &amp; stars.</jats:p>" })] } }),
      [AX]: xml(feed([entry("2101.00001", "Quantum   annealing\n for telescopes", { authors: ["Ada Lovelace", "Alan Turing", "Grace Hopper"] })], 55)),
    });
    const r = await searchPapers("quantum astronomy", { fetchImpl: f });
    assert.deepEqual(r.sourcesTried, [
      { name: "OpenAlex", ok: false, count: 0, error: "rate-limited" },
      { name: "Crossref", ok: true, count: 1 },
      { name: "arXiv", ok: true, count: 1 },
    ]);
    assert.equal(r.source, "Crossref, arXiv");
    assert.equal(r.total, 900);
    assert.equal(r.results.length, 2);
    const [c, a] = r.results;
    assert.equal(c.abstract, "We study qubits & stars.");
    assert.deepEqual(c.authors, ["Ada Lovelace", "Alan Turing"]);
    assert.equal(c.year, 2021);
    assert.equal(c.venue, "Journal X");
    assert.equal(c.doi, "https://doi.org/10.5/quantum.1");
    assert.deepEqual(c.verified, { by: "crossref", doi: "10.5/quantum.1" });
    assert.ok(f.calls.some((u) => u.includes("rows=10") && u.includes("select=")));
    assert.ok(f.calls.includes("https://export.arxiv.org/api/query?search_query=all:quantum+astronomy&start=0&max_results=10"));
    assert.equal(a.title, "Quantum annealing for telescopes");
    assert.deepEqual(a.verified, { by: "arxiv", id: "2101.00001" });
    assert.equal(a.url, "https://arxiv.org/abs/2101.00001");
    assert.equal(a.openAccessUrl, "https://arxiv.org/pdf/2101.00001");
    assert.deepEqual(a.authors, ["Ada Lovelace", "Alan Turing", "Grace Hopper"]);
    assert.ok(!("arxivId" in a));
  }

  {
    const f = routed({
      [OA]: json({ meta: { count: 5 }, results: [{ ...work, doi: "https://doi.org/10.7/dup", title: "Shared Paper: A Study" }, { ...work, id: "W9", doi: null, title: "No DOI Paper" }] }),
      [CR]: json({ message: { "total-results": 3, items: [crossrefItem("10.7/DUP", "Shared paper a study"), crossrefItem("10.8/other", "Another one")] } }),
      [AX]: xml(feed([entry("1234.5678", "Shared Paper - A Study", { doi: "10.7/dup" }), entry("2222.3333", "no doi paper"), entry("4444.5555", "Brand new preprint")])),
      [CRDOI]: json({ message: { title: ["Shared paper a study"] } }),
    });
    const r = await searchPapers("shared", { fetchImpl: f });
    assert.equal(r.results.length, 4);
    const shared = r.results.find((p) => /shared paper/i.test(p.title));
    assert.deepEqual(shared.sources, ["OpenAlex", "Crossref", "arXiv"]);
    assert.deepEqual(shared.verified, { by: "crossref", doi: "10.7/dup" });
    const nodoi = r.results.find((p) => /no doi paper/i.test(p.title));
    assert.deepEqual(nodoi.sources, ["OpenAlex", "arXiv"]);
    assert.deepEqual(nodoi.verified, { by: "arxiv", id: "2222.3333" });
    assert.equal(nodoi.doi, null);
    assert.equal(r.results.filter((p) => p.sources.length === 1).length, 2);
  }

  {
    const f = routed({
      [OA]: json({ meta: { count: 2 }, results: [{ ...work, doi: "https://doi.org/10.9/good", title: "Good match title here" }, { ...work, id: "W3", doi: "https://doi.org/10.9/bad", title: "Totally different claimed title" }, { ...work, id: "W4", doi: "https://doi.org/10.9/gone", title: "Ghost DOI paper" }] }),
      [CR]: json({ message: { items: [] } }),
      [AX]: xml(emptyFeed),
      [CRDOI]: (url) => (url.endsWith("/10.9/good") ? json({ message: { title: ["Good Match Title Here"] } }) : url.endsWith("/10.9/bad") ? json({ message: { title: ["Unrelated work on glaciers"] } }) : status(404)),
    });
    const r = await searchPapers("x", { fetchImpl: f });
    assert.deepEqual(r.results.map((p) => p.title), ["Good match title here"]);
    assert.equal(r.total, 2);
    assert.deepEqual(r.sourcesTried.map((s) => [s.name, s.ok, s.count]), [["OpenAlex", true, 3], ["Crossref", true, 0], ["arXiv", true, 0]]);
  }

  {
    const f = routed({
      [OA]: json({ meta: { count: 2 }, results: ["c1", "c2"].map((d, i) => ({ ...work, id: "C" + i, doi: "https://doi.org/10.2/" + d, title: "Cached paper " + i })) }),
      [CR]: json({ message: { items: [] } }),
      [AX]: xml(emptyFeed),
      [CRDOI]: (url) => json({ message: { title: ["Cached paper " + (url.endsWith("c1") ? 0 : 1)] } }),
    });
    const lookups = () => f.calls.filter((u) => u.startsWith(CRDOI)).length;
    assert.equal((await searchPapers("cache", { fetchImpl: f })).results.length, 2);
    assert.equal(lookups(), 2);
    assert.equal((await searchPapers("cache again", { fetchImpl: f })).results.length, 2);
    assert.equal(lookups(), 2);
  }

  {
    let active = 0,
      peak = 0;
    const f = routed({
      [OA]: json({ meta: { count: 9 }, results: Array.from({ length: 9 }, (_, i) => ({ ...work, id: "P" + i, doi: "https://doi.org/10.3/p" + i, title: "Parallel paper " + i })) }),
      [CR]: json({ message: { items: [] } }),
      [AX]: xml(emptyFeed),
      [CRDOI]: async (url) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setImmediate(r));
        active--;
        return json({ message: { title: ["Parallel paper " + /p(\d)$/.exec(url)[1]] } });
      },
    });
    assert.equal((await searchPapers("parallel", { fetchImpl: f })).results.length, 9);
    assert.equal(peak, 4);
  }

  {
    const f = routed({
      [OA]: json({ meta: { count: 1 }, results: [{ ...work, doi: "https://doi.org/10.4/flaky", title: "Flaky lookup paper" }] }),
      [CR]: json({ message: { items: [] } }),
      [AX]: xml(emptyFeed),
      [CRDOI]: status(503),
    });
    assert.deepEqual((await searchPapers("flaky", { fetchImpl: f })).results, []);
    f.calls.length = 0;
    await searchPapers("flaky", { fetchImpl: f });
    assert.equal(f.calls.filter((u) => u.startsWith(CRDOI)).length, 2);
  }

  {
    const f = routed({
      [OA]: json({ meta: { count: 1 }, results: [{ ...work, doi: "https://doi.org/10.1/abc", title: "Meal planning study" }] }),
      [CR]: status(500),
      [AX]: xml(feed([entry("0000.0001", "Fish &amp; chips &lt;b&gt; &#955; &#x3b1; &quot;quoted&quot; &apos;x&apos;", { authors: ["Jean &amp; Co"], summary: "A &gt; B &amp;amp; C" })])),
      [CRDOI]: json({ message: { title: ["Meal planning study"] } }),
    });
    const r = await searchPapers("entities", { fetchImpl: f });
    const a = r.results.find((p) => p.sources.includes("arXiv"));
    assert.equal(a.title, "Fish & chips <b> λ α \"quoted\" 'x'");
    assert.deepEqual(a.authors, ["Jean & Co"]);
    assert.equal(a.abstract, "A > B &amp; C");
    assert.deepEqual(r.sourcesTried.map((s) => s.ok), [true, false, true]);
    assert.equal(r.sourcesTried[1].error, "HTTP 500");
  }

  await assert.rejects(
    searchPapers("x", { fetchImpl: routed({ [OA]: status(429), [CR]: status(503), [AX]: () => { throw new Error("offline"); } }) }),
    (e) => e.status === 502 && /Paper search unavailable: OpenAlex: rate-limited; Crossref: HTTP 503; arXiv: offline\./.test(e.message),
  );

  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => realSetTimeout(fn, 0);
  try {
    const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    await assert.rejects(searchPapers("x", { fetchImpl: hang }), (e) => e.status === 502 && /OpenAlex: timed out; Crossref: timed out; arXiv: timed out/.test(e.message));
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
      return url.startsWith(AX) ? xml(emptyFeed) : json({ meta: { count: 0 }, results: [], message: { items: [] } });
    };
    const openAlexUrl = () => seen.filter((u) => u.startsWith(OA)).pop();
    await searchPapers("meal planning", { fetchImpl: capture, apiKey: manager.openAlexKey() });
    assert.equal(openAlexUrl(), "https://api.openalex.org/works?search=meal%20planning&per-page=10&page=1");

    assert.deepEqual(manager.update({ provider: "openalex", key: "oa-test-key" }), { configured: true, source: "local secrets file" });
    assert.equal(manager.openAlexStatus().configured, true);
    await searchPapers("meal planning", { fetchImpl: capture, apiKey: manager.openAlexKey() });
    assert.equal(openAlexUrl(), "https://api.openalex.org/works?search=meal%20planning&per-page=10&page=1&api_key=oa-test-key");
    assert.ok(!JSON.stringify(manager.status()).includes("oa-test-key"));
    assert.ok(seen.filter((u) => !u.startsWith(OA)).every((u) => !u.includes("oa-test-key")));
    process.env.OPENALEX_API_KEY = "env-test-key";
    assert.equal(manager.openAlexKey(), "env-test-key");
    assert.equal(manager.openAlexStatus().source, "environment");
    delete process.env.OPENALEX_API_KEY;

    manager.update({ provider: "openalex", key: "" });
    assert.equal(manager.openAlexStatus().configured, false);
    await searchPapers("meal planning", { fetchImpl: capture, apiKey: manager.openAlexKey() });
    assert.equal(openAlexUrl(), "https://api.openalex.org/works?search=meal%20planning&per-page=10&page=1");
  } finally {
    if (savedEnv !== undefined) process.env.OPENALEX_API_KEY = savedEnv;
  }
  console.log("Papers tests passed");
})().catch((e) => { console.error(e); process.exitCode = 1; });
