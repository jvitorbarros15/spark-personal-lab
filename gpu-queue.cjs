"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const STALE_MS = 30000,
  BEAT_MS = 5000,
  POLL_MS = 150,
  MAX_PENDING = 8;
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", stop);
      resolve();
    }
    function stop() {
      clearTimeout(t);
      reject(signal.reason || Error("Cancelled."));
    }
    if (signal?.aborted) return stop();
    signal?.addEventListener("abort", stop, { once: true });
  });

// FIFO across processes: each caller drops a ticket file, the oldest live ticket runs.
// A crashed or frozen holder stops touching its ticket and is dropped after STALE_MS.
function createGpuQueue({ directory, staleMs = STALE_MS, pollMs = POLL_MS }) {
  fs.mkdirSync(directory, { recursive: true });
  let waiting = 0,
    seq = 0;
  function live() {
    const out = [];
    for (const name of fs.readdirSync(directory)) {
      if (!name.endsWith(".ticket")) continue;
      const file = path.join(directory, name);
      try {
        if (Date.now() - fs.statSync(file).mtimeMs > staleMs) fs.rmSync(file, { force: true });
        else out.push(name);
      } catch {}
    }
    return out.sort();
  }
  // One ticket per process keeps the queue fair between people: a busy person waits in line with their own requests instead of ahead of everyone.
  let tail = Promise.resolve(),
    pending = 0;
  async function run(fn, signal) {
    if (pending >= MAX_PENDING) throw Object.assign(Error("Too many requests are waiting for the GPU. Try again in a moment."), { status: 429 });
    pending++;
    const turn = tail;
    let release;
    tail = new Promise((r) => (release = r));
    try {
      await sleep(0, signal);
      await Promise.race([turn, new Promise((_, no) => signal?.addEventListener("abort", () => no(signal.reason || Error("Cancelled.")), { once: true }))]);
      return await ticketed(fn, signal);
    } finally {
      pending--;
      turn.then(release);
    }
  }
  async function ticketed(fn, signal) {
    const name = `${String(Date.now()).padStart(15, "0")}-${String(seq++ % 1e6).padStart(6, "0")}-${process.pid}-${crypto.randomBytes(4).toString("hex")}.ticket`,
      file = path.join(directory, name);
    fs.writeFileSync(file, String(process.pid));
    const beat = setInterval(() => {
      try {
        const now = new Date();
        fs.utimesSync(file, now, now);
      } catch {}
    }, BEAT_MS);
    let counted = false;
    try {
      await sleep(30, signal);
      while (live()[0] !== name) {
        if (!counted) {
          counted = true;
          waiting++;
        }
        await sleep(pollMs + Math.random() * 50, signal);
      }
      if (counted) {
        counted = false;
        waiting--;
      }
      return await fn();
    } finally {
      if (counted) waiting--;
      clearInterval(beat);
      fs.rmSync(file, { force: true });
    }
  }
  return { run, waiting: () => waiting, ahead: () => Math.max(0, live().length - 1) };
}
module.exports = { createGpuQueue };
