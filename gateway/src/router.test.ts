import { describe, expect, it } from "vitest";
import { costUSD, estimateTokens } from "./config.ts";
import { detectIntent } from "./intent.ts";
import { route } from "./router.ts";
import type { ChatCompletionRequest, ChatMessage } from "./types.ts";

const user = (content: string): ChatMessage => ({ role: "user", content });

const req = (model: string, messages: ChatMessage[]): ChatCompletionRequest => ({
  model,
  messages,
});

const ALL = { availableProviders: ["anthropic", "openai", "gemini"] as const };
const env = { availableProviders: [...ALL.availableProviders] };

describe("intent detection", () => {
  it.each([
    ["Review this PR please", "pr-review"],
    ["Write a PR description for these changes", "pr-description"],
    ["Write a commit message for this diff", "commit-message"],
    ["Why does this test fail with TypeError: x is not a function", "debugging"],
    ["Summarize this document, key points only", "summarization"],
    ["Design the system architecture for our event pipeline", "architecture"],
    ["Implement a function that parses YAML", "coding"],
    ["Brainstorm ideas for onboarding flows", "brainstorming"],
    ["hello there", "chat"],
  ])("%s → %s", (text, expected) => {
    expect(detectIntent([user(text)]).intent).toBe(expected);
  });

  it("weighs the last user message over earlier ones", () => {
    const messages: ChatMessage[] = [
      user("Implement a function to sort a list"),
      { role: "assistant", content: "done" },
      user("Now summarize what you did, key points"),
    ];
    expect(detectIntent(messages).intent).toBe("summarization");
  });

  it("scores zero for unmatched input and reports it", () => {
    const r = detectIntent([user("good morning")]);
    expect(r.intent).toBe("chat");
    expect(r.score).toBe(0);
  });
});

describe("routing rules", () => {
  it("passthrough: concrete claude model → anthropic verbatim", () => {
    const d = route(req("claude-haiku-4-5", [user("hi")]), env);
    expect(d.rule).toBe("passthrough");
    expect(d.provider).toBe("anthropic");
    expect(d.model).toBe("claude-haiku-4-5");
  });

  it("passthrough: gpt-* → openai, gemini-* → gemini", () => {
    expect(route(req("gpt-4o", [user("hi")]), env).provider).toBe("openai");
    expect(route(req("gemini-2.0-flash", [user("hi")]), env).provider).toBe("gemini");
  });

  it("explicit intent via compass/<intent>", () => {
    const d = route(req("compass/commit-message", [user("anything at all")]), env);
    expect(d.intent).toBe("commit-message");
    expect(d.intent_source).toBe("explicit");
    expect(d.model).toBe("claude-haiku-4-5"); // cheap tier, anthropic preferred
  });

  it("compass/auto detects intent and maps tier", () => {
    const d = route(req("compass/auto", [user("Design the architecture for a queue system")]), env);
    expect(d.intent).toBe("architecture");
    expect(d.model).toBe("claude-opus-4-8"); // premium tier
    expect(d.intent_source).toBe("detected");
  });

  it("size escalation bumps cheap → balanced on large input", () => {
    const big = "x".repeat(60_000); // ~15k tokens > 12k threshold
    const d = route(req("compass/summarization", [user(`Summarize this: ${big}`)]), env);
    expect(d.intent).toBe("summarization");
    expect(d.model).toBe("claude-sonnet-5"); // balanced, not haiku
    expect(d.reason.join(" ")).toMatch(/escalated/i);
  });

  it("falls to next provider in tier order when preferred has no key", () => {
    const d = route(req("compass/coding", [user("implement a function")]), {
      availableProviders: ["openai"],
    });
    expect(d.provider).toBe("openai");
    expect(d.model).toBe("gpt-5.4"); // balanced tier (live-verified id)
  });

  it("still decides (flagged) when no provider has a key", () => {
    const d = route(req("compass/coding", [user("implement a function")]), {
      availableProviders: [],
    });
    expect(d.provider).toBe("anthropic"); // preference order fallback
    expect(d.reason.join(" ")).toMatch(/NOT configured/);
  });

  it("every decision carries a non-empty reason trail", () => {
    const d = route(req("compass/auto", [user("review this pull request diff")]), env);
    expect(d.reason.length).toBeGreaterThanOrEqual(3);
    expect(d.rule).toMatch(/^intent-tier:pr-review/);
  });
});

describe("pricing", () => {
  it("computes anthropic costs from the verified table", () => {
    // haiku: $1 in / $5 out per MTok
    expect(costUSD("claude-haiku-4-5", 1_000_000, 1_000_000)).toBeCloseTo(6.0);
    expect(costUSD("claude-opus-4-8", 10_000, 2_000)).toBeCloseTo(0.1);
  });

  it("returns null for unknown models rather than guessing", () => {
    expect(costUSD("some-unknown-model", 1000, 1000)).toBeNull();
  });

  it("estimates tokens at ~chars/4", () => {
    expect(estimateTokens("x".repeat(4000))).toBe(1000);
  });
});

describe("git context (Day 2)", () => {
  const bigDiff = {
    branch: "feature/routing",
    dirty: true,
    changed_files: 12,
    insertions: 700,
    deletions: 300,
  };

  it("adds repo facts to the reason trail", () => {
    const d = route(req("compass/commit-message", [user("write a commit message")]), env, {
      git: { branch: "main", dirty: false, changed_files: 0, insertions: 0, deletions: 0 },
    });
    expect(d.reason.join(" ")).toMatch(/branch "main"/);
  });

  it("escalates VCS intents on large working diffs", () => {
    const d = route(req("compass/pr-description", [user("write a PR description")]), env, {
      git: bigDiff,
    });
    expect(d.model).toBe("claude-sonnet-5"); // balanced, escalated from cheap
    expect(d.reason.join(" ")).toMatch(/diff 1000 lines exceeds 800/);
  });

  it("does NOT escalate non-VCS intents on large diffs", () => {
    const d = route(req("compass/summarization", [user("summarize this doc")]), env, {
      git: bigDiff,
    });
    expect(d.model).toBe("claude-haiku-4-5"); // stays cheap
  });
});

