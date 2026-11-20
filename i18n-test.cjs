"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const I18N = require("./dist/assets/i18n.js");
const { directive, withDirective } = require("./lang.cjs");
const { parseAmount } = require("./dist/assets/business-math.js");
const PT = require("./dist/assets/i18n-pt.js");
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

// 1. Completeness: every literal key passed to tx/tp (client) or T/TP (server) has a pt-BR entry with matching placeholders and plural forms.
const files = ["dist/assets/app.js", "dist/assets/idea-model.js", "dist/assets/voice.js", "dist/assets/business-math.js", "assistant.cjs", "canvas.cjs", "cost.cjs", "founder.cjs", "ideachat.cjs", "panel.cjs", "pipeline.cjs", "research.cjs", "classify.cjs"];
const used = new Map();
for (const f of files) {
  const src = read(f);
  for (const m of src.matchAll(/\b(tx|tp|T|TP|_bmT|_imTx)\(\s*("(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`)/g)) {
    let key;
    try {
      key = m[2][0] === "`" ? m[2].slice(1, -1) : JSON.parse(m[2]);
    } catch {
      continue;
    }
    used.set(key, { f, plural: m[1] === "tp" || m[1] === "TP" });
  }
}
const holes = [],
  badPlaceholders = [],
  badPlural = [];
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const [key, { f, plural }] of used) {
  if (!(key in PT)) {
    holes.push(f + ": " + key);
    continue;
  }
  if (ph(key.split("|").pop()) !== ph(String(PT[key]).split("|").pop())) badPlaceholders.push(key);
  if (plural && key.split("|").length !== String(PT[key]).split("|").length) badPlural.push(key);
}
assert.deepEqual(holes, [], "pt-BR keys missing:\n" + holes.join("\n"));
assert.deepEqual(badPlaceholders, [], "pt-BR placeholders differ from English:\n" + badPlaceholders.join("\n"));
assert.deepEqual(badPlural, [], "pt-BR plural forms differ:\n" + badPlural.join("\n"));
assert.ok(used.size > 1000, "scanner found the keys (" + used.size + ")");

// 2. Untranslated entries: a value identical to its key must be a name, number format or other language-neutral text.
const same = Object.keys(PT).filter((k) => PT[k] === k && /[a-z]{4,}\s+[a-z]{3,}/i.test(k));
assert.ok(same.length < 15, "pt-BR values left in English: " + same.slice(0, 10).join(" | "));

// 3. Formatter outputs.
const f = I18N.fmt;
I18N.setLang("en");
assert.equal(f.date("2026-11-19T12:00:00"), "Nov 19");
assert.equal(f.money(1299.5), "$1,299.50");
assert.equal(f.money(1299.5, "R$"), "R$1,299.50");
assert.equal(f.pct(0.256), "25.6%");
assert.equal(f.num(1234.567), "1,234.57");
assert.equal(tp("{n} draft|{n} drafts", 1), "1 draft");
assert.equal(tp("{n} draft|{n} drafts", 2), "2 drafts");
I18N.setLang("pt-BR");
assert.equal(f.date("2026-11-19T12:00:00"), "19 de nov.");
assert.equal(f.money(1299.5), "R$ 1.299,50");
assert.equal(f.money(10), "R$ 10");
assert.equal(f.pct(0.256), "25,6%");
assert.equal(f.num(1234.567), "1.234,57");
assert.match(f.ago(Date.now() - 3 * 86400000), /^há 3 dias$/);
assert.equal(tp("{n} draft|{n} drafts", 1), "1 rascunho");
assert.equal(tp("{n} draft|{n} drafts", 0), "0 rascunho");
assert.equal(tp("{n} draft|{n} drafts", 3), "3 rascunhos");
assert.match(tx("Couldn't reach Gemini. Check your connection, then retry."), /^Não .*Gemini/, "server messages translate by exact key or pattern");
assert.equal(I18N.normalize("pt-PT"), "pt-BR");
assert.equal(I18N.normalize("en-GB"), "en");
assert.equal(I18N.normalize("fr"), "en");
I18N.setLang("en");

// 4. Typed amounts follow the language.
assert.deepEqual(parseAmount("1.299,50", "pt-BR"), { n: 1299.5 });
assert.deepEqual(parseAmount("1,000", "en"), { n: 1000 });

// 5. Prompt language injection and capture-language detection.
assert.equal(I18N.detect("Quero vender bolo caseiro para os vizinhos"), "pt-BR");
assert.equal(I18N.detect("I want to sell homemade cake to neighbors"), "en");
assert.equal(I18N.detect("OK 123"), null);
const ptPrompt = withDirective([{ role: "system", content: "SYS" }, { role: "user", content: "x" }], "pt-BR");
assert.match(ptPrompt[0].content, /^SYS[\s\S]*Brazilian Portuguese/);
assert.match(ptPrompt[0].content, /Keep JSON keys, enum values/);
assert.match(withDirective([{ role: "user", content: "x" }], "en")[0].content, /in English/);
assert.match(directive("en", "Quero abrir uma loja de roupas para as clientes do bairro"), /in Brazilian Portuguese/, "a clearly Portuguese capture wins over an English setting");
assert.match(directive("pt-BR", "I want to open a clothing store for the neighborhood customers"), /in English/, "a clearly English capture wins over a Portuguese setting");
assert.match(directive("pt-BR", "ok"), /in Brazilian Portuguese/);
const providersSrc = read("providers.cjs");
assert.match(providersSrc, /withDirective\(messages, languageOf\(\), options\.sample\)/, "every provider call gets the directive");

// 6. Voice: the transcription language is auto-detected (no hint is sent).
assert.ok(!/["']language["']|\blanguage:/.test(read("voice.cjs")), "voice.cjs must leave Whisper language on auto");

// 7. Smoke render in pt-BR: views contain no leftover English phrases.
const node = (id) => ({ value: "", innerHTML: "", textContent: "", classList: { add() {}, remove() {} }, addEventListener() {} });
const ctx = {
  document: { querySelector: node, querySelectorAll: () => [], addEventListener() {}, activeElement: { tagName: "BODY" } },
  location: { hash: "#home" },
  window: { addEventListener() {}, scrollTo() {} },
  localStorage: { getItem: (k) => (k === "spark-lang" ? "pt-BR" : null), setItem() {} },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  setTimeout: () => 0,
  setInterval: () => 0,
  clearTimeout() {},
  console,
  URL,
};
vm.createContext(ctx);
for (const file of ["dist/assets/i18n-pt.js", "dist/assets/i18n.js", "dist/assets/idea-model.js", "dist/assets/app.js"]) vm.runInContext(read(file), ctx);
vm.runInContext(read("dist/assets/business-math.js").replace(/if \(typeof module[\s\S]*$/, ""), ctx);
const run = (s) => vm.runInContext(s, ctx);
assert.equal(run("I18N.lang"), "pt-BR");
run(`state={records:[{id:'i1',type:'idea',title:'Bolo caseiro',body:'Vender bolos',stage:'exploring',fields:{currency:'R$',price:'25,50'},updated:new Date().toISOString(),links:[]},{id:'n1',type:'inbox',title:'Captura',body:'Quero vender doces',stage:'inbox',fields:{},updated:new Date().toISOString(),links:[]}],sessions:[],messages:[],providers:[],activeRuns:[],jobs:[],layouts:{},assistantRuns:[],voice:{},assistant:{planner:{},writer:{},simulation:{}},cost:{},language:'pt-BR'}`);
const html = {
  home: run("home()"),
  ideas: run("collection('idea')"),
  inbox: run("collection('inbox')"),
  chat: run("chat()"),
  brief: run("renderBrief('i1')"),
};
const ENGLISH = /\b(the|and|your|with|this|that|Add|Save|Delete|Cancel|Settings|Ideas|Inbox|Home|Search|empty|yet|from|here|nothing|Create|New|Open|Retry|Edit)\b/;
for (const [name, out] of Object.entries(html)) {
  const text = out.replace(/<[^>]*>/g, " ").replace(/Bolo caseiro|Vender bolos|Captura|Quero vender doces/g, "");
  assert.ok(out.length > 200, name + " rendered");
  const hit = text.match(ENGLISH);
  assert.ok(!hit, `${name} still has English text near: ${hit && text.slice(Math.max(0, hit.index - 40), hit.index + 40)}`);
}
assert.match(html.home, /Início|Bem-vind|Capture|Capturar|ideia/i);
assert.match(run("fmtMoney(1299.5, 'R$')"), /R\$.1\.299,50/);

if (process.env.DUMP) console.log(html.home.replace(/<[^>]*>/g, " ").replace(/s+/g, " ").slice(0, 500), html.brief.replace(/<[^>]*>/g, " ").replace(/s+/g, " ").slice(0, 400));
console.log("i18n tests passed (" + used.size + " keys, " + Object.keys(PT).length + " entries)");
