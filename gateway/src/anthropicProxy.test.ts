import { describe, expect, it } from "vitest";
import { anthropicToText, pickAnthropicModel } from "./anthropicProxy.ts";
import type { RoutingDecision } from "./types.ts";

const base: RoutingDecision = {
  intent: "coding",
  intent_source: "detected",
  provider: "openai",
  model: "gpt-5.4",
  rule: "intent-tier:coding→balanced",
  tier: "balanced",
  reason: [],
  estimated_input_tokens: 10,
};

describe("anthropicToText", () => {
  it("flattens string and block content, keeps system", () => {
    const msgs = anthropicToText("You are helpful", [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
      { role: "user", content: [{ type: "text", text: "write a commit message" }] },
    ]);
    expect(msgs[0]).toEqual({ role: "system", content: "You are helpful" });
    expect(msgs[3]).toEqual({ role: "user", content: "write a commit message" });
  });

  it("extracts text from tool_result blocks", () => {
    const msgs = anthropicToText(undefined, [
      { role: "user", content: [{ type: "tool_result", content: [{ type: "text", text: "42 tests passed" }] }] },
    ]);
    expect(msgs[0]?.content).toContain("42 tests passed");
  });

  it("never returns an empty array", () => {
    expect(anthropicToText(undefined, []).length).toBe(1);
  });
});

describe("pickAnthropicModel", () => {
  it("maps a non-anthropic tier pick to the Claude model for that tier", () => {
    expect(pickAnthropicModel(base)).toBe("claude-sonnet-5"); // balanced
    expect(pickAnthropicModel({ ...base, tier: "cheap" })).toBe("claude-haiku-4-5");
    expect(pickAnthropicModel({ ...base, tier: "premium" })).toBe("claude-opus-5");
  });

  it("honors an explicit Claude model (passthrough)", () => {
    expect(
      pickAnthropicModel({ ...base, provider: "anthropic", model: "claude-opus-4-8", rule: "passthrough" }),
    ).toBe("claude-opus-4-8");
  });

  it("defaults to balanced when tier is absent", () => {
    expect(pickAnthropicModel({ ...base, tier: undefined })).toBe("claude-sonnet-5");
  });
});