describe("custom providers", () => {
  it("passthrough: <customId>/<model> routes to the custom provider", () => {
    const d = route(req("groq/llama-3.3-70b", [user("hi")]), {
      availableProviders: ["groq"],
      customProviderIds: ["groq"],
    });
    expect(d.rule).toBe("passthrough");
    expect(d.provider).toBe("groq");
    expect(d.model).toBe("llama-3.3-70b");
  });

  it("unknown provider id is NOT treated as passthrough", () => {
    // no customProviderIds → "foo/bar" falls through to intent routing
    const d = route(req("foo/bar", [user("implement a function")]), {
      availableProviders: ["anthropic"],
    });
    expect(d.rule).not.toBe("passthrough");
  });

  it("ollama passthrough still works without being a custom id", () => {
    const d = route(req("ollama/qwen3:8b", [user("hi")]), {
      availableProviders: ["ollama"],
    });
    expect(d.provider).toBe("ollama");
    expect(d.model).toBe("qwen3:8b");
  });
});

describe("ollama / local provider", () => {
  it("passthrough: ollama/<model> strips prefix and routes local", () => {
    const d = route(req("ollama/qwen3:8b", [user("hi")]), {
      availableProviders: ["ollama"],
    });
    expect(d.provider).toBe("ollama");
    expect(d.model).toBe("qwen3:8b");
    expect(d.rule).toBe("passthrough");
  });

  it("local-only setup: tiers fall through to ollama", () => {
    const d = route(req("compass/coding", [user("implement a function")]), {
      availableProviders: ["ollama"],
    });
    expect(d.provider).toBe("ollama");
  });

  it("local inference costs zero, not null", () => {
    expect(costUSD("qwen3:8b", 5000, 1000, "ollama")).toBe(0);
  });
});

describe("preferences (Day 3)", () => {
  const neutral = {
    quality_cost: 50,
    speed_accuracy: 50,
    deterministic_creative: 50,
    cloud_local: 50,
  };
  const allProviders = {
    availableProviders: ["anthropic", "openai", "gemini", "ollama"] as const,
  };
  const envAll = { availableProviders: [...allProviders.availableProviders] };

  it("neutral sliders change nothing", () => {
    const d = route(req("compass/coding", [user("implement a parser")]), envAll, {
      prefs: { ...neutral },
    });
    expect(d.model).toBe("claude-sonnet-5"); // balanced, unchanged
    expect(d.temperature).toBeUndefined();
  });

  it("strong cost preference drops a tier: coding balanced → cheap", () => {
    const d = route(req("compass/coding", [user("implement a parser")]), envAll, {
      prefs: { ...neutral, quality_cost: 90 },
    });
    expect(d.model).toBe("claude-haiku-4-5");
    expect(d.reason.join(" ")).toMatch(/cost over quality/);
  });

  it("strong quality preference raises a tier: coding balanced → premium", () => {
    const d = route(req("compass/coding", [user("implement a parser")]), envAll, {
      prefs: { ...neutral, quality_cost: 10 },
    });
    expect(d.model).toBe("claude-opus-4-8");
  });

  it("quality + accuracy both up clamps at premium", () => {
    const d = route(req("compass/architecture", [user("design the system architecture")]), envAll, {
      prefs: { ...neutral, quality_cost: 0, speed_accuracy: 100 },
    });
    expect(d.model).toBe("claude-opus-4-8");
    expect(d.reason.join(" ")).toMatch(/clamped/);
  });

  it("creative slider sets temperature when client sent none", () => {
    const d = route(req("compass/brainstorming", [user("brainstorm ideas for a logo")]), envAll, {
      prefs: { ...neutral, deterministic_creative: 90 },
    });
    expect(d.temperature).toBeCloseTo(0.9);
  });

  it("strong local preference promotes ollama over cloud", () => {
    const d = route(req("compass/coding", [user("implement a parser")]), envAll, {
      prefs: { ...neutral, cloud_local: 95 },
    });
    expect(d.provider).toBe("ollama");
    expect(d.reason.join(" ")).toMatch(/Ollama promoted/);
  });

  it("strong cloud preference excludes local from auto-routing", () => {
    const d = route(req("compass/chat", [user("hey")]), {
      availableProviders: ["ollama", "gemini"],
    }, {
      prefs: { ...neutral, cloud_local: 5 },
    });
    expect(d.provider).toBe("gemini");
  });

  it("strong speed preference reorders by observed latency", () => {
    const d = route(req("compass/coding", [user("implement a parser")]), envAll, {
      prefs: { ...neutral, speed_accuracy: 10 },
      avgLatencyMs: { anthropic: 4000, gemini: 900, openai: 2500 },
    });
    // speed also drops tier to cheap; fastest observed provider wins
    expect(d.provider).toBe("gemini");
    expect(d.reason.join(" ")).toMatch(/reordered by observed latency/);
  });

  it("passthrough ignores preferences entirely", () => {
    const d = route(req("claude-opus-4-8", [user("hi")]), envAll, {
      prefs: { ...neutral, quality_cost: 100, cloud_local: 100 },
    });
    expect(d.provider).toBe("anthropic");
    expect(d.model).toBe("claude-opus-4-8");
  });
});
