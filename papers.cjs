"use strict";
const { fail } = require("./store.cjs");

const USER_AGENT = "Spark/2.0 (local research notebook)";
const REQUEST_TIMEOUT_MS = 12000;
const VERIFY_CONCURRENCY = 4;
const RETRY_DELAY_MS = 1000;
const VERIFY_DEADLINE_MS = 20000;
const CACHE_LIMIT = 2000;
const crossrefTitles = new Map();

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const collapse = (text) => text.replace(/\s+/g, " ").trim();
const normalizeDoi = (value) => String(value || "").trim().toLowerCase().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/, "");
const doiUrl = (doi) => (doi ? "https://doi.org/" + doi : null);
const normalizeTitle = (value) =>
  String(value || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function titlesMatch(a, b) {
  const x = normalizeTitle(a),
    y = normalizeTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const setA = new Set(x.split(" ")),
    setB = new Set(y.split(" "));
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  return shared / Math.max(setA.size, setB.size) >= 0.8;
}

function rebuildAbstract(index) {
  if (!index || typeof index !== "object") return null;
  const words = [];
  for (const [word, positions] of Object.entries(index))
    if (Array.isArray(positions)) for (const p of positions) words[p] = word;
  const text = words.filter((w) => w !== undefined).join(" ").trim();
  return text || null;
}

function httpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function normalize(work) {
  const doi = normalizeDoi(work.doi);
  const primary = work.primary_location || {};
  return {
    id: String(work.id || ""),
    title: String(work.title || work.display_name || "Untitled"),
    authors: (work.authorships || []).map((a) => a?.author?.display_name).filter(Boolean).slice(0, 5),
    year: Number.isInteger(work.publication_year) ? work.publication_year : null,
    venue: primary.source?.display_name || null,
    doi: doiUrl(doi),
    url: httpUrl(doiUrl(doi)) || httpUrl(primary.landing_page_url) || httpUrl(work.id),
    abstract: rebuildAbstract(work.abstract_inverted_index),
    openAccessUrl: httpUrl(work.open_access?.oa_url),
  };
}

async function request(fetchImpl, url, accept, parse) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT, Accept: accept }, ...(/[?&]api_key=/.test(url) ? { redirect: "error" } : {}) });
    if (!res.ok) throw Object.assign(new Error(res.status === 429 ? "rate-limited" : `HTTP ${res.status}`), { status: res.status });
    return await parse(res);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
const getJson = (fetchImpl, url) => request(fetchImpl, url, "application/json", (res) => res.json());
const getText = (fetchImpl, url) => request(fetchImpl, url, "application/atom+xml", (res) => res.text());

async function fromOpenAlex(query, page, count, { fetchImpl, apiKey }) {
  const key = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
  const data = await getJson(fetchImpl, `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${count}&page=${page}${key}`);
  return { total: Number(data.meta?.count) || 0, items: (data.results || []).map(normalize) };
}

function normalizeCrossref(item) {
  const doi = normalizeDoi(item.DOI);
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  const abstract = collapse(unescapeEntities(String(item.abstract || "").replace(/<[^>]*>/g, " "))).replace(/^abstract\s+/i, "");
  return {
    id: doiUrl(doi),
    title: collapse(String(item.title?.[0] || "Untitled")),
    authors: (item.author || []).map((a) => collapse(`${a.given || ""} ${a.family || a.name || ""}`)).filter(Boolean).slice(0, 5),
    year: Number.isInteger(year) ? year : null,
    venue: item["container-title"]?.[0] || null,
    doi: doiUrl(doi),
    url: doiUrl(doi),
    abstract: abstract || null,
    openAccessUrl: null,
  };
}

async function fromCrossref(query, page, count, { fetchImpl }) {
  const select = "DOI,title,author,issued,container-title,abstract";
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${count}&offset=${(page - 1) * count}&select=${select}`;
  const data = (await getJson(fetchImpl, url)).message || {};
  return { total: Number(data["total-results"]) || 0, items: (data.items || []).filter((i) => i?.DOI).map(normalizeCrossref) };
}

function tag(xml, name) {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? collapse(unescapeEntities(match[1])) : "";
}

function parseArxiv(xml) {
  const items = [];
  for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
    const arxivId = /arxiv\.org\/abs\/(.+?)(?:v\d+)?$/.exec(tag(entry, "id"))?.[1];
    if (!arxivId) continue;
    const year = parseInt(tag(entry, "published").slice(0, 4), 10);
    items.push({
      id: "arxiv:" + arxivId,
      arxivId,
      title: tag(entry, "title") || "Untitled",
      authors: (entry.match(/<author>[\s\S]*?<\/author>/g) || []).map((a) => tag(a, "name")).filter(Boolean).slice(0, 5),
      year: Number.isInteger(year) ? year : null,
      venue: tag(entry, "arxiv:journal_ref") || "arXiv",
      doi: doiUrl(normalizeDoi(tag(entry, "arxiv:doi"))),
      url: "https://arxiv.org/abs/" + arxivId,
      abstract: tag(entry, "summary") || null,
      openAccessUrl: "https://arxiv.org/pdf/" + arxivId,
    });
  }
  return { total: Number(tag(xml, "opensearch:totalResults")) || items.length, items };
}

async function fromArxiv(query, page, count, { fetchImpl }) {
  const terms = query.split(/\s+/).filter(Boolean).map(encodeURIComponent).join("+");
  return parseArxiv(await getText(fetchImpl, `https://export.arxiv.org/api/query?search_query=all:${terms}&start=${(page - 1) * count}&max_results=${count}`));
}

