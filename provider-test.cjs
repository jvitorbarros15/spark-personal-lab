"use strict";
// Protocol fixtures are served locally; these tests never contact paid providers.
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { providerManager, localEndpoint } = require("./providers.cjs");
const sse = (item) => `data: ${JSON.stringify(item)}\r\n\r\n`;
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-provider-test-"));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const data = raw ? JSON.parse(raw) : {};
    const provider = req.url.split("/")[1];
    requests.push({ provider, url: req.url, data, headers: req.headers });
    if (req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          provider === "gemini"
            ? {
                models: [
                  { name: "models/test-model", displayName: "Test model" },
                ],
              }
            : { data: [{ id: "test-model" }] },
        ),
      );
      return;
    }
    const model =
      data.model ||
      decodeURIComponent(req.url.split("/models/")[1]?.split(":")[0] || "");
    if (model === "http-error") {
      res.writeHead(429);
      res.end("DO NOT LEAK THIS SECRET DETAIL");
      return;
    }
    if (model === "redirect") {
      res.writeHead(302, { Location: "http://127.0.0.1:9/never" });
      res.end();
      return;
    }
    if (req.url.endsWith("/api/chat")) {
      if (model === "native-missing") {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write(JSON.stringify({ message: { content: '{"a":' }, done: false }) + "\n");
      res.write(JSON.stringify({ message: { content: "1}" }, done: false }) + "\n");
      res.end(JSON.stringify({ message: { content: "" }, done: true, done_reason: "stop", prompt_eval_count: 11, eval_count: 3 }) + "\n");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const start =
      provider === "openai"
        ? { type: "response.output_text.delta", delta: "A useful " }
        : provider === "anthropic"
          ? {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "A useful " },
            }
          : provider === "gemini"
            ? { candidates: [{ content: { parts: [{ text: "A useful " }] } }] }
            : {
                choices: [
                  { delta: { content: "A useful " }, finish_reason: null },
                ],
              };
    const frame = sse(start);
    res.write(frame.slice(0, 9));
    res.write(frame.slice(9));
    if (model === "cancel") return;
    if (model === "truncated") {
      res.end();
      return;
    }
    if (model === "malformed") {
      res.end("data: {invalid}\n\n");
      return;
    }
    if (model === "api-error") {
      res.end(
        sse(
          provider === "openai" || provider === "anthropic"
            ? { type: "error", error: { message: "internal detail" } }
            : { error: { message: "internal detail" } },
        ),
      );
      return;
    }
    if (model === "incomplete") {
      res.end(
        sse({
          type: "response.incomplete",
          response: { incomplete_details: { reason: "max_output_tokens" } },
        }),
      );
      return;
    }
    if (provider === "openai") {
      res.write(sse({ type: "response.output_text.delta", delta: "answer." }));
      res.end(
        sse({
          type: "response.completed",
          response: { usage: { input_tokens: 8, output_tokens: 4 } },
        }),
      );
    } else if (provider === "anthropic") {
      res.write(
        sse({
          type: "message_start",
          message: { usage: { input_tokens: 8, output_tokens: 0 } },
        }),
      );
      res.write(
        sse({
          type: "content_block_delta",
          delta: { type: "text_delta", text: "answer." },
        }),
      );
      res.write(
        sse({
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 4 },
        }),
      );
      res.end(sse({ type: "message_stop" }));
    } else if (provider === "gemini") {
      res.end(
        sse({
          candidates: [
            {
              content: {
                parts: [
                  { text: "private thinking", thought: true },
                  { text: "answer." },
                ],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4 },
        }),
      );
    } else {
      res.write(
        sse({
          choices: [{ delta: { content: "answer." }, finish_reason: "stop" }],
        }),
      );
      res.write(
        sse({ choices: [], usage: { prompt_tokens: 8, completion_tokens: 4 } }),
      );
      res.end("data: [DONE]\n\n");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const names = ["openai", "anthropic", "gemini", "local"];
  const manager = providerManager(dir, {
    testBases: Object.fromEntries(
      names.map((name) => [name, base + "/" + name]),
    ),
  });
  for (const provider of names)
    manager.update({ provider, key: "test-only-key" });
  const messages = [
    { role: "system", content: "Be helpful." },
    { role: "user", content: "Think about this." },
  ];
  const agent = (provider, model = "test-model") => ({
    provider,
    model,
    name: provider,
    role: "builder",
  });
  try {
    for (const provider of names) {
      const parts = [];
      const response = await manager.generate(
        agent(provider),
        messages,
        new AbortController().signal,
        (text) => parts.push(text),
      );
      assert.equal(response.text, "A useful answer.");
      assert.equal(parts.join(""), response.text);
      assert.deepEqual(response.usage, { input: 8, output: 4 });
      assert.equal((await manager.models(provider))[0].id, "test-model");
      await assert.rejects(
        manager.generate(
          agent(provider, "truncated"),
          messages,
          new AbortController().signal,
          () => {},
        ),
        /before completion/,
      );
      await assert.rejects(
        manager.generate(
          agent(provider, "malformed"),
          messages,
          new AbortController().signal,
          () => {},
        ),
        /malformed/,
      );
      await assert.rejects(
        manager.generate(
          agent(provider, "api-error"),
          messages,
          new AbortController().signal,
          () => {},
        ),
        /generation failed/,
      );
      await assert.rejects(
        manager.generate(
          agent(provider, "http-error"),
          messages,
          new AbortController().signal,
          () => {},
        ),
        (error) =>
          error.message.includes("429") && !error.message.includes("SECRET"),
      );
      await assert.rejects(
        manager.generate(
          agent(provider, "redirect"),
          messages,
          new AbortController().signal,
          () => {},
        ),
        /cannot connect/,
      );
    }
    const openai = requests.find(
      (r) => r.provider === "openai" && r.data.model === "test-model",
    );
    assert.equal(openai.data.store, false);
    assert.equal(openai.data.instructions, "Be helpful.");
    assert.ok(openai.data.max_output_tokens > 0);
    assert.ok(openai.url.endsWith("/responses"));
    const anthropic = requests.find(
      (r) => r.provider === "anthropic" && r.data.model === "test-model",
    );
    assert.equal(anthropic.data.system, "Be helpful.");
    assert.ok(anthropic.headers["anthropic-version"]);
    const gemini = requests.find(
      (r) => r.provider === "gemini" && r.data.contents,
    );
    assert.equal(gemini.data.contents[0].role, "user");
    assert.equal(gemini.data.systemInstruction.parts[0].text, "Be helpful.");
    await assert.rejects(
      manager.generate(
        agent("openai", "incomplete"),
        messages,
        new AbortController().signal,
        () => {},
      ),
      /generation failed/,
    );
    const controller = new AbortController();
    await assert.rejects(
      manager.generate(
        agent("local", "cancel"),
        messages,
        controller.signal,
        () => controller.abort(new Error("Stopped by test")),
      ),
    );
    assert.ok(!JSON.stringify(manager.status()).includes("test-only-key"));
    {
      const schema = { type: "object", properties: { a: { type: "number" } } },
        before = requests.length,
        parts = [],
        native = await manager.generate(agent("local", "native-ok"), messages, new AbortController().signal, (d) => parts.push(d), { json: true, schema, temperature: 0, numCtx: 4096 });
      assert.equal(native.text, '{"a":1}');
      assert.deepEqual(native.usage, { input: 11, output: 3 });
      const sent = requests[before];
      assert.equal(sent.url, "/local/api/chat");
      assert.deepEqual(sent.data.format, schema);
      assert.equal(sent.data.think, false);
      assert.deepEqual(sent.data.options, { temperature: 0, num_ctx: 4096 });
      const fallback = await manager.generate(agent("local", "native-missing"), messages, new AbortController().signal, () => {}, { json: true, schema });
      assert.match(fallback.text, /answer\./);
      assert.equal(requests.at(-1).url, "/local/chat/completions");
      assert.deepEqual(requests.at(-1).data.response_format, { type: "json_object" });
      const plain = requests.length;
      await manager.generate(agent("local", "native-ok"), messages, new AbortController().signal, () => {}, { temperature: 0.6, noThink: true });
      assert.equal(requests[plain].url, "/local/api/chat");
      assert.equal(requests[plain].data.think, false);
      assert.equal(requests[plain].data.format, undefined);
      await manager.generate(agent("local", "native-missing"), messages, new AbortController().signal, () => {}, { noThink: true });
      assert.equal(requests.at(-1).url, "/local/chat/completions");
    }
    assert.throws(() => localEndpoint("https://example.com/v1"), /localhost/);
    assert.throws(
      () => localEndpoint("http://user:pass@localhost:1234/v1"),
      /credentials/,
    );
    assert.equal(
      localEndpoint("http://127.0.0.1:1234/v1/"),
      "http://127.0.0.1:1234/v1",
    );
    console.log(
      "PASS: all four provider protocols, fragmented streaming, usage, model lists, errors, truncated output, cancellation, redirect refusal and secret redaction.",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
