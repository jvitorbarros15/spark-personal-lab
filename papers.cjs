"use strict";
const { fail } = require("./store.cjs");

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
  const doi = typeof work.doi === "string" && work.doi ? work.doi : null;
  const primary = work.primary_location || {};
  return {
    id: String(work.id || ""),
    title: String(work.title || work.display_name || "Untitled"),
    authors: (work.authorships || []).map((a) => a?.author?.display_name).filter(Boolean).slice(0, 5),
    year: Number.isInteger(work.publication_year) ? work.publication_year : null,
    venue: primary.source?.display_name || null,
    doi,
    url: httpUrl(doi) || httpUrl(primary.landing_page_url) || httpUrl(work.id),
    abstract: rebuildAbstract(work.abstract_inverted_index),
    openAccessUrl: httpUrl(work.open_access?.oa_url),
  };
}

async function searchPapers(query, { page = 1, fetchImpl = fetch, apiKey = "" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const key = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=10&page=${page}${key}`;
    const res = await fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) fail(`OpenAlex unavailable: HTTP ${res.status}.`, 502);
    const data = await res.json();
    return {
      query,
      page,
      total: Number(data.meta?.count) || 0,
      results: (data.results || []).map(normalize),
      source: "OpenAlex",
      fetched: new Date().toISOString(),
    };
  } catch (error) {
    if (error.status) throw error;
    const reason = error.name === "AbortError" ? "request timed out." : String(error.message || "network error.");
    fail(`OpenAlex unavailable: ${reason}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { searchPapers };
