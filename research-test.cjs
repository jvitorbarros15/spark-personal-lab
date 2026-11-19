"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { openStore, validateRecord } = require("./store.cjs");
const { createAssistant } = require("./assistant.cjs");
const { createPipeline } = require("./pipeline.cjs");
const { createServer } = require("./server.cjs");
const { exactQuote, stripBadQuotes, bibtex, doiList, publicUrl, isFullText } = require("./research.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "spark-research-"));
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => "application/json" } });
const html = (text) => ({ ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => text });
const xml = (text) => ({ ok: true, status: 200, headers: { get: () => "application/atom+xml" }, text: async () => text });

const abstractOf = (n) => `Quantum phase estimation speeds up telescope pipelines number ${n}. We evaluate on simulated visibility data from ${n} antennas.`;
const titleOf = (n) => `Quantum telescope paper ${n}`;
const index = (text) => {
  const out = {};
  text.split(" ").forEach((w, i) => (out[w] ||= []).push(i));
  return out;
};
const work = (id, doi, title, extra = {}) => ({
  id: "https://openalex.org/W" + id,
  doi: "https://doi.org/" + doi,
  title,
  publication_year: 2020 + (id % 5),
  authorships: [{ author: { display_name: "Ada Lovelace" } }, { author: { display_name: "Alan Turing" } }],
  primary_location: { source: { display_name: "Journal of Quantum Sky" } },
  ...extra,
});
const paper = (n) => work(n, `10.1/p${n}`, titleOf(n), { ...(n === 7 ? {} : { abstract_inverted_index: index(abstractOf(n)) }), ...(n === 4 ? { open_access: { oa_url: "https://oa.test/p4.html" } } : {}) });
const ghost = work(999, "10.1/ghost", "A paper that does not exist");
const CROSSREF_TITLES = { "10.1/r201": "Referenced work 201", "10.1/c301": "Citing work 301" };

