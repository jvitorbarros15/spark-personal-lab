"use strict";
// Direct HTTP adapters. Protocol references are listed in README.md.
const fs = require("node:fs"),
  path = require("node:path");
const { fail } = require("./store.cjs");
const PROVIDERS = ["openai", "anthropic", "gemini", "local"];
const DEFAULTS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  local: "http://127.0.0.1:11434/v1",
};
const ROLES = {
  explorer:
    "Explore useful possibilities and surprising angles. Be concrete and distinguish assumptions from facts.",
  investigator:
    "Investigate the problem, people, existing evidence and unknowns. Do not invent research or claim you searched the web.",
  skeptic:
    "Challenge assumptions. Identify risks, weak evidence and reasons this might fail. Suggest a test that could disprove it.",
  builder:
    "Focus on feasible implementation, scope and the smallest useful prototype.",
  business:
    "Examine customers, willingness to pay, distribution and alternatives. Treat business claims as hypotheses.",
  moderator:
    "Synthesize agreements and disagreements. Preserve uncertainty. End with a small prioritized action and open questions.",
};
function localEndpoint(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    fail("Enter a valid local HTTP endpoint.");
  }
  if (
    !["http:", "https:"].includes(u.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    fail(
      "Local endpoint must use localhost, 127.0.0.1, or ::1 without credentials, query, or fragment.",
    );
  return u.href.replace(/\/$/, "");
}
function providerManager(directory, options = {}) {
  const file = path.join(directory, "secrets.json");
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT")
      throw Error(
        "Cannot read data/secrets.json. Fix the JSON before starting Spark.",
      );
  }
  function config(provider) {
    if (!PROVIDERS.includes(provider)) fail("Unsupported provider.");
    const env = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      gemini: "GEMINI_API_KEY",
      local: "LOCAL_API_KEY",
    }[provider];
    return {
      key: process.env[env] || saved[provider]?.key || "",
      base:
        options.testBases?.[provider] ||
        (provider === "local"
          ? localEndpoint(
              process.env.LOCAL_BASE_URL || saved.local?.base || DEFAULTS.local,
            )
          : DEFAULTS[provider]),
    };
  }
  function status() {
    return PROVIDERS.map((provider) => {
      const c = config(provider);
      return {
        provider,
        configured: provider === "local" || !!c.key,
        source: process.env[
          {
            openai: "OPENAI_API_KEY",
            anthropic: "ANTHROPIC_API_KEY",
            gemini: "GEMINI_API_KEY",
            local: "LOCAL_API_KEY",
          }[provider]
        ]
          ? "environment"
          : saved[provider]?.key
            ? "local secrets file"
            : "none",
        base: c.base,
      };
    });
  }
  function update(data) {
    if (!PROVIDERS.includes(data?.provider)) fail("Unsupported provider.");
    const p = data.provider,
      next = { ...saved, [p]: { ...saved[p] } };
    if (data.key !== undefined) {
      if (typeof data.key !== "string" || data.key.length > 1000)
        fail("Invalid API key.");
      next[p].key = data.key.trim();
    }
    if (p === "local" && data.base !== undefined)
      next[p].base = localEndpoint(data.base);
    const temporary = file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
    saved = next;
    return status();
  }
  function headers(p, c) {
    return {
      "Content-Type": "application/json",
      ...(p === "anthropic"
        ? { "x-api-key": c.key, "anthropic-version": "2023-06-01" }
        : p === "gemini"
          ? { "x-goog-api-key": c.key }
          : c.key
            ? { Authorization: `Bearer ${c.key}` }
            : {}),
    };
  }
  async function upstream(p, url, init = {}) {
    const c = config(p);
    if (p !== "local" && !c.key)
      fail(`${p}: API key required. Open Settings.`, 400);
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: headers(p, c),
        redirect: "error",
      });
    } catch (e) {
      if (init.signal?.aborted) throw e;
      fail(`${p}: cannot connect to provider. Check its settings and that the server is running.`, 502);
    }
    if (!res.ok) {
      await res.body?.cancel();
      fail(
        `${p}: provider returned HTTP ${res.status}. Check model ID, credentials, quota, and provider availability.`,
        502,
      );
    }
    return res;
  }
  async function models(p) {
    const c = config(p),
      res = await upstream(p, c.base + "/models", {
        signal: AbortSignal.timeout(20000),
      }),
      j = await res.json();
    const entries = p === "gemini" ? j.models : j.data;
    return (entries || [])
      .map((x) => ({
        id: (x.id || x.name || "").replace(/^models\//, ""),
        label: x.display_name || x.displayName || x.id || x.name,
      }))
      .filter((x) => x.id)
      .slice(0, 1000);
  }
  async function generate(agent, messages, signal, onDelta) {
    const p = agent.provider,
      c = config(p);
    if (!agent.model.trim()) fail(`${agent.name}: enter a model ID.`);
    let url, body;
    const system = messages
        .filter((x) => x.role === "system")
        .map((x) => x.content)
        .join("\n\n"),
      chat = messages.filter((x) => x.role !== "system");
    if (p === "openai") {
      url = c.base + "/responses";
      body = {
        model: agent.model,
        instructions: system,
        input: chat.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        store: false,
        max_output_tokens: 4096,
      };
    } else if (p === "anthropic") {
      url = c.base + "/messages";
      body = {
        model: agent.model,
        system,
        messages: chat,
        max_tokens: 4096,
        stream: true,
      };
    } else if (p === "gemini") {
      url =
        c.base +
        "/models/" +
        encodeURIComponent(agent.model.replace(/^models\//, "")) +
        ":streamGenerateContent?alt=sse";
      body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: chat.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 4096 },
      };
    } else {
      url = c.base + "/chat/completions";
      body = {
        model: agent.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 4096,
      };
    }
    const res = await upstream(p, url, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    });
    let usage = null,
      output = "",
      buffer = "",
      event = "",
      finished = false;
    const consume = (obj) => {
      let delta = "";
      if (p === "openai") {
        if (obj.type === "response.output_text.delta") delta = obj.delta || "";
        if (obj.type === "response.completed") {
          finished = true;
          const u = obj.response?.usage;
          if (u)
            usage = {
              input: u.input_tokens || 0,
              output: u.output_tokens || 0,
            };
        }
        if (
          [
            "error",
            "response.failed",
            "response.incomplete",
            "response.refusal.delta",
          ].includes(obj.type)
        )
          throw Error(
            `${p}: generation failed. Check provider settings and retry.`,
          );
      } else if (p === "anthropic") {
        if (obj.type === "message_stop") finished = true;
        if (
          obj.type === "message_delta" &&
          obj.delta?.stop_reason === "max_tokens"
        )
          throw Error(
            "anthropic: output limit reached; partial response preserved.",
          );
        if (
          obj.type === "content_block_delta" &&
          obj.delta?.type === "text_delta"
        )
          delta = obj.delta.text || "";
        if (obj.message?.usage)
          usage = {
            input: obj.message.usage.input_tokens || 0,
            output: obj.message.usage.output_tokens || 0,
          };
        if (obj.usage)
          usage = {
            input: usage?.input || 0,
            output: obj.usage.output_tokens || 0,
          };
        if (obj.type === "error")
          throw Error(
            `${p}: generation failed. Retry or check provider limits.`,
          );
      } else if (p === "gemini") {
        if (obj.candidates?.[0]?.finishReason) {
          if (obj.candidates[0].finishReason !== "STOP")
            throw Error(
              "gemini: generation stopped before a normal completion.",
            );
          finished = true;
        }
        delta = (obj.candidates?.[0]?.content?.parts || [])
          .filter((x) => !x.thought)
          .map((x) => x.text || "")
          .join("");
        if (obj.usageMetadata)
          usage = {
            input: obj.usageMetadata.promptTokenCount || 0,
            output: obj.usageMetadata.candidatesTokenCount || 0,
          };
        if (obj.error) throw Error("gemini: generation failed.");
      } else {
        if (obj.choices?.[0]?.finish_reason) {
          if (obj.choices[0].finish_reason !== "stop")
            throw Error(
              "local: generation stopped before a normal completion.",
            );
          finished = true;
        }
        delta = obj.choices?.[0]?.delta?.content || "";
        if (obj.usage)
          usage = {
            input: obj.usage.prompt_tokens || 0,
            output: obj.usage.completion_tokens || 0,
          };
        if (obj.error) throw Error("local: generation failed.");
      }
      if (delta) {
        output += delta;
        if (output.length > 500000)
          throw Error("Provider response exceeded the size limit.");
        onDelta(delta);
      }
    };
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      if (signal.aborted) throw signal.reason;
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > 2000000)
        throw Error("Provider stream event exceeded size limit.");
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at).replace(/\r$/, "");
        buffer = buffer.slice(at + 1);
        if (line.startsWith("data:")) event += line.slice(5).trimStart() + "\n";
        else if (!line && event) {
          const payload = event.trim();
          event = "";
          if (payload === "[DONE]") finished = true;
          if (payload !== "[DONE]") {
            let obj;
            try {
              obj = JSON.parse(payload);
            } catch {
              throw Error(`${p}: malformed provider stream.`);
            }
            consume(obj);
          }
        }
      }
    }
    if (event.trim() && event.trim() !== "[DONE]") consume(JSON.parse(event));
    if (!finished)
      throw Error(
        `${p}: stream ended before completion. Partial text is preserved.`,
      );
    if (!output.trim())
      throw Error(
        `${p}: provider returned no text. Model may require a different API or be blocked.`,
      );
    return { text: output, usage };
  }
  return { config, status, update, models, generate };
}
module.exports = { providerManager, ROLES, localEndpoint };
