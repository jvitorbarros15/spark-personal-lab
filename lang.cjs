"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { fail } = require("./store.cjs");
const I18N = require("./dist/assets/i18n.js");

const NAMES = { en: "English", "pt-BR": "Brazilian Portuguese" };

function createLanguage({ directory }) {
  const file = path.join(directory, "language.json");
  let saved = null;
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8")).language;
    if (I18N.LANGS.includes(v)) saved = v;
  } catch (e) {
    if (e.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
  }
  const update = (data) => {
    if (!data || !I18N.LANGS.includes(data.language)) fail("Choose English or Português (Brasil).");
    saved = data.language;
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ language: saved }));
    fs.renameSync(tmp, file);
    return { language: saved };
  };
  return { saved: () => saved, get: () => saved || "en", update };
}

// Appended to every model system prompt. JSON keys, enum values and code stay English so parsers are unaffected.
function directive(setting, sample) {
  const lang = I18N.detect(sample) || setting || "en";
  const other = lang === "en" ? "Brazilian Portuguese" : "English";
  return `\n\nLANGUAGE: Write every word of prose you produce (replies, questions, reasons, summaries, notes, plans, copy) in ${NAMES[lang]}. If the owner's own text (the idea, capture or question) is clearly written in ${other} instead, answer in that language. Keep JSON keys, enum values, field names, code and fenced block names exactly as specified in English. Do not translate quoted data.`;
}

function withDirective(messages, setting, sample) {
  const add = directive(setting, sample);
  const i = messages.findIndex((m) => m.role === "system");
  if (i < 0) return [{ role: "system", content: add.trim() }, ...messages];
  return messages.map((m, j) => (j === i ? { ...m, content: m.content + add } : m));
}

module.exports = { createLanguage, directive, withDirective };
