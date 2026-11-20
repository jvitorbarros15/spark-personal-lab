"use strict";
const crypto = require("node:crypto");
const { fail, validateRecord, validateSession } = require("./store.cjs");
const { IDEA_LABELS, clip } = require("./founder.cjs");
const { BLOCKS, BLOCK_KEYS, MAX_BULLETS } = require("./canvas.cjs");

// Number fields (price, costs, hours) are evidence fields: a model never proposes them.
const FIELD_TARGETS = { title: "Title", solution: IDEA_LABELS.solution, audience: IDEA_LABELS.audience, payment: IDEA_LABELS.payment, alternatives: IDEA_LABELS.alternatives, nextStep: IDEA_LABELS.nextStep };
const BLOCK_LABEL = Object.fromEntries(BLOCKS);
const MAX_UPDATES = 5;
const MAX_BRANCHES = 3;
const MAX_CHANGES = 6;
const AGENT_ID = "idea-partner";

const CHAT_SYSTEM = `You are the owner's thinking partner for ONE idea, inside a personal idea workbench. Everything Spark worked out about the idea is in the IDEA CONTEXT that follows each of your instructions: the summary, the board, the competitors, the simulated buyers, the numbers, the marketing, the brand, the experiment and the business model canvas.
How to work:
- Think out loud and be concrete. Ask one short question when it would change your answer. Plain words, short paragraphs, the language of the idea.
- Ground what you say in the context. When the context does not cover something, say so. The board and the buyers are simulated, never proof; do not call anything validated. Never invent a number, price, competitor, customer or source.
- Write plain text: no markdown headings or tables; short lines starting with "-" are fine, and **bold** for a key phrase at most. You have no browsing or tools. Never claim you ran or checked anything.
When a specific change to the idea would help, or the owner asks for pivots, end your reply with ONE fenced block and nothing after it:
\`\`\`spark-proposals
{"updates":[{"target":"audience","to":"the new text","why":"one line"}],"branches":[{"title":"short name","note":"what is different, one or two sentences","changes":[{"target":"audience","to":"the new text"}]}]}
\`\`\`
Valid targets: ${Object.keys(FIELD_TARGETS).join(", ")}, or canvas:<block> with block one of ${BLOCK_KEYS.join(", ")} (for a canvas block "to" is bullet lines separated by \\n).
Use "updates" for edits to this idea, at most ${MAX_UPDATES}. Use "branches" for alternative versions of the idea that the owner could test separately: at most ${MAX_BRANCHES} (give 3 when asked for pivots), each with at most ${MAX_CHANGES} changes. Number fields (price, costs, hours) are never targets: talk about them in prose. Omit the block when nothing should change. The owner accepts or rejects each item one by one, so write each as the exact new text, not as advice.`;

const shortId = () => crypto.randomBytes(4).toString("hex");
const label = (target) => (target.startsWith("canvas:") ? BLOCK_LABEL[target.slice(7)] + " (canvas)" : FIELD_TARGETS[target]);
const validTarget = (t) => typeof t === "string" && (t in FIELD_TARGETS || (t.startsWith("canvas:") && BLOCK_KEYS.includes(t.slice(7))));

