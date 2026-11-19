"use strict";
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const TYPES = ["inbox", "idea", "problem", "note", "technology", "experiment", "competitor"];
const STAGES = [
  "inbox",
  "draft",
  "exploring",
  "validating",
  "building",
  "done",
  "parked",
];
const CONNECTION_TYPES = ["tag-match", "type-similarity", "semantic"];
const FIELDS = {
  inbox: [],
  note: [],
  technology: ["useCase", "maturity", "risks", "source"],
  problem: [
    "people",
    "context",
    "example",
    "workaround",
    "evidence",
    "unknowns",
  ],
  idea: ["solution", "audience", "payment", "alternatives", "nextStep", "researchQueries", "currency", "price", "variableCost", "fixedCosts", "hoursPerCustomer", "availableHours"],
  competitor: ["website", "facts", "pricing", "audience", "sources", "researchedOn", "gaps"],
  experiment: [
    "hypothesis",
    "plan",
    "success",
    "deadline",
    "results",
    "decision",
  ],
};
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function text(v, max = 100000) {
  if (typeof v !== "string" || v.length > max) fail("Invalid text field.");
  return v;
}
function id(v) {
  const value = text(v, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail("Invalid identifier.");
  return value;
}
const ORIGINS = ["user", "assistant", "simulation", "import"];
const EVIDENCE = {
  problem: ["evidence"],
  experiment: ["results", "decision"],
  competitor: ["pricing", "sources"],
  technology: ["source"],
  idea: ["price", "variableCost", "fixedCosts", "hoursPerCustomer", "availableHours"],
};
const generated = (o) => o?.by === "assistant" || o?.by === "simulation";
const needsReview = (r) => generated(r.origin) && !r.reviewed;
function validateOrigin(r) {
  const o = r.origin ?? (r.assistantRun ? { by: "assistant", runId: r.assistantRun } : { by: "user" });
  if (!o || typeof o !== "object" || !ORIGINS.includes(o.by)) fail("Invalid entry origin.");
  return {
    by: o.by,
    ...(o.runId ? { runId: id(o.runId) } : {}),
    ...(o.stage ? { stage: text(o.stage, 50) } : {}),
    ...(o.model ? { model: text(o.model, 200) } : {}),
  };
}
const CLASS_TYPES = TYPES.filter((t) => t !== "inbox");
const prob = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 1000) / 1000 : fail("Invalid classification probability."));
function validateClassification(c) {
  if (c === undefined || c === null) return null;
  if (typeof c !== "object" || Array.isArray(c) || !CLASS_TYPES.includes(c.type)) fail("Invalid classification.");
  const alt = c.alternatives ?? [];
  if (!Array.isArray(alt) || alt.length > 6 || alt.some((a) => !a || typeof a !== "object" || !CLASS_TYPES.includes(a.type))) fail("Invalid classification alternatives.");
  return {
    type: c.type,
    p: prob(c.p),
    alternatives: alt.map((a) => ({ type: a.type, p: prob(a.p) })),
    model: text(c.model ?? "", 200),
    ...(c.uncertain === true ? { uncertain: true } : {}),
    ...(c.corrected === true ? { corrected: true } : {}),
  };
}
function validateCorrection(c) {
  if (!c || !CLASS_TYPES.includes(c.predicted) || !CLASS_TYPES.includes(c.corrected) || typeof c.text !== "string" || !c.text.trim()) fail("Invalid correction.");
  return { id: c.id ? id(c.id) : crypto.randomUUID(), text: text(c.text.trim(), 400), predicted: c.predicted, corrected: c.corrected, at: c.at ? text(c.at, 50) : new Date().toISOString() };
}
function validateRecord(r) {
  if (
    !r ||
    !TYPES.includes(r.type) ||
    !STAGES.includes(r.stage) ||
    typeof r.title !== "string" ||
    !r.title.trim()
  )
    fail("Entry needs a title, valid type and stage.");
  const fields = {};
  for (const key of FIELDS[r.type])
    if (r.fields?.[key] !== undefined) fields[key] = text(r.fields[key]);
  if (
    r.links !== undefined &&
    (!Array.isArray(r.links) ||
      r.links.length > 100 ||
      r.links.some((x) => typeof x !== "string" || x.length > 100))
  )
    fail("Invalid entry links.");
  if (r.private !== undefined && typeof r.private !== "boolean") fail("Invalid private flag.");
  const classification = validateClassification(r.classification),
    origin = validateOrigin(r),
    legacy = r.assistantRun && r.origin === undefined && r.reviewed === undefined,
    reviewed = r.reviewed ? text(r.reviewed, 50) : legacy ? text(r.updated || r.created || new Date().toISOString(), 50) : null;
  if (generated(origin) && !reviewed)
    for (const key of EVIDENCE[r.type] || [])
      if (String(fields[key] ?? "").trim()) fail(`Generated entries cannot fill the evidence field "${key}". Accept the entry first, then enter it yourself.`);
  return {
    id: r.id ? id(r.id) : crypto.randomUUID(),
    type: r.type,
    title: text(r.title.trim(), 300),
    body: text(r.body || ""),
    stage: r.stage,
    category: text(r.category || "", 100),
    fields,
    links: [...new Set(r.links || [])],
    created: r.created ? text(r.created, 50) : new Date().toISOString(),
    updated: new Date().toISOString(),
    deleted: r.deleted ? text(r.deleted, 50) : null,
    origin,
    reviewed,
    private: r.private === true,
    ...(classification ? { classification } : {}),
  };
}
const RUN_STATUSES = ["queued", "running", "done", "failed", "undone"];
const ms = (v) => Math.max(0, Math.floor(Number(v) || 0));
const stageOf = (v, fallback) => ({ provider: text(v?.provider || fallback.provider || "", 50), model: text(v?.model || fallback.model || "", 200) });
function validateRun(r) {
  if (!r || !RUN_STATUSES.includes(r.status) || !Array.isArray(r.steps) || r.steps.length > 100 || !Array.isArray(r.createdIds) || r.createdIds.length > 200)
    fail("Invalid assistant run.");
  const u = r.usage && typeof r.usage === "object" ? r.usage : {};
  return {
    id: id(r.id),
    captureId: id(r.captureId),
    provider: text(r.provider || "", 50),
    model: text(r.model || "", 200),
    planner: stageOf(r.planner, r),
    writer: stageOf(r.writer, r),
    timings: { planMs: ms(r.timings?.planMs), searchMs: ms(r.timings?.searchMs), writeMs: ms(r.timings?.writeMs) },
    status: r.status,
    private: r.private === true,
    phase: text(r.phase || "", 200),
    planSource: text(r.planSource || "", 20),
    steps: r.steps.map((s) => ({
      action: text(String(s?.action ?? ""), 100),
      input: s?.input === undefined ? null : JSON.parse(text(JSON.stringify(s.input), 20000)),
      result: s?.result === undefined ? null : JSON.parse(text(JSON.stringify(s.result), 20000)),
      error: text(String(s?.error ?? ""), 1000),
      at: text(String(s?.at ?? ""), 50),
    })),
    createdIds: r.createdIds.map(id),
    sessionId: r.sessionId ? id(r.sessionId) : "",
    messageId: r.messageId ? id(r.messageId) : "",
    usage: {
      calls: Math.max(0, Math.floor(Number(u.calls) || 0)),
      inputTokens: Math.max(0, Number(u.inputTokens) || 0),
      outputTokens: Math.max(0, Number(u.outputTokens) || 0),
    },
    started: text(r.started || "", 50),
    finished: text(r.finished || "", 50),
    error: text(r.error || "", 1000),
  };
}
const JOB_STATUSES = ["queued", "running", "waiting_user", "stopped", "done", "failed", "cancelled"];
const str = (v, max) => (v === undefined || v === null ? "" : text(String(v), max));
const list = (v, max, each) => (Array.isArray(v) ? v.slice(0, max).map((x) => str(x, each)) : []);
const cut = (v, max) => (v === undefined || v === null ? "" : String(v).slice(0, max));
function validatePaper(p) {
  if (!p || typeof p.title !== "string" || !p.id) fail("Invalid paper.");
  return {
    id: text(p.id, 300),
    title: cut(p.title, 1000),
    authors: Array.isArray(p.authors) ? p.authors.slice(0, 50).map((a) => cut(a, 200)) : [],
    year: Number.isInteger(p.year) ? p.year : null,
    venue: p.venue ? cut(p.venue, 500) : null,
    doi: p.doi ? str(p.doi, 300) : null,
    arxivId: p.arxivId ? str(p.arxivId, 100) : null,
    url: p.url ? str(p.url, 2000) : null,
    oaUrl: p.oaUrl ? str(p.oaUrl, 2000) : null,
    abstract: p.abstract ? cut(p.abstract, 20000) : null,
    verified: p.verified && typeof p.verified === "object" ? { by: str(p.verified.by, 20), ...(p.verified.doi ? { doi: str(p.verified.doi, 300) } : {}), ...(p.verified.id ? { id: str(p.verified.id, 100) } : {}) } : null,
    sources: list(p.sources, 10, 50),
    firstSeen: str(p.firstSeen, 50),
  };
}
const DECISIONS = ["include", "exclude", "maybe"];
function validateDecision(d) {
  if (!d || !DECISIONS.includes(d.decision) || !d.ideaId || !d.paperId) fail("Invalid paper decision.");
  const sg = d.suggestion;
  return {
    id: text(d.id || `${d.ideaId}|${d.paperId}`, 500),
    ideaId: id(d.ideaId),
    paperId: text(d.paperId, 300),
    decision: d.decision,
    by: ["user", "system"].includes(d.by) ? d.by : "system",
    reason: str(d.reason, 1000),
    via: str(d.via, 30),
    suggestion: sg && Number.isInteger(sg.score) ? { score: Math.max(0, Math.min(3, sg.score)), reason: str(sg.reason, 500), by: "simulation", model: str(sg.model, 200), ...(Array.isArray(sg.probs) && sg.probs.length === 4 && sg.probs.every((p) => Number.isFinite(p)) ? { probs: sg.probs.map((p) => Math.round(p * 1000) / 1000) } : {}), ...(Number.isFinite(sg.cosine) ? { cosine: Math.round(sg.cosine * 1000) / 1000 } : {}), ...(Number.isFinite(sg.coverage) ? { coverage: Math.round(sg.coverage * 1000) / 1000 } : {}) } : null,
    at: str(d.at, 50),
  };
}
function validateSearch(s) {
  if (!s || typeof s.query !== "string") fail("Invalid search log entry.");
  text(JSON.stringify(s), 100000);
  return { ...s, id: id(s.id), ideaId: id(s.ideaId), query: text(s.query, 1000) };
}
function validateJob(j) {
  if (!j || !["test_pipeline", "research_pipeline"].includes(j.kind) || !JOB_STATUSES.includes(j.status) || !Array.isArray(j.stages) || j.stages.length > 20)
    fail("Invalid job.");
  text(JSON.stringify(j), 5000000);
  return { ...j, id: id(j.id), ideaId: id(j.ideaId) };
}
function checkValidating(store, record) {
  if (record.type !== "idea" || record.stage !== "validating") return;
  const linked = (x) => x.links?.includes(record.id) || record.links.includes(x.id);
  const ok = store
    .list("records")
    .some((x) => x.type === "experiment" && !x.deleted && linked(x) && !needsReview(x) && String(x.fields?.results ?? "").trim());
  if (!ok) fail("To move this idea to validating, link an experiment and write down its real results first.");
}
function validateAgent(a) {
  if (!a || !["openai", "anthropic", "gemini", "local"].includes(a.provider))
    fail("Choose a supported provider.");
  return {
    id: a.id ? id(a.id) : crypto.randomUUID(),
    name: text(a.name || a.role || "Agent", 100),
    role: text(a.role || "explorer", 100),
    provider: a.provider,
    model: text(a.model || "", 200),
    instruction: text(a.instruction || "", 10000),
  };
}
function validateSession(s) {
  if (
    !s ||
    typeof s.title !== "string" ||
    !Array.isArray(s.agents) ||
    s.agents.length > 6 ||
    !Array.isArray(s.contextIds) ||
    s.contextIds.length > 50 ||
    !["solo", "parallel", "team"].includes(s.mode)
  )
    fail("Invalid session.");
  const agents = s.agents.map(validateAgent);
  if (new Set(agents.map((a) => a.id)).size !== agents.length)
    fail("Participants must have unique IDs.");
  return {
    id: s.id ? id(s.id) : crypto.randomUUID(),
    title: text(s.title, 300),
    agents,
    contextIds: s.contextIds.map(id),
    mode: s.mode,
    rounds: Math.min(3, Math.max(1, Math.floor(Number(s.rounds) || 1))),
    localOnly: !!s.localOnly,
    created: s.created ? text(s.created, 50) : new Date().toISOString(),
    updated: new Date().toISOString(),
    deleted: s.deleted ? text(s.deleted, 50) : null,
  };
}
function cleanMessage(m) {
  if (
    !m ||
    !["user", "assistant"].includes(m.role) ||
    !["complete", "failed", "cancelled", "running"].includes(m.status)
  )
    fail("Invalid saved message.");
  const context = text(m.context || "", 300000);
  if (context) {
    let messages;
    try {
      messages = JSON.parse(context);
    } catch {
      fail("Invalid saved message context.");
    }
    if (
      !Array.isArray(messages) ||
      messages.length > 100 ||
      messages.some(
        (x) =>
          !x ||
          !["system", "user", "assistant"].includes(x.role) ||
          typeof x.content !== "string",
      )
    )
      fail("Invalid saved message context.");
  }
  return {
    id: id(m.id),
    sessionId: id(m.sessionId),
    runId: m.runId ? id(m.runId) : "",
    role: m.role,
    agent: m.agent ? validateAgent(m.agent) : null,
    text: text(m.text || "", 500000),
    status: m.status === "running" ? "cancelled" : m.status,
    error: text(m.error || "", 1000),
    round: Math.max(0, Math.min(3, Math.floor(Number(m.round) || 0))),
    usage:
      m.usage && typeof m.usage === "object"
        ? {
            input: Math.max(0, Number(m.usage.input) || 0),
            output: Math.max(0, Number(m.usage.output) || 0),
          }
        : null,
    created: text(m.created, 50),
    context,
    attempt: Math.max(1, Math.floor(Number(m.attempt) || 1)),
  };
}
function validateArchive(data) {
  if (data?.version === 1 && Array.isArray(data.records)) {
    const typeMap = {
      ideas: "idea",
      problems: "problem",
      experiments: "experiment",
      tech: "technology",
      library: "note",
    };
    data = {
      format: "spark-workbench",
      version: 2,
      records: data.records
        .filter((r) => r && r.demo !== true)
        .map((r) => {
          const stage = String(r.stage || "draft").toLowerCase();
          return {
            id: "legacy-" + id(r.id),
            type: typeMap[r.type] || "note",
            title: r.title,
            body: r.description || "",
            category: r.category || "",
            stage: STAGES.includes(stage) ? stage : "draft",
            fields: {},
            links: r.linked ? ["legacy-" + id(r.linked)] : [],
          };
        }),
      sessions: [],
      messages: [],
    };
  }
  if (
    !data ||
    data.format !== "spark-workbench" ||
    data.version !== 2 ||
    !Array.isArray(data.records) ||
    !Array.isArray(data.sessions) ||
    !Array.isArray(data.messages) ||
    data.records.length > 10000 ||
    data.sessions.length > 2000 ||
    data.messages.length > 50000 ||
    (data.assistantRuns !== undefined && (!Array.isArray(data.assistantRuns) || data.assistantRuns.length > 5000)) ||
    (data.jobs !== undefined && (!Array.isArray(data.jobs) || data.jobs.length > 2000)) ||
    (data.papers !== undefined && (!Array.isArray(data.papers) || data.papers.length > 50000)) ||
    (data.paperDecisions !== undefined && (!Array.isArray(data.paperDecisions) || data.paperDecisions.length > 100000)) ||
    (data.searchLog !== undefined && (!Array.isArray(data.searchLog) || data.searchLog.length > 20000)) ||
    (data.usage !== undefined && (!Array.isArray(data.usage) || data.usage.length > 200000)) ||
    (data.corrections !== undefined && (!Array.isArray(data.corrections) || data.corrections.length > 200))
  )
    fail("Not a supported Spark backup.");
  const records = data.records.map(validateRecord),
    sessions = data.sessions.map(validateSession),
    messages = data.messages.map(cleanMessage),
    assistantRuns = (data.assistantRuns || []).map(validateRun),
    jobs = (data.jobs || []).map(validateJob),
    papers = (data.papers || []).map(validatePaper),
    paperDecisions = (data.paperDecisions || []).map(validateDecision),
    searchLog = (data.searchLog || []).map(validateSearch),
    usage = (data.usage || []).map(require("./cost.cjs").validateUsage),
    corrections = (data.corrections || []).map(validateCorrection);
  for (const list of [records, sessions, messages, assistantRuns, jobs, papers, paperDecisions, searchLog, usage, corrections]) {
    const ids = new Set();
    for (const r of list) {
      if (ids.has(r.id)) fail("Duplicate identifiers in backup.");
      ids.add(r.id);
    }
  }
  const sessionIds = new Set(sessions.map((x) => x.id));
  if (messages.some((x) => !sessionIds.has(x.sessionId)))
    fail("A message refers to a missing session.");
  return { records, sessions, messages, assistantRuns, jobs, papers, paperDecisions, searchLog, usage, corrections, hasCorrections: data.corrections !== undefined };
}
function openStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, "spark.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assistant_runs (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS paper_decisions (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS search_log (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS connections (from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL, strength REAL, reason TEXT, created TEXT, PRIMARY KEY (from_id, to_id)); CREATE TABLE IF NOT EXISTS embeddings (hash TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, vector BLOB NOT NULL); CREATE TABLE IF NOT EXISTS corrections (id TEXT PRIMARY KEY, json TEXT NOT NULL)",
  );
  for (const r of db.prepare("SELECT json FROM records").all().map((x) => JSON.parse(x.json)))
    if (r.assistantRun && !r.origin) {
      const { assistantRun, ...rest } = r;
      db.prepare("UPDATE records SET json=? WHERE id=?").run(JSON.stringify({ ...rest, origin: { by: "assistant", runId: assistantRun }, reviewed: r.updated }), r.id);
    }
  const tableNames = new Set(["records", "sessions", "messages", "assistant_runs", "jobs", "papers", "paper_decisions", "search_log", "usage", "corrections"]);
  const list = (table) => {
    if (!tableNames.has(table)) fail("Unknown table");
    return db
      .prepare(`SELECT json FROM ${table} ORDER BY rowid`)
      .all()
      .map((x) => JSON.parse(x.json));
  };
  const get = (table, key) => {
    if (!tableNames.has(table)) fail("Unknown table");
    const row = db.prepare(`SELECT json FROM ${table} WHERE id=?`).get(key);
    return row ? JSON.parse(row.json) : null;
  };
  const put = (table, r) => {
    if (!tableNames.has(table)) fail("Unknown table");
    db.prepare(
      `INSERT INTO ${table} (id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json`,
    ).run(r.id, JSON.stringify(r));
    return r;
  };

