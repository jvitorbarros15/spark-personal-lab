"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { openStore, validateRecord } = require("./store.cjs");
const { createAttachments } = require("./attachments.cjs");
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-attachments-"));
  const store = openStore(dir);
  const record = store.put(
    "records",
    validateRecord({ type: "idea", title: "Attachment test", stage: "draft" }),
  );
  const attachments = createAttachments({
    directory: path.join(dir, "attachments"),
    store,
  });
  store.setAttachments(attachments);
  const server = http.createServer(async (req, res) => {
    try {
      if (
        !(await attachments.handle(
          req,
          res,
          new URL(req.url, "http://localhost"),
        ))
      ) {
        res.writeHead(404);
        res.end();
      }
    } catch (error) {
      res.writeHead(error.status || 500);
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data) =>
    fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  try {
    let response = await post("/api/attachments", {
      recordId: record.id,
      name: "interview.md",
      contentBase64: Buffer.from(
        "Specific evidence from a conversation.",
      ).toString("base64"),
    });
    assert.equal(response.status, 201);
    const item = await response.json();
    assert.equal(item.textReadable, true);
    assert.equal(attachments.contextFor([]), "");
    assert.match(attachments.contextFor([record.id]), /Specific evidence/);
    response = await fetch(base + `/api/attachments/${item.id}/download`);
    assert.equal(
      response.headers.get("content-type"),
      "application/octet-stream",
    );
    assert.match(response.headers.get("content-disposition"), /attachment/);
    assert.equal(
      await response.text(),
      "Specific evidence from a conversation.",
    );
    assert.equal(
      (
        await post("/api/attachments", {
          recordId: "missing",
          name: "x.txt",
          contentBase64: "eA==",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await post("/api/attachments", {
          recordId: record.id,
          name: "x.txt",
          contentBase64: "!!!",
        })
      ).status,
      400,
    );
    await post("/api/attachments", {
      recordId: record.id,
      name: "example.pdf",
      contentBase64: Buffer.from("PRIVATE BINARY CONTENT").toString("base64"),
    });
    assert.ok(
      !attachments.contextFor([record.id]).includes("PRIVATE BINARY CONTENT"),
    );
    const archive = attachments.exportData();
    assert.equal(archive.length, 2);
    assert.equal(archive[0].hash, undefined);
    assert.equal(store.archive().attachments.length, 2);
    assert.equal(store.readBackup(store.backup()).attachments.length, 2);
    const validated = attachments.validateImport(archive);
    assert.throws(
      () => attachments.validateImport([archive[0], archive[0]]),
      /identifier/,
    );
    assert.equal(
      (await fetch(base + `/api/attachments/${item.id}`, { method: "DELETE" }))
        .status,
      200,
    );
    assert.ok(
      !attachments.contextFor([record.id]).includes("Specific evidence"),
    );
    assert.equal(
      (await post(`/api/attachments/${item.id}/restore`, {})).status,
      200,
    );
    assert.match(attachments.contextFor([record.id]), /Specific evidence/);
    attachments.importData(validated, { replace: true });
    assert.equal(attachments.list().filter((x) => !x.deleted).length, 2);
    const invalidArchive = store.archive();
    invalidArchive.attachments[0].recordId = "missing";
    assert.throws(() => store.importArchive(invalidArchive), /missing entry/);
    store.put("records", { ...record, deleted: new Date().toISOString() });
    assert.equal(attachments.contextFor([record.id]), "");
    assert.equal(
      (await fetch(base + `/api/attachments/${item.id}/download`)).status,
      404,
    );
    console.log(
      "PASS: attachment upload/download, validation, selected context, binary exclusion, trash/restore, export/import and deleted-parent isolation.",
    );
    const fresh = store.put("records", validateRecord({ type: "idea", title: "Big file", stage: "draft" }));
    response = await post("/api/attachments", {
      recordId: fresh.id,
      name: "big.bin",
      contentBase64: Buffer.alloc(5 * 1024 * 1024, 7).toString("base64"),
    });
    assert.equal(response.status, 201, "a file at the advertised 5 MB limit is accepted");
    assert.equal(
      (await post("/api/attachments", { recordId: fresh.id, name: "bad.bin", contentBase64: "not base64!" })).status,
      400,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
