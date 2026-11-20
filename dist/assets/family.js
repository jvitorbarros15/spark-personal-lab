"use strict";
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  async function call(url, method = "GET", data) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(tx(body.error || "Request failed."));
    return body;
  }
  let me = { family: false },
    people = null,
    editing = null,
    note = "";

  function familyInstance() {
    const owner = me.ownerName;
    const pt = /^pt/i.test(I18N.lang);
    const saved = tx("Saved in SQLite on this computer"),
      stored = tx("Stored on {owner}'s computer", { owner });
    const phrases = pt
      ? [
          [/\bneste computador\b/gi, "no computador de " + owner],
          [/\bdeste computador\b/gi, "do computador de " + owner],
          [/\beste computador\b/gi, "o computador de " + owner],
        ]
      : [[/\bthis computer\b/g, owner + "'s computer"]];
    const probe = pt ? /\b(neste|deste|este) computador\b/i : /this computer/;
    const swap = (text) => {
      let out = text.split(saved).join(stored);
      for (const [re, to] of phrases) out = out.replace(re, (m) => (m[0] !== m[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to));
      return out;
    };
    const walk = (root) => {
      const nodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = nodes.nextNode(); n; n = nodes.nextNode()) if (probe.test(n.nodeValue) || n.nodeValue.includes(saved)) n.nodeValue = swap(n.nodeValue);
      for (const el of root.querySelectorAll?.("[title]") || []) if (probe.test(el.title)) el.title = swap(el.title);
    };
    let busy = false;
    new MutationObserver(() => {
      if (busy) return;
      busy = true;
      walk(document.body);
      busy = false;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    walk(document.body);
    const banner = document.createElement("p");
    banner.id = "family-banner";
    banner.className = "hint";
    banner.hidden = true;
    banner.setAttribute("role", "status");
    banner.textContent = tx("Busy, your request is queued");
    document.body.prepend(banner);
    setInterval(async () => {
      try {
        banner.hidden = !(await call("/api/family/self")).queued;
      } catch {}
    }, 2000);
  }

  const ago = (iso) => (iso ? fmt.dateTime(iso) : tx("never"));
  function row(p) {
    const over = p.spentUsd !== null && p.spentUsd >= p.budgetUsd;
    return `<li class="family-person" data-slug="${esc(p.slug)}"><h3>${esc(p.name)} <small>${p.running ? tx("running") : tx("stopped")}</small></h3><p class="hint">${p.url ? `<code>${esc(p.url)}</code>` : tx("No tunnel address (local only or not started)")} · ${tx("last used {when}", { when: esc(ago(p.lastUsed)) })} · ${esc(p.language)}${p.localOnly ? " · " + tx("local models only") : ""} · ${tp("{n} paired device|{n} paired devices", p.devices)}</p><p class="hint">${tx("This month: {spent} of {budget}", { spent: esc(fmt.money(p.spentUsd ?? 0, "USD")), budget: esc(fmt.money(Number(p.budgetUsd), "USD")) })}${over ? " " + tx("(cap reached, using local models)") : ""} · ${tx("port {port}", { port: esc(p.port) })}</p><div class="config-actions"><button type="button" class="button secondary" data-family="copy" ${p.url ? "" : "disabled"}>${tx("Copy link")}</button><button type="button" class="button secondary" data-family="pair" ${p.url ? "" : "disabled"}>${tx("New pairing link")}</button><button type="button" class="text-button" data-family="revoke">${tx("Revoke devices")}</button><button type="button" class="text-button" data-family="edit">${tx("Edit")}</button></div></li>`;
  }
  function form(p) {
    const v = p || { name: "", port: nextPort(), language: "pt-BR", budgetUsd: 1, localOnly: false };
    return `<form id="family-form" class="provider-form" data-slug="${esc(p?.slug || "")}"><h3>${p ? tx("Edit {name}", { name: esc(p.name) }) : tx("Add a person")}</h3><label>${tx("Name")}<input name="name" value="${esc(v.name)}" required maxlength="60"></label><div class="form-row"><label>${tx("Port")}<input name="port" type="number" min="1024" max="65535" value="${esc(v.port)}" required></label><label>${tx("Language")}<input name="language" value="${esc(v.language)}" maxlength="12"></label><label>${tx("Monthly budget (USD)")}<input name="budgetUsd" type="number" min="0" max="1000" step="0.5" value="${esc(v.budgetUsd)}" required></label></div><label class="checkbox"><input name="localOnly" type="checkbox"${v.localOnly ? " checked" : ""}> ${tx("Local models only (no cloud models for this person)")}</label><p class="hint">${tx("Changes apply the next time you run Start Family.")}</p><div class="config-actions"><button class="button secondary">${tx("Save")}</button><button type="button" class="text-button" data-family="cancel">${tx("Cancel")}</button>${p ? `<button type="button" class="text-button" data-family="remove">${tx("Remove from list")}</button>` : ""}</div></form>`;
  }
  const nextPort = () => Math.max(4200, ...(people?.people || []).map((p) => p.port)) + 1;
  function html() {
    const list = people?.people || [];
    const launcher = people ? (people.launcherRunning ? (people.cloudflared ? tx("Start Family is running.") : tx("Start Family is running without cloudflared (local only).")) : tx("Start Family is not running.")) : tx("Loading…");
    return `<h2>${tx("Family")}</h2><p class="muted">${tx("Each person gets their own private Spark on this computer, reachable through a free Cloudflare quick tunnel. Their notebooks stay separate from yours.")} ${esc(launcher)}</p><p class="hint" id="family-note" role="status">${esc(note)}</p>${list.length ? `<ul class="family-list">${list.map(row).join("")}</ul>` : people ? `<p class="hint">${tx("Nobody added yet.")}</p>` : ""}${editing === null ? `<div class="config-actions"><button type="button" class="button secondary" data-family="add">${tx("Add a person")}</button></div>` : form(editing === "new" ? null : list.find((p) => p.slug === editing))}`;
  }
  const section = () => $("#family-section");
  const paint = () => {
    if (section()) section().innerHTML = html();
  };
  let loadedAt = 0;
  async function load() {
    loadedAt = Date.now();
    try {
      people = await call("/api/family");
    } catch (e) {
      note = e.message;
    }
    paint();
  }
  function mount() {
    if (location.hash !== "#settings" || !$("#content") || section() || me.family) return;
    const el = document.createElement("section");
    el.className = "settings-section";
    el.id = "family-section";
    $("#content").append(el);
    paint();
    if (Date.now() - loadedAt > 5000) load();
  }
  async function act(button) {
    const slug = button.closest("[data-slug]")?.dataset.slug,
      kind = button.dataset.family;
    try {
      if (kind === "add") editing = "new";
      else if (kind === "edit") editing = slug;
      else if (kind === "cancel") editing = null;
      else if (kind === "pair" || kind === "copy") {
        const { link } = await call(`/api/family/people/${slug}/pair`, "POST", {});
        try {
          await navigator.clipboard.writeText(link);
          note = tx("Pairing link copied. It works once and expires in 24 hours.");
        } catch {
          note = tx("Pairing link (one use, 24 hours): {link}", { link });
        }
      } else if (kind === "revoke") {
        if (!confirm(tx("Sign this person out on every device? They will need a new pairing link."))) return;
        note = tx("Revoked {n} device(s).", { n: (await call(`/api/family/people/${slug}/revoke`, "POST", {})).revoked });
      } else if (kind === "remove") {
        if (!confirm(tx("Remove this person from the list? Their devices are signed out and their notebook folder is kept. If Start Family is running, it stops their Spark within about 15 seconds; otherwise it stays stopped."))) return;
        await call(`/api/family/people/${slug}`, "DELETE");
        editing = null;
      }
    } catch (e) {
      note = e.message;
    }
    await load();
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("#family-section [data-family]");
    if (button) act(button);
  });
  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "family-form") return;
    event.preventDefault();
    const f = new FormData(event.target),
      slug = event.target.dataset.slug,
      data = { name: f.get("name"), port: Number(f.get("port")), language: f.get("language") || "pt-BR", budgetUsd: Number(f.get("budgetUsd")), localOnly: f.get("localOnly") === "on" };
    try {
      await call(slug ? `/api/family/people/${slug}` : "/api/family/people", "POST", data);
      editing = null;
      note = tx("Saved. Run Start Family to apply it.");
    } catch (e) {
      note = e.message;
    }
    await load();
  });

  (async () => {
    try {
      me = await call("/api/family/self");
    } catch {}
    if (me.family) return familyInstance();
    new MutationObserver(mount).observe($("#content"), { childList: true });
    window.addEventListener("hashchange", () => setTimeout(mount, 0));
    mount();
  })();
})();