function stubFetch(counter = {}) {
  const f = async (url) => {
    counter.n = (counter.n || 0) + 1;
    if (url.startsWith("https://oa.test/")) return html("<html><body><h2>1 Introduction</h2><p>" + "Full text about quantum telescope processing. ".repeat(40) + "</p><h2>2 Methods</h2><p>" + "More method detail text. ".repeat(40) + "</p><h2>References</h2></body></html>");
    if (url.startsWith("https://api.openalex.org/works?")) {
      if (url.includes("filter=doi:")) {
        const n = /p(\d+)/.exec(decodeURIComponent(url))?.[1];
        return json({ results: n ? [{ ...paper(Number(n)), id: "https://openalex.org/W" + (100 + Number(n)), referenced_works: ["https://openalex.org/W201", "https://openalex.org/W202"] }] : [] });
      }
      if (url.includes("filter=openalex:")) return json({ results: [work(201, "10.1/r201", "Referenced work 201", { abstract_inverted_index: index("A referenced work about quantum sensing.") }), work(202, "10.1/ghostr", "Referenced ghost")] });
      if (url.includes("filter=cites:")) return json({ results: [work(301, "10.1/c301", "Citing work 301", { abstract_inverted_index: index("A later work that cites the seed.") })] });
      const q = decodeURIComponent(/search=([^&]*)/.exec(url)[1]);
      const ids = q.includes("narrow") ? [6, 7, 8, 9, 10, 11, 12] : [1, 2, 3, 4, 5, 6, 7, 8];
      return json({ meta: { count: ids.length }, results: [...ids.map(paper), ghost] });
    }
    if (url.startsWith("https://api.crossref.org/works?")) return json({ message: { items: [], "total-results": 0 } });
    if (url.startsWith("https://api.crossref.org/works/")) {
      const doi = decodeURIComponent(url.slice("https://api.crossref.org/works/".length));
      const m = /^10\.1\/p(\d+)$/.exec(doi);
      if (m) return json({ message: { title: [titleOf(m[1])] } });
      if (CROSSREF_TITLES[doi]) return json({ message: { title: [CROSSREF_TITLES[doi]] } });
      return json({}, 404);
    }
    if (url.startsWith("https://export.arxiv.org/")) return xml(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><opensearch:totalResults>0</opensearch:totalResults></feed>`);
    throw Error("unexpected url " + url);
  };
  return f;
}

const wait = async (pipeline, id, statuses, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const j = pipeline.get(id);
    if (statuses.includes(j.status)) return j;
    if (Date.now() > end) throw Error(`timeout waiting for ${statuses}, now ${j.status} at ${j.stage}: ${j.error}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

function setup(opts = {}) {
  const directory = opts.directory || tmp(),
    store = opts.store || openStore(directory),
    log = [],
    counter = {};
  const providers = {
    config: () => ({ key: "k", base: "" }),
    openAlexKey: () => "",
    generate: async (agent, messages, signal, onDelta, options = {}) => {
      const system = messages[0].content,
        user = messages[messages.length - 1].content;
      log.push({ agent, system: system.slice(0, 40), options });
      if (signal.aborted) throw signal.reason;
      if (opts.gate) await opts.gate(system, signal);
      const keys = [...user.matchAll(/^\[(P\d+|H\d+)\]/gm)].map((m) => m[1]);
      let text;
      if (system.startsWith("You help a researcher frame")) text = JSON.stringify({ question: "Can quantum algorithms speed up telescope data?", contribution: "A quantum pipeline", method: "Phase estimation", population: "Radio telescope visibilities" });
      else if (system.startsWith("Check this research frame")) text = opts.followup ? "Q1 - Scope: Which telescope?" : "NO MORE QUESTIONS";
      else if (system.startsWith("You write literature-search queries")) text = JSON.stringify({ queries: ["quantum telescope broad", "quantum telescope narrow", "quantum radio interferometry"] });
      else if (system.startsWith("Rate how relevant")) {
        const lines = user.split(/\n\n/).filter((b) => /^\[P\d+\]/m.test(b));
        text = JSON.stringify(lines.map((b) => ({ id: /^\[(P\d+)\]/m.exec(b)[1], score: /paper 7 /.test(b) ? 3 : 2, reason: "Relevant." })));
      } else if (system.startsWith("You map a body"))
        text = JSON.stringify({
          themes: [{ name: "Phase estimation", summary: `Shows "Quantum phase estimation speeds up telescope pipelines number 1." and also "This invented sentence is definitely not in any abstract."`, papers: ["P1", "P2", "P99"] }, { name: "Orphan", summary: "No support", papers: ["P99"] }],
          gaps: [{ text: "No real telescope tests", papers: [] }, { text: "Few noisy-data studies", papers: ["P1"] }],
        });
      else if (system.startsWith("Compare the researcher's frame"))
        text = JSON.stringify({
          rows: keys.map((k) => ({ id: k, question: 'He said "Invented quote that appears nowhere in the abstracts."', method: "Phase estimation", population: "Visibilities", data: "Simulated", evaluation: "Speed-up", limitations: "not stated" })),
          differences: [{ text: "We use quantum methods on raw visibilities", query: "narrow differ query" }],
        });
      else if (system.startsWith("The researcher claims")) text = JSON.stringify({ flags: keys.slice(0, 1).map((k) => ({ id: k, why: "Same method already published." })) });
      else if (system.startsWith("From a researcher's frame")) text = JSON.stringify({ kind: "extend", hypothesis: "If we extend, then faster", plan: "Run it", success: "2x speed-up", results: "we won" });
      else if (system.startsWith("A researcher states a claim"))
        text = JSON.stringify(keys.map((k, i) => ({ id: k, stance: i === 0 ? "supports" : i === 1 ? "challenges" : "unrelated", quote: i === 0 ? /Quantum phase estimation speeds up telescope pipelines number \d+\./.exec(user)[0] : "A sentence the abstract never contained at all." })));
      else throw Error("unexpected prompt: " + system.slice(0, 60));
      return { text, usage: { input: 10, output: 5 } };
    },
  };
  const assistant = createAssistant({ directory, store, providers });
  assistant.update({ planner: { provider: "local", model: "plan-m" }, writer: { provider: "local", model: "write-m" }, simulation: { provider: "local", model: "sim-m" } });
  const pipeline = createPipeline({ directory, store, providers, assistant, fetchImpl: stubFetch(counter) });
  const idea = store.put("records", validateRecord({ type: "idea", stage: "draft", title: opts.title || "Quantum algorithms for telescope data processing", body: "", fields: { solution: "Quantum filters", audience: "Astronomers" } }));
  return { directory, store, providers, assistant, pipeline, idea, log, counter };
}

const FRAME = { question: "Can quantum algorithms speed up telescope data?", contribution: "A quantum pipeline", method: "Phase estimation", population: "Radio telescope visibilities", known: "See https://doi.org/10.1/P1." };
async function toQueries(t, id, { followup = false } = {}) {
  let j = await wait(t.pipeline, id, ["waiting_user"]);
  assert.equal(j.waiting.kind, "frame");
  t.pipeline.answer(id, { frame: FRAME });
  j = await wait(t.pipeline, id, ["waiting_user"]);
  if (followup) {
    assert.equal(j.waiting.kind, "frame_followup");
    t.pipeline.answer(id, { text: "The VLA." });
    j = await wait(t.pipeline, id, ["waiting_user"]);
  }
  assert.equal(j.waiting.kind, "queries");
  return j;
}
const toScreening = async (t, id, queries, opts) => {
  const j = await toQueries(t, id, opts);
  t.pipeline.answer(id, queries ? { queries } : {});
  return wait(t.pipeline, id, ["waiting_user"]);
};

async function main() {
  {
    for (const bad of ["http://localhost/x", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://printer.local/", "file:///etc/passwd", "ftp://example.org/", "http://user:pw@example.org/"]) assert.equal(await publicUrl(bad, false), null, bad);
    assert.ok(await publicUrl("https://example.org/p.html", false));
    const abs = "<html><body><h1>Title</h1><h2>Abstract</h2><h3>Submission history</h3>" + "Navigation and listing text. ".repeat(120) + "</body></html>",
      body = "<html><body><h2>1 Introduction</h2>" + "Body text. ".repeat(200) + "<h2>2 Methods</h2><h2>References</h2></body></html>",
      txt = (h) => h.replace(/<[^>]+>/g, " ");
    assert.equal(isFullText(abs, txt(abs), "Short abstract."), false);
    assert.equal(isFullText(body, txt(body), "Short abstract."), true);
    assert.equal(isFullText(body, txt(body), "x".repeat(1000)), false);
  }
  {
    assert.equal(exactQuote("“Quantum phase estimation speeds up”", "Quantum phase estimation speeds up telescope pipelines."), "Quantum phase estimation speeds up");
    assert.equal(exactQuote("Quantum phase estimation slows down", "Quantum phase estimation speeds up telescope pipelines."), "");
    assert.equal(exactQuote("too short", "too short indeed"), "");
    const abs = ["Quantum phase estimation speeds up telescope pipelines. It works."];
    const text = 'Real: "Quantum phase estimation speeds up telescope pipelines." Fake: "Invented sentence that no abstract contains." end';
    const out = stripBadQuotes(text, abs);
    assert.match(out, /Quantum phase estimation speeds up telescope pipelines\./);
    assert.doesNotMatch(out, /Invented sentence/);
    assert.match(out, /quote removed/);
    assert.deepEqual(doiList("a https://doi.org/10.1/ABC. and doi:10.5555/x.y)"), ["10.1/abc", "10.5555/x.y"]);
  }

  {
    const bib = bibtex([
      { id: "10.1/a", title: "Cats & Dogs: 100% of _Pets_", authors: ["Ada Lovelace", "Alan Turing"], year: 2021, venue: "Journal X", doi: "10.1/a", url: "https://doi.org/10.1/a", verified: { by: "crossref", doi: "10.1/a" } },
      { id: "10.1/b", title: "Cats and dogs again", authors: ["Ada Lovelace"], year: 2021, doi: "10.1/b", verified: { by: "crossref", doi: "10.1/b" } },
      { id: "arxiv:2001.0001", title: "Cats preprint", authors: ["A One", "B Two", "C Three", "D Four", "E Five"], year: 2020, venue: "arXiv", url: "https://arxiv.org/abs/2001.0001", verified: { by: "arxiv", id: "2001.0001" } },
      { id: "x", title: "Unverified", authors: ["Z"], year: 2000, verified: null },
      { id: "10.1/c", title: "No metadata at all", authors: [], year: null, verified: { by: "crossref", doi: "10.1/c" }, doi: "10.1/c" },
    ]);
    const entries = bib.trim().split("\n\n");
    assert.equal(entries.length, 4);
    assert.match(entries[0], /^@article\{lovelace2021cats,/);
    assert.match(entries[0], /title = \{\{Cats \\& Dogs: 100\\% of \\_Pets\\_\}\}/);
    assert.match(entries[0], /author = \{Ada Lovelace and Alan Turing\}/);
    assert.match(entries[0], /journal = \{Journal X\}/);
    assert.match(entries[0], /doi = \{10\.1\/a\}/);
    assert.match(entries[1], /^@misc\{lovelace2021catsa,/);
    assert.doesNotMatch(entries[1], /journal|url|venue/);
    assert.match(entries[2], /^@misc\{one2020cats,/);
    assert.match(entries[2], /eprint = \{2001\.0001\}/);
    assert.match(entries[2], /author = \{A One and B Two and C Three and D Four and E Five and others\}/);
    assert.doesNotMatch(bib, /Unverified/);
    assert.doesNotMatch(entries[3], /author|year|journal/);
    assert.match(entries[3], /^@misc\{unknown/);
  }

  const t = setup({ followup: true });
  let jobId;
  {
    const job = t.pipeline.startResearch(t.idea.id);
    jobId = job.id;
    assert.equal(job.kind, "research_pipeline");
    assert.equal(job.caps.calls, 30);
    assert.throws(() => t.pipeline.startResearch(t.idea.id), /already being researched/);
    let j = await toQueries(t, job.id, { followup: true });
    assert.deepEqual(j.waiting.queries, ["quantum telescope broad", "quantum telescope narrow", "quantum radio interferometry"]);
    const frameNote = t.store.list("records").find((r) => r.title === "Research frame");
    assert.equal(frameNote.origin.by, "user");
    assert.match(frameNote.body, /The VLA\./);
    assert.throws(() => t.pipeline.answer(job.id, { queries: [] }), /between 1 and 5/);
    t.pipeline.answer(job.id, { queries: ["quantum telescope broad", "quantum telescope narrow"] });
    j = await wait(t.pipeline, job.id, ["waiting_user"]);
    assert.equal(j.waiting.kind, "screening");
    const search = j.stages[1].output;
    assert.deepEqual(search.queries, ["quantum telescope broad", "quantum telescope narrow"]);
    assert.equal(search.candidates, 14);
    assert.equal(search.perSource.OpenAlex, 17);
    assert.equal(search.verified, 15);
    assert.equal(search.unverifiedDropped, 2);
    assert.equal(search.snowball.seeds, 5);
    assert.equal(search.snowball.added, 2);
    assert.equal(search.snowball.references, 10);
    assert.equal(search.snowball.citedBy, 5);
    assert.equal(search.stop.reason, "exhausted");
    assert.match(search.summary, /does not\b|not that nothing else exists/);
    const papers = t.store.list("papers");
    assert.equal(papers.length, 14);
    assert.ok(papers.every((p) => p.verified && p.firstSeen && p.sources.includes("OpenAlex")));
    assert.ok(!papers.some((p) => /ghost/.test(p.id)), "unverifiable snowball and search results never enter the library");
    const snow = papers.filter((p) => /r201|c301/.test(p.id));
    assert.equal(snow.length, 2);
    assert.ok(snow.every((p) => p.verified.by === "crossref"));
    const decisions = t.store.list("paper_decisions").filter((d) => d.ideaId === t.idea.id);
    assert.equal(decisions.length, 14);
    assert.equal(decisions.find((d) => d.paperId === "10.1/p1").decision, "include");
    assert.equal(decisions.find((d) => d.paperId === "10.1/p1").by, "user");
    assert.equal(decisions.filter((d) => d.via === "snowball").length, 2);
    assert.ok(decisions.every((d) => d.suggestion && d.suggestion.by === "simulation" && d.suggestion.model === "sim-m"));
    assert.ok(decisions.filter((d) => d.paperId !== "10.1/p1").every((d) => d.decision === "maybe" && d.by === "system"));
    const logs = t.store.list("search_log").filter((s) => s.ideaId === t.idea.id);
    assert.deepEqual(logs.map((l) => l.kind).sort(), ["query", "query", "snowball"]);
    assert.ok(logs.filter((l) => l.kind === "query").every((l) => l.sourcesTried.length === 3 && l.fetched));
    const view = t.pipeline.research.view(t.idea.id);
    assert.equal(view.papers.length, 14);
    assert.equal(view.counts.include, 1);

    assert.throws(() => t.pipeline.answer(job.id, {}), /Done screening/);
    assert.throws(() => t.pipeline.research.decide(t.idea.id, { decisions: [{ paperId: "10.1/nope", decision: "include" }] }), /not a candidate/);
    assert.throws(() => t.pipeline.research.decide(t.idea.id, { paperIds: ["10.1/p3"], decision: "yes" }), /include, exclude or maybe/);
    t.pipeline.research.decide(t.idea.id, { paperIds: ["10.1/p3", "10.1/p4", "10.1/p5", "10.1/p6", "10.1/p7"], decision: "include" });
    t.pipeline.research.decide(t.idea.id, { decisions: [{ paperId: "10.1/p8", decision: "exclude", reason: "Off topic" }] });
    const p8 = t.store.get("paper_decisions", t.idea.id + "|10.1/p8");
    assert.equal(p8.by, "user");
    assert.equal(p8.reason, "Off topic");
    assert.equal(p8.suggestion.by, "simulation");
    assert.equal((await wait(t.pipeline, job.id, ["waiting_user"])).waiting.kind, "screening");
    t.pipeline.answer(job.id, { done: true });
    j = await wait(t.pipeline, job.id, ["done", "failed", "stopped", "waiting_user"]);
    assert.equal(j.status, "done", j.error);
    assert.deepEqual(j.stages.map((s) => s.status), Array(6).fill("done"));
    assert.equal(j.stages[2].output.include, 6);
    assert.equal(j.usage.calls, 2 + 1 + 2 + 1 + 2 + 1);
    assert.equal(j.usage.calls, j.stages.reduce((n, s) => n + s.usage.calls, 0));
    assert.ok(j.stages.every((s) => typeof s.usage.ms === "number"));

    const made = t.store.list("records").filter((r) => r.origin.runId === job.id);
    const map = made.find((r) => r.title === "Literature map (draft)");
    assert.equal(map.origin.by, "simulation");
    assert.equal(map.reviewed, null);
    assert.match(map.body, /Quantum phase estimation speeds up telescope pipelines number 1\./);
    assert.doesNotMatch(map.body, /invented sentence/i);
    assert.match(map.body, /quote removed/);
    assert.match(map.body, /Supported by: Lovelace et al\. \d+ \(https:\/\/doi\.org\/10\.1\/p7\)/);
    assert.doesNotMatch(map.body, /Orphan|No real telescope tests/);
    assert.deepEqual(j.stages[3].output.themes[0].paperIds.length, 2);
    const differ = made.find((r) => r.title === "Differ table (draft)");
    assert.equal(differ.origin.by, "simulation");
    assert.doesNotMatch(differ.body, /Invented quote/);
    const rows = j.stages[4].output.rows;
    assert.equal(rows.length, 5);
    assert.equal(rows[0].paperId, "10.1/p7");
    assert.equal(rows[0].level, "metadata");
    assert.match(rows[0].cells.method, /metadata only/);
    assert.equal(rows.find((r) => r.paperId === "10.1/p4").level, "full text");
    assert.ok(rows.filter((r) => !["10.1/p7", "10.1/p4"].includes(r.paperId)).every((r) => r.level === "abstract"));
    assert.ok(rows.every((r) => r.url));
    assert.equal(j.stages[4].output.differences[0].query, "narrow differ query");
    assert.ok(j.stages[4].output.differences[0].hits.some((h) => h.flagged));
    assert.ok(j.stages[4].output.differences[0].hits.every((h) => !rows.some((r) => r.paperId === h.paperId)));
    assert.match(differ.body, /MAY UNDERCUT/);
    assert.ok(t.store.list("search_log").some((l) => l.kind === "followup"));
    const exp = made.find((r) => r.type === "experiment");
    assert.equal(exp.origin.by, "assistant");
    assert.equal(exp.reviewed, null);
    assert.deepEqual(Object.keys(exp.fields).sort(), ["hypothesis", "plan", "success"]);
    for (const r of made) assert.deepEqual(r.links, [t.idea.id]);
    assert.equal(t.store.get("records", t.idea.id).stage, "draft");
    assert.ok(t.log.filter((c) => c.agent.name === "Screen").every((c) => c.agent.model === "sim-m"));
    assert.ok(t.log.filter((c) => c.agent.name === "Map").every((c) => c.agent.model === "write-m"));
  }

  {
    const bib = t.pipeline.research.bibtexFor(t.idea.id);
    assert.equal(bib.trim().split("\n\n").length, 6);
    assert.match(bib, /doi = \{10\.1\/p3\}/);
    assert.doesNotMatch(bib, /p8|paper 8/);
  }

  {
    const again = t.pipeline.startResearch(t.idea.id);
    const j = await wait(t.pipeline, again.id, ["done", "waiting_user", "failed"]);
    assert.equal(j.status, "done", j.error);
    assert.equal(j.usage.calls, 0);
    assert.ok(j.stages.every((s) => s.cached));
  }

  {
    const out = await t.pipeline.research.cite(t.idea.id, "Quantum phase estimation speeds up telescope pipelines");
    assert.equal(out.supporting.length, 1);
    assert.match(out.supporting[0].quote, /^Quantum phase estimation speeds up telescope pipelines number \d+$/);
    assert.equal(out.supporting[0].level, "abstract");
    assert.equal(out.challenging.length, 1);
    assert.equal(out.challenging[0].quote, "");
    assert.match(out.challenging[0].note, /No verifiable quote/);
    assert.equal(out.noAbstract, 1);
    assert.equal(out.calls, 1);
    await assert.rejects(t.pipeline.research.cite(t.idea.id, "  "), /Enter a claim/);
  }

  {
    const t2 = setup({ store: t.store, directory: t.directory, title: "Second idea about the sky" });
    const before = t.store.list("papers").length;
    const job = t2.pipeline.startResearch(t2.idea.id);
    await toScreening(t2, job.id, ["quantum telescope broad", "quantum telescope narrow"]);
    assert.equal(t.store.list("papers").length, before, "shared papers are stored once");
    const mine = (id) => t.store.list("paper_decisions").filter((d) => d.ideaId === id);
    assert.equal(mine(t2.idea.id).length, 14);
    assert.equal(mine(t.idea.id).length, 14);
    assert.equal(t2.pipeline.research.view(t2.idea.id).counts.include, 1);
    assert.equal(t.pipeline.research.view(t.idea.id).counts.include, 6);
    t2.pipeline.cancel(job.id);
    assert.equal(t2.pipeline.get(job.id).status, "cancelled");
  }

  {
    const t3 = setup({ followup: false });
    const job = t3.pipeline.startResearch(t3.idea.id, { calls: 4 });
    assert.equal(job.caps.calls, 4);
    await toScreening(t3, job.id, ["quantum telescope broad", "quantum telescope narrow"]).catch(() => {});
    const j = await wait(t3.pipeline, job.id, ["stopped"]);
    assert.equal(j.gate.kind, "cap");
    assert.equal(j.usage.calls, 4);
    assert.match(j.gate.reason, /Resume to allow 30 more calls/);
    t3.pipeline.resume(job.id);
    const k = await wait(t3.pipeline, job.id, ["waiting_user"]);
    assert.equal(k.caps.calls, 34);
    assert.equal(k.waiting.kind, "screening");
    assert.ok(t3.store.list("paper_decisions").filter((d) => d.ideaId === t3.idea.id).every((d) => d.suggestion));
    t3.pipeline.cancel(job.id);
  }

  {
    let release;
    const hold = new Promise((r) => (release = r));
    const t4 = setup({ gate: (system, signal) => (system.startsWith("You help a researcher frame") ? Promise.race([hold, new Promise((_, no) => signal.addEventListener("abort", () => no(signal.reason)))]) : undefined) });
    const job = t4.pipeline.startResearch(t4.idea.id);
    await new Promise((r) => setTimeout(r, 30));
    t4.pipeline.cancel(job.id);
    const j = await wait(t4.pipeline, job.id, ["cancelled"]);
    assert.equal(j.status, "cancelled");
    release();
    assert.throws(() => t4.pipeline.cancel(job.id), /already ended/);
    assert.throws(() => t4.pipeline.startResearch("missing"), /Idea not found/);
  }

  {
    const archive = JSON.parse(JSON.stringify(t.store.archive()));
    assert.equal(archive.papers.length, 14);
    assert.ok(archive.paperDecisions.length >= 28);
    assert.ok(archive.searchLog.length >= 6);
    assert.ok(archive.jobs.some((j) => j.kind === "research_pipeline"));
    const store = openStore(tmp());
    const res = store.importArchive(archive, "merge");
    assert.equal(res.papers, 14);
    assert.equal(store.list("papers").length, 14);
    assert.equal(store.list("paper_decisions").length, archive.paperDecisions.length);
    assert.equal(store.list("search_log").length, archive.searchLog.length);
    assert.equal(store.get("papers", "10.1/p3").abstract, abstractOf(3));
    store.importArchive(archive, "merge");
    assert.equal(store.list("papers").length, 14);
    assert.throws(() => store.importArchive({ ...archive, papers: [{ id: "x" }] }, "merge"), /Invalid paper/);
    assert.throws(() => store.importArchive({ ...archive, paperDecisions: [{ ideaId: "a", paperId: "b", decision: "yes" }] }, "merge"), /Invalid paper decision/);
    const legacy = { ...archive };
    delete legacy.papers;
    delete legacy.paperDecisions;
    delete legacy.searchLog;
    assert.equal(openStore(tmp()).importArchive(legacy, "merge").papers, 0);
  }

  {
    const directory = tmp(),
      server = createServer({ directory, papersFetch: stubFetch() });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const api = async (p, method = "GET", data) => {
      const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
      const type = r.headers.get("content-type") || "";
      return { status: r.status, type, disposition: r.headers.get("content-disposition"), body: type.includes("json") ? await r.json() : await r.text() };
    };
    const idea = (await api("/api/records", "POST", { type: "idea", stage: "draft", title: "Idea" })).body;
    assert.equal((await api(`/api/ideas/${idea.id}/research`, "POST", {})).status, 400);
    assert.equal((await api("/api/ideas/nope/research")).status, 404);
    const view = await api(`/api/ideas/${idea.id}/research`);
    assert.deepEqual(view.body.papers, []);
    assert.equal((await api(`/api/ideas/${idea.id}/research/cite`, "POST", { claim: "x" })).status, 409);
    assert.equal((await api(`/api/ideas/${idea.id}/research/decisions`, "POST", { paperIds: ["10.1/p1"], decision: "include" })).status, 404);
    const bib = await api(`/api/ideas/${idea.id}/research/bibtex`);
    assert.equal(bib.status, 200);
    assert.match(bib.type, /bibtex/);
    assert.match(bib.disposition, /references\.bib/);
    assert.equal(bib.body, "");
    await new Promise((r) => server.close(r));
  }
  console.log("research tests passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
