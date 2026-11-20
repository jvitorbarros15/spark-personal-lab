"use strict";
const path = require("node:path");
const { fail, TYPES } = require("./store.cjs");
const { readJson, writeJson } = require("./json-file.cjs");

const MAX_CARDS = 20;

function clean(list) {
  if (!Array.isArray(list) || list.length > MAX_CARDS) fail("A layout is a list of at most " + MAX_CARDS + " cards.");
  const seen = new Set();
  return list.map((c) => {
    if (!c || typeof c.id !== "string" || !/^[a-z][a-z0-9-]{0,29}$/.test(c.id) || seen.has(c.id)) fail("Invalid card in layout.");
    seen.add(c.id);
    const w = Number(c.w);
    if (![1, 2, 3].includes(w)) fail("A card is 1, 2 or 3 columns wide.");
    if (!["full", "compact"].includes(c.h)) fail("A card is full or compact height.");
    return { id: c.id, w, h: c.h };
  });
}

function createLayout({ directory }) {
  const file = path.join(directory, "ui-layout.json");
  let saved = readJson(file, "Cannot read ui-layout.json. Fix the JSON or delete the file before starting Spark.");
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
  const persist = (next) => {
    writeJson(file, next);
    saved = next;
  };
  const get = () => {
    const out = {};
    for (const type of TYPES) {
      try {
        if (saved[type]) out[type] = clean(saved[type]);
      } catch {}
    }
    return out;
  };
  function update(data) {
    if (!data || !TYPES.includes(data.type)) fail("Choose an entry type.");
    const next = { ...saved };
    if (data.layout === null) delete next[data.type];
    else next[data.type] = clean(data.layout);
    persist(next);
    return get();
  }
  return { get, update };
}

module.exports = { createLayout };
