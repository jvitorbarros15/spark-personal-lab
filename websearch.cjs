"use strict";
const { publicUrl } = require("./research.cjs");

const OLLAMA = "https://ollama.com/api";
const MAX_CONTENT = 6000;
const MAX_RESPONSE = 1500000;
const TIMEOUT = 30000;

const clean = (s, n) => String(s ?? "").replace(/<<<|>>>/g, "").replace(/\s+/g, " ").trim().slice(0, n);

// Backends are pluggable: each maps (kind, input) to a request. A SearXNG backend can be added here later.
const BACKENDS = {
  ollama: {
    request: (kind, input, key) => ({
      url: `${OLLAMA}/${kind === "search" ? "web_search" : "web_fetch"}`,
      body: kind === "search" ? { query: input.query, max_results: input.max } : { url: input.url },
      headers: { Authorization: `Bearer ${key}` },
    }),
    results: (json) => (Array.isArray(json?.results) ? json.results : []).map((r) => ({ title: clean(r?.title, 200), url: String(r?.url ?? ""), content: clean(r?.content, 1200) })).filter((r) => r.url),
    page: (json) => ({ title: clean(json?.title, 200), content: clean(json?.content, MAX_CONTENT) }),
  },
};

function createWebSearch({ key = () => "", fetchImpl, backend = "ollama" }) {
  const be = BACKENDS[backend];
  const redact = (text) => {
    const k = key();
    return String(text ?? "").split(k || "\u0000").join("[redacted]");
  };

  async function call(kind, input, signal) {
    const k = key();
    const req = be.request(kind, input, k);
    let res;
    try {
      res = await (fetchImpl || fetch)(req.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(TIMEOUT)]),
        headers: { "Content-Type": "application/json", ...req.headers },
        body: JSON.stringify(req.body),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw Error("Web search request failed: " + redact(e.message));
    }
    if (res.status >= 300 && res.status < 400) throw Error("Web search refused a redirect.");
    if (res.status === 401 || res.status === 403) throw Error("Web search key was rejected (check the key in Settings).");
    if (res.status === 429) throw Error("Web search rate limit reached.");
    if (!res.ok) throw Error(`Web search failed with status ${res.status}.`);
    if (Number(res.headers?.get?.("content-length")) > MAX_RESPONSE) throw Error("Web search response too large.");
    const text = (await res.text()).slice(0, MAX_RESPONSE);
    try {
      return JSON.parse(text);
    } catch {
      throw Error("Web search returned something that is not JSON.");
    }
  }

  // forJob binds one job's privacy and call cap. A private job never reaches the network.
  function forJob({ private: isPrivate = false, cap = 30, used = 0, onCall = () => {} } = {}) {
    let n = used;
    const available = () => !isPrivate && !!key();
    const gate = () => {
      if (isPrivate) throw Object.assign(Error("Private entries never use web search."), { offline: true });
      if (!key()) throw Object.assign(Error("No web search key."), { offline: true });
      if (n >= cap) throw Object.assign(Error("Web search call limit reached."), { webCap: true });
      n++;
    };
    return {
      available,
      used: () => n,
      cap,
      async search(query, { signal, max = 5 } = {}) {
        gate();
        const q = clean(query, 300);
        if (!q) throw Error("Empty search query.");
        const json = await call("search", { query: q, max: Math.max(1, Math.min(10, max)) }, signal);
        const results = [];
        for (const r of be.results(json)) if (await publicUrl(r.url, false)) results.push(r);
        onCall({ kind: "search", query: q, count: results.length });
        return results;
      },
      async fetchPage(url, { signal } = {}) {
        gate();
        const u = await publicUrl(url, !fetchImpl);
        if (!u) throw Error("That address is not a public web page.");
        const page = be.page(await call("fetch", { url: u.href }, signal));
        onCall({ kind: "fetch", url: u.href, count: page.content.length });
        return { url: u.href, ...page };
      },
    };
  }
  return { forJob, redact };
}

module.exports = { createWebSearch, MAX_CONTENT };