const putConnection = (fromId, toId, type, strength, reason) => {


  const connection = {
    from_id: fromId,
    to_id: toId,
    type: type,
    strength: strength !== undefined ? strength : 0.5,
    reason: reason || "",
    created: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO connections (from_id,to_id,type,strength,reason,created) VALUES (?,?,?,?,?,?) ON CONFLICT(from_id,to_id) DO UPDATE SET type=excluded.type,strength=excluded.strength,reason=excluded.reason`,
  ).run(fromId,toId,type,connection.strength,connection.reason,connection.created);
  return connection;
};

  const getConnection = (fromId, toId) => {
  
    const row = db
      .prepare(`SELECT * FROM connections WHERE from_id=? AND to_id=?`)
      .get(fromId, toId);
    return row || null;
  };

  const listConnections = (filterFromId) => {
  
    let query = `SELECT * FROM connections`;
    let params = [];
    if (filterFromId) {
      query += ` WHERE from_id=?`;
      params = [filterFromId];
    }
    query += ` ORDER BY rowid`;
    const rows = db.prepare(query).all(...params);
    return rows;
  };

  const getEmbedding = (hash) => {
    const row = db.prepare("SELECT vector FROM embeddings WHERE hash=?").get(hash);
    if (!row) return null;
    const b = row.vector;
    return Array.from(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  };
  const putEmbedding = (hash, model, vector) => {
    db.prepare("INSERT INTO embeddings (hash,model,dim,vector) VALUES (?,?,?,?) ON CONFLICT(hash) DO UPDATE SET model=excluded.model,dim=excluded.dim,vector=excluded.vector").run(hash, model, vector.length, Buffer.from(new Float32Array(vector).buffer));
  };

  let attachmentExtension = null;
  const archive = ({ corrections = false } = {}) => ({
    format: "spark-workbench",
    version: 2,
    exported: new Date().toISOString(),
    records: list("records"),
    sessions: list("sessions"),
    messages: list("messages").map((m) =>
      m.status === "running"
        ? { ...m, status: "cancelled", error: "Interrupted before completion." }
        : m,
    ),
    assistantRuns: list("assistant_runs"),
    jobs: list("jobs"),
    papers: list("papers"),
    paperDecisions: list("paper_decisions"),
    searchLog: list("search_log"),
    usage: list("usage"),
    attachments: attachmentExtension ? attachmentExtension.exportData() : [],
    ...(corrections ? { corrections: list("corrections") } : {}),
  });
  const backupsDir = path.join(directory, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  function backups() {
    return fs
      .readdirSync(backupsDir)
      .filter((x) => /^spark-[\w-]+\.json$/.test(x))
      .sort()
      .reverse();
  }
  function backup() {
    const name = `spark-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.json`,
      temporary = path.join(backupsDir, name + ".tmp");
    fs.writeFileSync(temporary, JSON.stringify(archive({ corrections: true })), { mode: 0o600 });
    fs.renameSync(temporary, path.join(backupsDir, name));
    for (const old of backups().slice(20))
      fs.unlinkSync(path.join(backupsDir, old));
    return name;
  }
  function importArchive(data, mode = "merge") {
    const valid = validateArchive(data);
    if (!["merge", "replace"].includes(mode)) fail("Choose merge or replace.");
    const files = attachmentExtension
      ? attachmentExtension.validateImport(data.attachments)
      : [];
    const recordIds = new Set(valid.records.map((r) => r.id));
    if (files.some((f) => !recordIds.has(f.recordId)))
      fail("An attachment refers to a missing entry.");
    backup();
    db.exec("BEGIN");
    try {
      if (mode === "replace") {
        const now = new Date().toISOString();
        for (const t of ["records", "sessions"])
          for (const r of list(t)) put(t, { ...r, deleted: now });
        // Restore imported discussions to the snapshot, rather than mixing in
        // newer replies. The pre-import backup preserves their current state.
        const importedSessions = new Set(valid.sessions.map((s) => s.id));
        const removeMessage = db.prepare("DELETE FROM messages WHERE id=?");
        for (const message of list("messages"))
          if (importedSessions.has(message.sessionId)) removeMessage.run(message.id);
      }
      if (mode === "replace" && valid.hasCorrections) db.prepare("DELETE FROM corrections").run();
      for (const [t, rows] of [["records", valid.records], ["sessions", valid.sessions], ["messages", valid.messages], ["assistant_runs", valid.assistantRuns], ["jobs", valid.jobs], ["papers", valid.papers], ["paper_decisions", valid.paperDecisions], ["search_log", valid.searchLog], ["usage", valid.usage], ["corrections", valid.corrections]])
        for (const r of rows) put(t, r);
      db.prepare("DELETE FROM corrections WHERE rowid NOT IN (SELECT rowid FROM corrections ORDER BY rowid DESC LIMIT 200)").run();
      if (attachmentExtension)
        attachmentExtension.importData(files, { replace: mode === "replace" });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    backup();
    return {
      records: valid.records.length,
      sessions: valid.sessions.length,
      messages: valid.messages.length,
      assistantRuns: valid.assistantRuns.length,
      jobs: valid.jobs.length,
      papers: valid.papers.length,
      paperDecisions: valid.paperDecisions.length,
      usage: valid.usage.length,
      corrections: valid.corrections.length,
      attachments: files.length,
    };
  }
  // A process restart cannot resume an upstream stream. Preserve any partial content.
  for (const m of list("messages"))
    if (m.status === "running")
      put("messages", {
        ...m,
        status: "cancelled",
        error: "Interrupted when Spark stopped. Retry to continue.",
      });
  for (const r of list("assistant_runs"))
    if (r.status === "running" || r.status === "queued")
      put("assistant_runs", { ...r, status: "failed", phase: "", error: "Interrupted when Spark stopped.", finished: new Date().toISOString() });
  for (const j of list("jobs"))
    if (j.status === "running" || j.status === "queued")
      put("jobs", { ...j, status: "stopped", gate: null, error: "Interrupted when Spark stopped. Resume to continue.", stages: j.stages.map((x) => (x.status === "running" ? { ...x, status: "pending" } : x)) });
  return {
    db, putConnection, getConnection, listConnections, getEmbedding, putEmbedding,
    list,
    get,
    put,
    archive,
    backup,
    backups,
    importArchive,
    setAttachments: (extension) => {
      attachmentExtension = extension;
    },
    readBackup: (name) => {
      if (!backups().includes(name)) fail("Backup not found", 404);
      return JSON.parse(fs.readFileSync(path.join(backupsDir, name), "utf8"));
    },
    close: () => db.close(),
  };
}
module.exports = {
  openStore,
  validateRecord,
  validateSession,
  validateAgent,
  validateArchive,
  validateRun,
  validateJob,
  validatePaper,
  validateDecision,
  checkValidating,
  cleanMessage,
  fail,
  TYPES,
  CLASS_TYPES,
  validateCorrection,
  STAGES,
  FIELDS,
  CONNECTION_TYPES,
  needsReview,
};