function merge(batches) {
  const merged = [],
    byKey = new Map();
  for (const { name, items } of batches)
    for (const item of items) {
      const idKeys = [item.doi && "doi:" + normalizeDoi(item.doi), item.arxivId && "arxiv:" + item.arxivId].filter(Boolean);
      const titleKey = "title:" + normalizeTitle(item.title);
      const byId = idKeys.map((k) => byKey.get(k)).find(Boolean);
      const byTitle = byKey.get(titleKey);
      const found = byId || (byTitle && !item.doi && !byTitle.doi ? byTitle : null);
      const target = found || { ...item, sources: [] };
      if (found) for (const field of ["doi", "abstract", "openAccessUrl", "venue", "year", "arxivId"]) target[field] ??= item[field];
      if (!target.sources.includes(name)) target.sources.push(name);
      if (!found) merged.push(target);
      for (const k of [...idKeys, titleKey]) if (k !== titleKey || !byKey.has(k)) byKey.set(k, target);
    }
  return merged;
}

function crossrefTitle(doi, fetchImpl) {
  if (!crossrefTitles.has(doi)) {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi).replace(/%2F/gi, "/")}`;
    const retryable = (error) => error.status === 429 || error.status >= 500;
    const attempt = () => getJson(fetchImpl, url).catch((error) => (retryable(error) ? new Promise((r) => setTimeout(r, RETRY_DELAY_MS)).then(() => getJson(fetchImpl, url)) : Promise.reject(error)));
    const lookup = attempt().then(
      (data) => collapse(String(data.message?.title?.[0] || "")),
      (error) => {
        if (error.status === 404) return "";
        crossrefTitles.delete(doi);
        throw error;
      },
    );
    if (crossrefTitles.size >= CACHE_LIMIT) crossrefTitles.delete(crossrefTitles.keys().next().value);
    crossrefTitles.set(doi, lookup);
  }
  return crossrefTitles.get(doi);
}

async function verify(item, fetchImpl) {
  const doi = normalizeDoi(item.doi);
  if (doi && item.sources.includes("Crossref")) return { by: "crossref", doi };
  if (doi) {
    try {
      if (titlesMatch(await crossrefTitle(doi, fetchImpl), item.title)) return { by: "crossref", doi };
    } catch {}
  }
  if (item.sources.includes("arXiv") && item.arxivId) return { by: "arxiv", id: item.arxivId };
  return null;
}

async function verifyAll(items, fetchImpl, deadlineMs) {
  const verified = new Array(items.length);
  let next = 0,
    checked = 0,
    timedOut = false,
    timer;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve("expired"), deadlineMs);
  });
  const worker = async () => {
    while (next < items.length && !timedOut) {
      const i = next++;
      const outcome = await Promise.race([verify(items[i], fetchImpl), expired]);
      if (outcome === "expired") timedOut = true;
      else {
        verified[i] = outcome;
        checked++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(VERIFY_CONCURRENCY, items.length) }, worker));
  clearTimeout(timer);
  const results = items.flatMap(({ arxivId, ...item }, i) => (verified[i] ? [{ ...item, doi: verified[i].by === "arxiv" ? null : item.doi, verified: verified[i] }] : []));
  return { results, verification: { checked, verified: results.length, dropped: items.length - results.length, timedOut } };
}

async function runSource(name, fn) {
  try {
    const { items, total } = await fn();
    return { name, items, total, entry: { name, ok: true, count: items.length } };
  } catch (error) {
    return { name, items: [], total: 0, entry: { name, ok: false, count: 0, error: String(error.message || "network error") } };
  }
}

async function searchPapers(query, { page = 1, fetchImpl = fetch, apiKey = "", count = 10, verifyDeadlineMs = VERIFY_DEADLINE_MS } = {}) {
  const ctx = { fetchImpl, apiKey };
  const attempts = [await runSource("OpenAlex", () => fromOpenAlex(query, page, count, ctx))];
  if (!attempts[0].entry.ok || attempts[0].items.length < count)
    attempts.push(...(await Promise.all([runSource("Crossref", () => fromCrossref(query, page, count, ctx)), runSource("arXiv", () => fromArxiv(query, page, count, ctx))])));
  const sourcesTried = attempts.map((a) => a.entry);
  if (!sourcesTried.some((s) => s.ok)) fail(`Paper search unavailable: ${sourcesTried.map((s) => `${s.name}: ${s.error}`).join("; ")}.`, 502);
  const { results, verification } = await verifyAll(merge(attempts), fetchImpl, verifyDeadlineMs);
  return {
    query,
    page,
    total: Math.max(results.length, ...attempts.map((a) => a.total)),
    results,
    source: attempts.filter((a) => a.entry.ok).map((a) => a.name).join(", "),
    sourcesTried,
    verification,
    fetched: new Date().toISOString(),
  };
}

const OA_SELECT = "id,doi,title,display_name,authorships,publication_year,primary_location,abstract_inverted_index,open_access,referenced_works";
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/;
const oaPath = (query, apiKey) => `https://api.openalex.org/works?${query}&select=${OA_SELECT}${apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : ""}`;
const shortId = (value) => /W\d+$/.exec(String(value || ""))?.[0] || "";

