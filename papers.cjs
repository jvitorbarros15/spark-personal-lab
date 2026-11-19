"use strict";
const { fail } = require("./store.cjs");

const USER_AGENT = "Spark/2.0 (local research notebook)";
const REQUEST_TIMEOUT_MS = 12000;
const VERIFY_CONCURRENCY = 4;
const RETRY_DELAY_MS = 1000;
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
    const res = await fetchImpl(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT, Accept: accept } });
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
      const keys = [item.doi && "doi:" + normalizeDoi(item.doi), item.arxivId && "arxiv:" + item.arxivId, "title:" + normalizeTitle(item.title)].filter(Boolean);
      const found = keys.map((k) => byKey.get(k)).find(Boolean);
      const target = found || { ...item, sources: [] };
      if (found) for (const field of ["doi", "abstract", "openAccessUrl", "venue", "year", "arxivId"]) target[field] ??= item[field];
      if (!target.sources.includes(name)) target.sources.push(name);
      if (!found) merged.push(target);
      for (const k of keys) byKey.set(k, target);
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

async function verifyAll(items, fetchImpl) {
  const verified = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      verified[i] = await verify(items[i], fetchImpl);
    }
  };
  await Promise.all(Array.from({ length: Math.min(VERIFY_CONCURRENCY, items.length) }, worker));
  return items.flatMap(({ arxivId, ...item }, i) => (verified[i] ? [{ ...item, verified: verified[i] }] : []));
}

async function runSource(name, fn) {
  try {
    const { items, total } = await fn();
    return { name, items, total, entry: { name, ok: true, count: items.length } };
  } catch (error) {
    return { name, items: [], total: 0, entry: { name, ok: false, count: 0, error: String(error.message || "network error") } };
  }
}

async function searchPapers(query, { page = 1, fetchImpl = fetch, apiKey = "", count = 10 } = {}) {
  const ctx = { fetchImpl, apiKey };
  const attempts = [await runSource("OpenAlex", () => fromOpenAlex(query, page, count, ctx))];
  if (!attempts[0].entry.ok || attempts[0].items.length < count)
    attempts.push(...(await Promise.all([runSource("Crossref", () => fromCrossref(query, page, count, ctx)), runSource("arXiv", () => fromArxiv(query, page, count, ctx))])));
  const sourcesTried = attempts.map((a) => a.entry);
  if (!sourcesTried.some((s) => s.ok)) fail(`Paper search unavailable: ${sourcesTried.map((s) => `${s.name}: ${s.error}`).join("; ")}.`, 502);
  const results = await verifyAll(merge(attempts), fetchImpl);
  return {
    query,
    page,
    total: Math.max(results.length, ...attempts.map((a) => a.total)),
    results,
    source: attempts.filter((a) => a.entry.ok).map((a) => a.name).join(", "),
    sourcesTried,
    fetched: new Date().toISOString(),
  };
}

module.exports = { searchPapers };
