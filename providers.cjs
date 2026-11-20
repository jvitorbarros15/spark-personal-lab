"use strict";
// Direct HTTP adapters. Protocol references are listed in README.md.
const path = require("node:path");
const { fail } = require("./store.cjs");
const { readJson, writeJson } = require("./json-file.cjs");
const { withDirective } = require("./lang.cjs");
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
  boardOffer:
    "Act as a board member reading this idea through the Offers lens, a summary of public offer-design frameworks. Score the market (pain, ability to pay, reachability, growth) and the four parts of the value equation: dream outcome, likelihood of success, time to result, effort asked of the buyer. Say whether the idea competes only on price and what would make saying no feel foolish: guarantee, bonuses, honest urgency. List the top 3 risks that would kill it, most dangerous first, then questions for the founder. Use only facts in the context; label everything else an assumption. End with exactly: Score: N/10 | Vote: FUND, FUND IF (give conditions) or PASS.",
  boardMonopoly:
    "Act as a board member reading this idea through the Monopoly lens, a summary of public startup-strategy frameworks. Ask: what small market can it dominate first, why now, what is the secret the founder knows that others do not, what makes it durable (proprietary know-how, network effects, scale, brand), and how the first 100 customers arrive and at what cost. Name what stops a copycat in month six. List the top 3 risks that would kill it, most dangerous first, then questions for the founder. Use only facts in the context; label everything else an assumption. End with exactly: Score: N/10 | Vote: FUND, FUND IF (give conditions) or PASS.",
  boardProduct:
    "Act as a board member reading this idea through the Product lens, a summary of public product-design principles. Describe the moment the customer uses it and work back to what must be true. Say what to cut so one thing is done brilliantly, where the experience has seams (first contact to follow-up), and whether the idea shows taste or is merely adequate. List the top 3 risks that would kill it, most dangerous first, then questions for the founder. Use only facts in the context; label everything else an assumption. End with exactly: Score: N/10 | Vote: FUND, FUND IF (give conditions) or PASS.",
  competitorScout:
    "Map the likely competitive landscape from your general knowledge and the context. You cannot browse, so every competitor you name must be followed by \"unconfirmed — check source\", and you must not state prices, ratings or reviews as facts; say what to look up and where. Group them as direct (same product, same buyer), indirect (different product, same job) and substitutes (what buyers do without a business). For each, give the likely positioning and the complaint buyers would plausibly have, marked as a hypothesis. Finish with the gap the idea could own, or say plainly that no gap is visible, plus who could copy it fastest.",
  cfo:
    "Act as a CFO. Work only from numbers present in the context (price, variable cost, fixed costs, hours per customer, available hours, currency). Never invent a figure. For each missing number, name it and say who or what can supply it. With what is present, state the contribution per sale, margin, break-even customers, capacity and profit at capacity, showing the arithmetic. Flag a price below variable cost or a break-even above capacity. Suggest what to check or test next, and say which questions cannot be answered yet.",
  launchLead:
    "Act as a launch lead. First propose the cheapest real-world test with a real price (waitlist, pre-sale, pop-up or paid pilots) and write its success line before it runs. Then give a dated countdown in weekly blocks with an owner and a deadline per task and mark the critical path, a launch-day run sheet, and the first 30 days: what to measure, the level that triggers a change, and reviews on days 7, 14 and 30. Use only facts in the context; ask for any target date or constraint you lack rather than inventing it. If the test fails, say which earlier step to revisit.",
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
  const languageOf = options.language;
  const file = path.join(directory, "secrets.json");
  let saved = readJson(file, `Cannot read ${file}. Fix the JSON before starting Spark.`);
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
        ...(provider === "local" ? { trusted: localTrusted(), marked: saved.local?.trusted === true } : {}),
      };
    });
  }
  function localTrusted() {
    if (saved.local?.trusted === true) return true;
    const u = new URL(config("local").base);
    return !!options.testBases?.local || (["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && u.port === "11434");
  }
  function update(data) {
    if (!PROVIDERS.includes(data?.provider) && data?.provider !== "openalex" && data?.provider !== "websearch")
      fail("Unsupported provider.");
    const p = data.provider,
      next = { ...saved, [p]: { ...saved[p] } };
    if (data.key !== undefined) {
      if (typeof data.key !== "string" || data.key.length > 1000)
        fail("Invalid API key.");
      next[p].key = data.key.trim();
    }
    if (p === "local" && data.base !== undefined)
      next[p].base = localEndpoint(data.base);
    if (p === "local" && data.trusted !== undefined) {
      if (typeof data.trusted !== "boolean") fail("Invalid local endpoint setting.");
      next[p].trusted = data.trusted;
    }
    persist(next);
    return p === "openalex" ? openAlexStatus() : p === "websearch" ? webSearchStatus() : status();
  }
  function persist(next) {
    writeJson(file, next, { mode: 0o600 });
    saved = next;
  }
  function groq() {
    const env = process.env.GROQ_API_KEY;
    return { key: env || saved.groq?.key || "", source: env ? "environment" : saved.groq?.key ? "local secrets file" : "none" };
  }
  function setGroqKey(key) {
    if (typeof key !== "string" || key.length > 1000) fail("Invalid API key.");
    persist({ ...saved, groq: { key: key.trim() } });
  }
  function openAlexKey() {
    return process.env.OPENALEX_API_KEY || saved.openalex?.key || "";
  }
  function openAlexStatus() {
    return {
      configured: !!openAlexKey(),
      source: process.env.OPENALEX_API_KEY
        ? "environment"
        : saved.openalex?.key
          ? "local secrets file"
          : "none",
    };
  }
  function webSearchKey() {
    return process.env.OLLAMA_API_KEY || saved.websearch?.key || "";
  }
  function webSearchStatus() {
    return { configured: !!webSearchKey(), source: process.env.OLLAMA_API_KEY ? "environment" : saved.websearch?.key ? "local secrets file" : "none" };
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
      throw Object.assign(
        new Error(`${p}: provider returned HTTP ${res.status}. Check model ID, credentials, quota, and provider availability.`),
        { status: 502, upstreamStatus: res.status },
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
  async function generate(agent, messages, signal, onDelta, options = {}) {
    if (languageOf) messages = withDirective(messages, languageOf(), options.sample);
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
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      };
    } else if (p === "anthropic") {
      url = c.base + "/messages";
      body = {
        model: agent.model,
        system,
        messages: chat,
        max_tokens: 4096,
        stream: true,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
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
        generationConfig: { maxOutputTokens: 4096, ...(options.temperature !== undefined ? { temperature: options.temperature } : {}) },
      };
    } else {
      url = c.base + "/chat/completions";
      body = {
        model: agent.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: options.maxTokens || 4096,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      };
    }
    let native = p === "local" && (!!options.schema || !!options.noThink),
      res;
    if (native)
      try {
        res = await upstream(p, c.base.replace(/\/v1$/, "") + "/api/chat", {
          method: "POST",
          body: JSON.stringify({
            model: agent.model,
            messages,
            stream: true,
            think: false,
            ...(options.schema ? { format: options.schema } : {}),
            options: { temperature: options.temperature ?? 0, num_ctx: options.numCtx || 8192, num_predict: options.maxTokens || 4096 },
          }),
          signal,
        });
      } catch (e) {
        if (signal?.aborted || ![400, 404, 405].includes(e.upstreamStatus)) throw e;
        native = false;
      }
    res ||= await upstream(p, url, {
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
      } else if (native) {
        if (obj.error) throw Error("local: generation failed.");
        if (obj.done) {
          if (obj.done_reason && obj.done_reason !== "stop") throw Error("local: generation stopped before a normal completion.");
          finished = true;
          usage = { input: obj.prompt_eval_count || 0, output: obj.eval_count || 0 };
        }
        delta = obj.message?.content || "";
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
        if (native) {
          if (line.trim()) consume(JSON.parse(line));
        } else if (line.startsWith("data:")) event += line.slice(5).trimStart() + "\n";
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
    if (native && buffer.trim()) consume(JSON.parse(buffer));
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
  return { config, status, localTrusted, update, models, generate, groq, setGroqKey, openAlexKey, openAlexStatus, webSearchKey, webSearchStatus };
}
module.exports = { providerManager, ROLES, localEndpoint };