function createIdeaChat({ store, canvas, pipeline, assistant, extractJson, clock = () => new Date() }) {
  const ideaOf = (id) => {
    const idea = store.get("records", id);
    if (!idea || idea.deleted || idea.type !== "idea") fail("Idea not found.", 404);
    return idea;
  };
  const current = (idea, target) => (target === "title" ? idea.title : target.startsWith("canvas:") ? canvas.blockText(idea, target.slice(7)) : String(idea.fields[target] ?? ""));
  const asText = (v) => (Array.isArray(v) ? v.map((x) => clip(x, 300)).join("\n") : clip(v, 1500)).trim();

  function change(idea, c) {
    if (!c || !validTarget(c.target)) return null;
    let to = asText(c.to);
    if (c.target.startsWith("canvas:")) to = to.split("\n").slice(0, MAX_BULLETS).join("\n");
    if (!to || (c.target === "title" && to.length > 300)) return null;
    const from = current(idea, c.target);
    return to === from ? null : { target: c.target, label: label(c.target), from: clip(from, 1500), to };
  }

  function extract(ideaId, reply) {
    const idea = ideaOf(ideaId),
      m = reply.match(/```spark-proposals\s*([\s\S]*?)(?:```|$)/);
    if (!m) return { text: reply, proposals: null };
    const text = reply.replace(m[0], "").replace(/\s+$/, "");
    let raw;
    try {
      raw = extractJson(m[1]);
    } catch {
      return { text, proposals: null };
    }
    const updates = (Array.isArray(raw?.updates) ? raw.updates : [])
      .map((u) => {
        const c = change(idea, u);
        return c ? { id: shortId(), ...c, why: clip(u.why, 300), status: "pending" } : null;
      })
      .filter(Boolean)
      .slice(0, MAX_UPDATES);
    const branches = (Array.isArray(raw?.branches) ? raw.branches : [])
      .map((b) => {
        const changes = (Array.isArray(b?.changes) ? b.changes : []).map((c) => change(idea, c)).filter(Boolean).slice(0, MAX_CHANGES),
          title = clip(b?.title, 120).trim();
        return title && changes.length ? { id: shortId(), title, note: clip(b.note, 500), changes, status: "pending" } : null;
      })
      .filter(Boolean)
      .slice(0, MAX_BRANCHES);
    return { text, proposals: updates.length || branches.length ? { updates, branches } : null };
  }

  function session(ideaId) {
    const idea = ideaOf(ideaId),
      writer = assistant.settings().writer;
    if (!writer?.model) fail("Choose a writer model in Settings first.");
    const agent = { id: AGENT_ID, name: "Idea partner", role: "explorer", provider: writer.provider, model: writer.model, instruction: CHAT_SYSTEM };
    let s = store.list("sessions").find((x) => x.ideaId === ideaId && !x.deleted);
    s = store.put("sessions", validateSession({ ...(s || {}), title: "Work on: " + clip(idea.title, 250), agents: [agent], contextIds: [ideaId], mode: "solo", rounds: 1, localOnly: false, ideaId }));
    return s;
  }
  function open(ideaId) {
    const s = session(ideaId);
    return { session: s, messages: store.list("messages").filter((x) => x.sessionId === s.id).map((x) => ({ ...x, context: undefined })), private: pipeline.isPrivate(ideaId) };
  }

  const findProposal = (ideaId, messageId, proposalId, kind) => {
    const message = store.get("messages", messageId),
      s = message && store.get("sessions", message.sessionId);
    if (!message || !s || s.ideaId !== ideaId) fail("That suggestion was not found.", 404);
    const list = message.proposals?.[kind === "branch" ? "branches" : "updates"] || [],
      item = list.find((x) => x.id === proposalId);
    if (!item) fail("That suggestion was not found.", 404);
    return { message, item };
  };
  const mark = (message, item, patch) => {
    Object.assign(item, patch);
    store.put("messages", message);
  };

  function decide(ideaId, { messageId, proposalId, action }) {
    if (!["accept", "reject"].includes(action)) fail("Accept or reject the suggestion.");
    const { message, item } = findProposal(ideaId, messageId, proposalId, "update");
    if (item.status !== "pending") fail("You already decided on this suggestion.", 409);
    if (action === "reject") {
      mark(message, item, { status: "rejected", at: clock().toISOString() });
      return { proposal: item, rerun: null };
    }
    const idea = ideaOf(ideaId);
    if (current(idea, item.target).trim().slice(0, 1500) !== item.from) fail("This part of the idea changed after the suggestion was made. Ask again to get a fresh one.", 409);
    if (item.target.startsWith("canvas:")) canvas.setBlockByOwner(ideaId, item.target.slice(7), item.to);
    else if (item.target === "title") store.put("records", validateRecord({ ...idea, title: item.to.trim() }));
    else store.put("records", validateRecord({ ...idea, fields: { ...idea.fields, [item.target]: item.to } }));
    mark(message, item, { status: "accepted", at: clock().toISOString() });
    return { proposal: item, rerun: pipeline.rerunPlan(ideaId, [item.target]) };
  }

  function branch(ideaId, data) {
    const parent = ideaOf(ideaId),
      title = clip(data?.title, 120).trim();
    if (!title) fail("Give the branch a short name.");
    const changes = (Array.isArray(data.changes) ? data.changes : []).slice(0, MAX_CHANGES).map((c) => change(parent, c)).filter(Boolean);
    if (!changes.length) fail("A branch needs at least one change from the original.");
    const note = clip(data.note, 1000).trim() || "Changes: " + changes.map((c) => c.label).join(", ") + ".",
      fields = { ...parent.fields };
    let name = `${parent.title} (${title})`;
    for (const c of changes) {
      if (c.target === "title") name = c.to.trim();
      else if (!c.target.startsWith("canvas:")) fields[c.target] = c.to;
    }
    const at = clock().toISOString(),
      child = store.put(
        "records",
        validateRecord({
          type: "idea",
          stage: "draft",
          title: clip(name, 300),
          body: parent.body,
          category: parent.category,
          fields,
          links: [parent.id],
          origin: { by: "assistant", stage: "branch", ...(assistant.settings().writer?.model ? { model: assistant.settings().writer.model } : {}) },
          reviewed: at,
          private: parent.private === true || pipeline.isPrivate(ideaId),
          branch: { of: parent.id, note, at, changes: changes.map((c) => ({ target: c.target, label: c.label, from: c.from, to: c.to })) },
        }),
      );
    for (const c of changes) if (c.target.startsWith("canvas:")) canvas.setBlockByOwner(child.id, c.target.slice(7), c.to);
    store.putConnection(child.id, parent.id, "branch-of", 1, note);
    if (data.messageId && data.proposalId) {
      try {
        const { message, item } = findProposal(ideaId, data.messageId, data.proposalId, "branch");
        mark(message, item, { status: "created", childId: child.id, at });
      } catch {}
    }
    return store.get("records", child.id);
  }

  function dismissBranch(ideaId, { messageId, proposalId }) {
    const { message, item } = findProposal(ideaId, messageId, proposalId, "branch");
    if (item.status !== "pending") fail("You already decided on this suggestion.", 409);
    mark(message, item, { status: "rejected", at: clock().toISOString() });
    return item;
  }

  return { extract, session, open, decide, branch, dismissBranch, CHAT_SYSTEM, FIELD_TARGETS };
}

module.exports = { createIdeaChat, FIELD_TARGETS, CHAT_SYSTEM };
