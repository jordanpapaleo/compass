import { describe, expect, it } from "vitest";
import { analyze } from "./learning.ts";
import { route } from "./router.ts";
import type { RoutingLogEntry } from "./types.ts";

const base: RoutingLogEntry = {
  id: "x",
  ts: "2026-07-08T12:00:00Z",
  intent: "chat",
  intent_source: "detected",
  provider: "openai",
  model: "gpt-5.4-mini",
  rule: "intent-tier:chat→cheap",
  reason: [],
  status: "ok",
  latency_ms: 1000,
  input_tokens: 100,
  output_tokens: 100,
  cost_usd: 0.001,
  stream: false,
};

const entry = (over: Partial<RoutingLogEntry>): RoutingLogEntry => ({ ...base, ...over });

describe("learning: provider-failing", () => {
  it("fires when a provider fails >=80% of >=3 attempts", () => {
    const entries = [
      entry({ status: "error", error: "429 quota" }),
      entry({ status: "error", error: "429 quota" }),
      entry({ status: "error", error: "429 quota" }),
    ];
    const insights = analyze(entries);
    expect(insights.some((i) => i.kind === "provider-failing" && i.title.includes("openai"))).toBe(true);
  });

  it("does not fire on healthy providers", () => {
    const entries = [entry({}), entry({}), entry({ status: "error", error: "blip" })];
    expect(analyze(entries).some((i) => i.kind === "provider-failing")).toBe(false);
  });
});

describe("learning: explicit-model-pattern", () => {
  const manualOllama = entry({
    intent: "chat",
    intent_source: "passthrough",
    provider: "ollama",
    model: "qwen3:8b",
    cost_usd: 0,
  });

  it("suggests an override after 3 dominant manual picks", () => {
    const insights = analyze([manualOllama, manualOllama, manualOllama]);
    const hit = insights.find((i) => i.kind === "explicit-model-pattern");
    expect(hit).toBeDefined();
    expect(hit?.action).toEqual({
      type: "override",
      intent: "chat",
      provider: "ollama",
      model: "qwen3:8b",
    });
  });

  it("stays quiet below 3 samples or when already overridden", () => {
    expect(
      analyze([manualOllama, manualOllama]).some((i) => i.kind === "explicit-model-pattern"),
    ).toBe(false);
    expect(
      analyze([manualOllama, manualOllama, manualOllama], { chat: { provider: "ollama" } }).some(
        (i) => i.kind === "explicit-model-pattern",
      ),
    ).toBe(false);
  });
});

describe("learning: cost-optimization", () => {
  it("computes projected savings from real token counts", () => {
    // summarization served by opus ($5/$25) — haiku ($1/$5) would save ~80%
    const pricey = entry({
      intent: "summarization",
      provider: "anthropic",
      model: "claude-opus-4-8",
      input_tokens: 10_000,
      output_tokens: 2_000,
      cost_usd: 0.1,
    });
    const insights = analyze([pricey, pricey, pricey]);
    const hit = insights.find((i) => i.kind === "cost-optimization");
    expect(hit).toBeDefined();
    expect(hit?.title).toMatch(/saves ~\d+%/);
    expect(hit?.action?.intent).toBe("summarization");
  });
});

describe("learning: latency-gap", () => {
  it("flags a 2x+ gap with enough samples", () => {
    const slow = entry({ provider: "ollama", model: "qwen3:8b", latency_ms: 15000, cost_usd: 0 });
    const fast = entry({ provider: "zai", model: "glm-5.2", latency_ms: 900 });
    const insights = analyze([slow, slow, slow, fast, fast, fast]);
    expect(insights.some((i) => i.kind === "latency-gap")).toBe(true);
  });
});

describe("router: learned overrides", () => {
  const env = { availableProviders: ["anthropic", "openai", "ollama"] as const };

  it("applies an override for detected intent", () => {
    const d = route(
      { model: "compass/auto", messages: [{ role: "user", content: "hello there" }] },
      { availableProviders: [...env.availableProviders] },
      {
        overrides: {
          chat: { provider: "ollama", model: "qwen3:8b", source: "learned", applied_at: "2026-07-08T00:00:00Z" },
        },
      },
    );
    expect(d.rule).toBe("learned-override:chat");
    expect(d.provider).toBe("ollama");
    expect(d.model).toBe("qwen3:8b");
    expect(d.reason.join(" ")).toMatch(/Learned override/);
  });

  it("falls back to rules when override provider is unavailable", () => {
    const d = route(
      { model: "compass/auto", messages: [{ role: "user", content: "hello there" }] },
      { availableProviders: ["anthropic"] },
      {
        overrides: {
          chat: { provider: "ollama", model: "qwen3:8b", source: "learned", applied_at: "2026-07-08T00:00:00Z" },
        },
      },
    );
    expect(d.provider).toBe("anthropic");
    expect(d.reason.join(" ")).toMatch(/not configured — falling back/);
  });

  it("never applies overrides to passthrough requests", () => {
    const d = route(
      { model: "claude-opus-4-8", messages: [{ role: "user", content: "hello there" }] },
      { availableProviders: [...env.availableProviders] },
      {
        overrides: {
          chat: { provider: "ollama", model: "qwen3:8b", source: "learned", applied_at: "2026-07-08T00:00:00Z" },
        },
      },
    );
    expect(d.provider).toBe("anthropic");
    expect(d.model).toBe("claude-opus-4-8");
  });
});