function withArxiv(work) {
  const item = normalize(work);
  const m = ARXIV_DOI.exec(normalizeDoi(item.doi));
  if (m) item.arxivId = m[1];
  return item;
}

async function confirmArxiv(items, fetchImpl) {
  const wanted = items.filter((i) => i.arxivId);
  if (!wanted.length) return;
  try {
    const xml = await getText(fetchImpl, `https://export.arxiv.org/api/query?id_list=${wanted.map((i) => encodeURIComponent(i.arxivId)).join(",")}&max_results=${wanted.length}`);
    const found = parseArxiv(xml).items;
    for (const item of wanted) {
      const hit = found.find((f) => f.arxivId.toLowerCase() === item.arxivId.toLowerCase());
      if (hit && titlesMatch(hit.title, item.title)) {
        item.abstract ??= hit.abstract;
        item.arxivId = hit.arxivId;
        item.sources = [...(item.sources || []), "arXiv"];
      }
    }
  } catch {}
}

async function finish(items, fetchImpl, verifyDeadlineMs) {
  const merged = merge([{ name: "OpenAlex", items }]);
  await confirmArxiv(merged, fetchImpl);
  return verifyAll(merged, fetchImpl, verifyDeadlineMs);
}

async function findWork(seed, ctx) {
  const doi = normalizeDoi(seed.doi) || (seed.arxivId ? "10.48550/arxiv." + String(seed.arxivId).toLowerCase() : "");
  if (!doi) return null;
  const data = await getJson(ctx.fetchImpl, oaPath(`filter=doi:${encodeURIComponent(doi)}&per-page=1`, ctx.apiKey));
  return data.results?.[0] || null;
}

async function lookupDoi(doi, { fetchImpl = fetch, apiKey = "", verifyDeadlineMs = VERIFY_DEADLINE_MS } = {}) {
  const work = await findWork({ doi }, { fetchImpl, apiKey });
  if (!work) return null;
  return (await finish([withArxiv(work)], fetchImpl, verifyDeadlineMs)).results[0] || null;
}

async function snowball(seeds, { fetchImpl = fetch, apiKey = "", perSide = 15, verifyDeadlineMs = VERIFY_DEADLINE_MS } = {}) {
  const ctx = { fetchImpl, apiKey },
    log = [],
    items = [];
  for (const seed of seeds) {
    const entry = { seed: seed.id || seed.doi || seed.arxivId, found: false, references: 0, citedBy: 0, error: "" };
    log.push(entry);
    try {
      const work = await findWork(seed, ctx);
      if (!work) continue;
      entry.found = true;
      const refIds = (work.referenced_works || []).map(shortId).filter(Boolean).slice(0, perSide);
      if (refIds.length) {
        const refs = await getJson(fetchImpl, oaPath(`filter=openalex:${refIds.join("|")}&per-page=${refIds.length}`, apiKey));
        for (const w of refs.results || []) items.push({ ...withArxiv(w), via: "references", seedId: entry.seed });
        entry.references = (refs.results || []).length;
      }
      const wid = shortId(work.id);
      if (wid) {
        const cited = await getJson(fetchImpl, oaPath(`filter=cites:${wid}&sort=cited_by_count:desc&per-page=${perSide}`, apiKey));
        for (const w of cited.results || []) items.push({ ...withArxiv(w), via: "cited_by", seedId: entry.seed });
        entry.citedBy = (cited.results || []).length;
      }
    } catch (error) {
      entry.error = String(error.message || "network error");
    }
  }
  const { results, verification } = await finish(items, fetchImpl, verifyDeadlineMs);
  return { results, verification, log, fetched: new Date().toISOString() };
}

module.exports = { searchPapers, snowball, lookupDoi, normalizeDoi };
