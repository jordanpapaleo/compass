/**
 * Anthropic Messages API (/v1/messages) support — the "Claude Code" endpoint.
 *
 * Claude Code and Anthropic-SDK clients speak Anthropic's protocol, not the
 * OpenAI one. This endpoint lets them route through Compass: it detects intent,
 * routes among Claude models by tier/preference, and proxies the request **raw**
 * to api.anthropic.com — so tools, thinking, and streaming keep full fidelity.
 *
 * Cross-protocol routing (Anthropic request → a non-Anthropic provider) would
 * require translating tool use and is out of scope; /v1/messages stays on Claude
 * models. The router still picks WHICH Claude model by intent + your sliders.
 */

import { TIER_MODELS } from "./config.ts";
import type { ChatMessage, RoutingDecision } from "./types.ts";

interface AnthropicTextBlock {
  type: string;
  text?: string;
  content?: unknown;
}

/** Extract plain text from an Anthropic content value (string or block array). */
function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      const block = b as AnthropicTextBlock;
      if (block.type === "text" && typeof block.text === "string") return block.text;
      // tool_result content can itself be a string or blocks
      if (block.type === "tool_result") return blockText(block.content);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Reduce an Anthropic request to Compass's simple {role, content} messages for
 * intent detection (system prompt included as a system message).
 */
export function anthropicToText(
  system: unknown,
  messages: Array<{ role: string; content: unknown }>,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  const sys = blockText(system);
  if (sys) out.push({ role: "system", content: sys });
  for (const m of messages) {
    const role = m.role === "assistant" ? "assistant" : "user";
    out.push({ role, content: blockText(m.content) });
  }
  // Never hand back an empty array — intent detection needs at least one turn.
  return out.length ? out : [{ role: "user", content: "" }];
}

/** Which Claude model to actually call, given a routing decision. */
export function pickAnthropicModel(decision: RoutingDecision): string {
  // Passthrough / override / tier pick that already landed on Anthropic: honor it.
  if (decision.provider === "anthropic" && /^claude-/i.test(decision.model)) return decision.model;
  // Intent-routed to a non-Anthropic provider: use the Claude model for that tier.
  return TIER_MODELS.anthropic[decision.tier ?? "balanced"];
}
