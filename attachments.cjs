"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const MAX_FILE = 5 * 1024 * 1024;
const MAX_IMPORT = 20 * 1024 * 1024;
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const textTypes = new Set([".txt", ".md", ".csv", ".json", ".log"]);
function validBase64(value) {
  if (value.length % 4) return false;
  let end = value.length;
  if (value[end - 1] === "=") end--;
  if (value[end - 1] === "=") end--;
  for (let i = 0; i < end; i++) {
    const c = value.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 43 || c === 47)) return false;
  }
  return true;
}
function decode(value) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(MAX_FILE / 3) * 4 ||
    !validBase64(value)
  )
    fail("Invalid attachment data. Maximum file size is 5 MB.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > MAX_FILE) fail("Maximum file size is 5 MB.");
  return bytes;
}
function safeName(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 240 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    fail("Invalid file name.");
  return value.replace(/[\\/]/g, "_");
}
function createAttachments({ directory, store }) {
  fs.mkdirSync(directory, { recursive: true });
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, json TEXT NOT NULL)",
  );
  const all = () =>
    store.db
      .prepare("SELECT json FROM attachments ORDER BY rowid")
      .all()
      .map((row) => JSON.parse(row.json));
  const get = (id) => {
    const row = store.db
      .prepare("SELECT json FROM attachments WHERE id=?")
      .get(id);
    return row ? JSON.parse(row.json) : null;
  };
  const put = (item) =>
    store.db
      .prepare(
        "INSERT INTO attachments (id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
      )
      .run(item.id, JSON.stringify(item));
  const blobPath = (hash) => {
    if (!/^[a-f0-9]{64}$/.test(hash)) fail("Invalid attachment reference.");
    return path.join(directory, hash);
  };
  const publicItem = ({ hash, ...item }) => ({
    ...item,
    textReadable: textTypes.has(path.extname(item.name).toLowerCase()),
  });
  function saveBlob(bytes) {
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const file = blobPath(hash);
    if (!fs.existsSync(file))
      fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
    return hash;
  }
  function requireRecord(id) {
    const record = store.get("records", id);
    if (!record || record.deleted) fail("Entry not found.", 404);
    return record;
  }
  function list(recordId) {
    return all()
      .filter((item) => !recordId || item.recordId === recordId)
      .map(publicItem);
  }
  function exportData() {
    return all().map((item) => ({
      ...publicItem(item),
      contentBase64: fs.readFileSync(blobPath(item.hash)).toString("base64"),
    }));
  }
  function validateImport(data) {
    if (data === undefined) return [];
    if (!Array.isArray(data) || data.length > 2000)
      fail("Invalid attachment backup.");
    let total = 0;
    const ids = new Set();
    return data.map((item) => {
      if (
        !item ||
        typeof item.id !== "string" ||
        !item.id ||
        item.id.length > 100 ||
        ids.has(item.id) ||
        typeof item.recordId !== "string" ||
        !item.recordId ||
        item.recordId.length > 100
      )
        fail("Invalid attachment identifier.");
      ids.add(item.id);
      const bytes = decode(item.contentBase64);
      total += bytes.length;
      if (total > MAX_IMPORT)
        fail("Attachments in one import must total 20 MB or less.");
      const created = item.created || new Date().toISOString();
      if (
        typeof created !== "string" ||
        created.length > 50 ||
        (item.deleted != null &&
          (typeof item.deleted !== "string" || item.deleted.length > 50))
      )
        fail("Invalid attachment date.");
      return {
        id: item.id,
        recordId: item.recordId,
        name: safeName(item.name),
        size: bytes.length,
        created,
        deleted: item.deleted || null,
        bytes,
      };
    });
  }
  function importData(validated, { replace = false } = {}) {
    const incomingIds = new Set(validated.map((item) => item.id));
    const retainedBytes = all()
      .filter((item) => !incomingIds.has(item.id))
      .reduce((total, item) => total + item.size, 0);
    if (
      retainedBytes + validated.reduce((total, item) => total + item.size, 0) >
      MAX_IMPORT
    )
      fail("The workspace attachment limit is 20 MB, including trashed files.");
    if (replace) {
      const now = new Date().toISOString();
      for (const item of all()) put({ ...item, deleted: now });
    }
    for (const { bytes, ...item } of validated)
      put({ ...item, hash: saveBlob(bytes) });
  }
  function contextFor(recordIds) {
    const ids = new Set(recordIds);
    let remaining = 60000;
    const parts = [];
    for (const item of all().filter(
      (a) =>
        ids.has(a.recordId) &&
        !a.deleted &&
        !store.get("records", a.recordId)?.deleted,
    )) {
      const heading = `Attachment: ${item.name} (entry ${item.recordId})`;
      if (!textTypes.has(path.extname(item.name).toLowerCase())) {
        parts.push(
          `${heading}\n[File stored locally. Binary file content is not sent to models.]`,
        );
        continue;
      }
      if (remaining <= 0) {
        parts.push(
          `${heading}\n[Text excluded: attachment context limit reached.]`,
        );
        continue;
      }
      let content;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(
          fs.readFileSync(blobPath(item.hash)),
        );
      } catch {
        parts.push(
          `${heading}\n[File cannot be read as UTF-8 text; content not sent.]`,
        );
        continue;
      }
      const length = Math.min(remaining, 20000);
      const selected = content.slice(0, length);
      remaining -= selected.length;
      parts.push(
        `${heading}\n${selected}${content.length > selected.length ? "\n[Attachment text truncated.]" : ""}`,
      );
    }
    return parts.join("\n\n");
  }
  const json = (res, status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(value));
  };
  async function handle(req, res, url) {
    const match = url.pathname.match(
      /^\/api\/attachments(?:\/([^/]+)(?:\/(download|restore))?)?$/,
    );
    if (!match) return false;
    const [, id, action] = match;
    if (req.method === "GET" && !id) {
      json(res, 200, list(url.searchParams.get("recordId")));
      return true;
    }
    if (req.method === "POST" && !id) {
      if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || ""))
        fail("Use application/json.", 415);
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 7 * 1024 * 1024) fail("Maximum file size is 5 MB.", 413);
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        fail("Invalid attachment request.");
      }
      if (typeof body.recordId !== "string")
        fail("Choose an entry for the attachment.");
      requireRecord(body.recordId);
      const bytes = decode(body.contentBase64);
      if (
        all().reduce((total, item) => total + item.size, 0) + bytes.length >
        MAX_IMPORT
      )
        fail(
          "The workspace attachment limit is 20 MB, including trashed files.",
          413,
        );
      const item = {
        id: crypto.randomUUID(),
        recordId: body.recordId,
        name: safeName(body.name),
        size: bytes.length,
        hash: saveBlob(bytes),
        created: new Date().toISOString(),
        deleted: null,
      };
      put(item);
      store.backup();
      json(res, 201, publicItem(item));
      return true;
    }
    const item = id ? get(id) : null;
    if (!item) fail("Attachment not found.", 404);
    if (req.method === "GET" && action === "download") {
      if (item.deleted)
        fail("Attachment is in trash. Restore it before downloading.", 404);
      requireRecord(item.recordId);
      const bytes = fs.readFileSync(blobPath(item.hash));
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": bytes.length,
        "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(item.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
        "X-Content-Type-Options": "nosniff",
      });
      res.end(bytes);
      return true;
    }
    if (req.method === "DELETE" && !action) {
      put({ ...item, deleted: new Date().toISOString() });
      store.backup();
      json(res, 200, { ok: true });
      return true;
    }
    if (req.method === "POST" && action === "restore") {
      requireRecord(item.recordId);
      put({ ...item, deleted: null });
      store.backup();
      json(res, 200, publicItem({ ...item, deleted: null }));
      return true;
    }
    fail("Method not allowed.", 405);
  }
  return { handle, contextFor, list, exportData, validateImport, importData };
}
module.exports = { createAttachments };
