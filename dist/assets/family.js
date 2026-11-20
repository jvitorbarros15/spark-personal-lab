"use strict";
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  async function call(url, method = "GET", data) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(body.error || "Request failed.");
    return body;
  }
  let me = { family: false },
    people = null,
    editing = null,
    note = "";

  function familyInstance() {
    const owner = me.ownerName;
    const swap = (text) => text.replace(/Saved in SQLite on this computer/g, `Stored on ${owner}'s computer`).replace(/\bthis computer\b/g, `${owner}'s computer`);
    const walk = (root) => {
      const nodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = nodes.nextNode(); n; n = nodes.nextNode()) if (/this computer/.test(n.nodeValue)) n.nodeValue = swap(n.nodeValue);
      for (const el of root.querySelectorAll?.("[title*='this computer']") || []) el.title = swap(el.title);
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
    banner.textContent = "Busy, your request is queued";
    document.body.prepend(banner);
    setInterval(async () => {
      try {
        banner.hidden = !(await call("/api/family/self")).queued;
      } catch {}
    }, 2000);
  }

  const ago = (iso) => (iso ? new Date(iso).toLocaleString() : "never");
  function row(p) {
    const over = p.spentUsd !== null && p.spentUsd >= p.budgetUsd;
    return `<li class="family-person" data-slug="${esc(p.slug)}"><h3>${esc(p.name)} <small>${p.running ? "running" : "stopped"}</small></h3><p class="hint">${p.url ? `<code>${esc(p.url)}</code>` : "No tunnel address (local only or not started)"} · last used ${esc(ago(p.lastUsed))} · ${esc(p.language)}${p.localOnly ? " · local models only" : ""} · ${p.devices} paired device${p.devices === 1 ? "" : "s"}</p><p class="hint">This month: $${(p.spentUsd ?? 0).toFixed(2)} of $${Number(p.budgetUsd).toFixed(2)}${over ? " (cap reached, using local models)" : ""} · port ${p.port}</p><div class="config-actions"><button type="button" class="button secondary" data-family="copy" ${p.url ? "" : "disabled"}>Copy link</button><button type="button" class="button secondary" data-family="pair" ${p.url ? "" : "disabled"}>New pairing link</button><button type="button" class="text-button" data-family="revoke">Revoke devices</button><button type="button" class="text-button" data-family="edit">Edit</button></div></li>`;
  }
  function form(p) {
    const v = p || { name: "", port: nextPort(), language: "pt-BR", budgetUsd: 1, localOnly: false };
    return `<form id="family-form" class="provider-form" data-slug="${esc(p?.slug || "")}"><h3>${p ? "Edit " + esc(p.name) : "Add a person"}</h3><label>Name<input name="name" value="${esc(v.name)}" required maxlength="60"></label><div class="form-row"><label>Port<input name="port" type="number" min="1024" max="65535" value="${esc(v.port)}" required></label><label>Language<input name="language" value="${esc(v.language)}" maxlength="12"></label><label>Monthly budget (USD)<input name="budgetUsd" type="number" min="0" max="1000" step="0.5" value="${esc(v.budgetUsd)}" required></label></div><label class="checkbox"><input name="localOnly" type="checkbox"${v.localOnly ? " checked" : ""}> Local models only (no cloud models for this person)</label><p class="hint">Changes apply the next time you run Start Family.</p><div class="config-actions"><button class="button secondary">Save</button><button type="button" class="text-button" data-family="cancel">Cancel</button>${p ? '<button type="button" class="text-button" data-family="remove">Remove from list</button>' : ""}</div></form>`;
  }
  const nextPort = () => Math.max(4200, ...(people?.people || []).map((p) => p.port)) + 1;
  function html() {
    const list = people?.people || [];
    const launcher = people ? (people.launcherRunning ? (people.cloudflared ? "Start Family is running." : "Start Family is running without cloudflared (local only).") : "Start Family is not running.") : "Loading…";
    return `<h2>Family</h2><p class="muted">Each person gets their own private Spark on this computer, reachable through a free Cloudflare quick tunnel. Their notebooks stay separate from yours. ${esc(launcher)}</p><p class="hint" id="family-note" role="status">${esc(note)}</p>${list.length ? `<ul class="family-list">${list.map(row).join("")}</ul>` : people ? '<p class="hint">Nobody added yet.</p>' : ""}${editing === null ? '<div class="config-actions"><button type="button" class="button secondary" data-family="add">Add a person</button></div>' : form(editing === "new" ? null : list.find((p) => p.slug === editing))}`;
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
          note = "Pairing link copied. It works once and expires in 24 hours.";
        } catch {
          note = "Pairing link (one use, 24 hours): " + link;
        }
      } else if (kind === "revoke") {
        if (!confirm("Sign this person out on every device? They will need a new pairing link.")) return;
        note = `Revoked ${(await call(`/api/family/people/${slug}/revoke`, "POST", {})).revoked} device(s).`;
      } else if (kind === "remove") {
        if (!confirm("Remove this person from the list? Their devices are signed out and their notebook folder is kept. If Start Family is running, it stops their Spark within about 15 seconds; otherwise it stays stopped.")) return;
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
      note = "Saved. Run Start Family to apply it.";
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
