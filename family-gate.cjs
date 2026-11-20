"use strict";
const COOKIE = "__Host-spark";
const TEXT = {
  en: { title: "Pair with Spark", button: "Pair this device", code: "Code from the owner", bad: "Invalid or expired link. Ask for a new one.", slow: "Too many attempts. Try again later.", need: "Pair this device first." },
  pt: { title: "Conectar ao Spark", button: "Conectar este aparelho", code: "Código recebido", bad: "Link inválido ou expirado. Peça um novo.", slow: "Tentativas demais. Tente de novo mais tarde.", need: "Conecte este aparelho primeiro." },
};
const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function createLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  const recent = (key) => {
    const t = now(),
      list = (hits.get(key) || []).filter((x) => t - x < windowMs);
    list.length ? hits.set(key, list) : hits.delete(key);
    return list;
  };
  return {
    blocked: (key) => recent(key).length >= max,
    fail: (key) => hits.set(key, [...recent(key), now()]),
  };
}

function createPublicGate({ publicHost, registry, language = "pt-BR", clock = () => Date.now(), onUse }) {
  const text = TEXT[String(language).slice(0, 2).toLowerCase()] || TEXT.en,
    origin = "https://" + publicHost,
    perClient = createLimiter({ max: 5, windowMs: 10 * 60000, now: clock }),
    overall = createLimiter({ max: 20, windowMs: 3600000, now: clock });
  const page = (res, status, code = "", message = "") => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><html lang="${html(language)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text.title}</title><link rel="stylesheet" href="/assets/style.css"><main class="pair-page"><h1>${text.title}</h1>${message ? `<p>${html(message)}</p>` : ""}<form method="post" action="/pair"><label>${text.code} <input name="code" value="${html(code)}" required maxlength="64" autocomplete="off"></label> <button>${text.button}</button></form></main></html>`,
    );
  };
  const plain = (res, status, message, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
    res.end(JSON.stringify({ error: message }));
  };
  const client = (req) => String(req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "");

  // Returns true when the request may continue to the app; otherwise it has been answered.
  return async function gate(req, res, url) {
    if (url.pathname === "/pair" && req.method === "GET") return page(res, 200, /^[A-Za-z0-9_-]{1,64}$/.test(url.searchParams.get("code") || "") ? url.searchParams.get("code") : ""), false;
    if (url.pathname === "/pair" && req.method === "POST") {
      if (req.headers.origin !== origin) return plain(res, 403, "Same-origin requests required."), false;
      const who = client(req);
      if (perClient.blocked(who) || overall.blocked("all")) return plain(res, 429, text.slow, { "Retry-After": "600" }), false;
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 512) return plain(res, 413, "Code too long."), false;
      }
      const secret = registry.redeem(new URLSearchParams(raw).get("code") || "");
      if (!secret) {
        perClient.fail(who);
        overall.fail("all");
        return page(res, 403, "", text.bad), false;
      }
      res.writeHead(303, { "Set-Cookie": `${COOKIE}=${secret}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`, Location: "/" });
      res.end();
      return false;
    }
    const match = (req.headers.cookie || "").match(/(?:^|;\s*)__Host-spark=([A-Za-z0-9_-]{32})(?:;|$)/);
    if (match && registry.valid(match[1])) {
      onUse?.();
      return true;
    }
    if (req.method === "GET" && url.pathname === "/assets/style.css") return true;
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(303, { Location: "/pair" });
      res.end();
      return false;
    }
    return plain(res, 401, text.need), false;
  };
}
module.exports = { createPublicGate, createLimiter, COOKIE };
