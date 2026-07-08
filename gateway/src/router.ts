/**
 * Routing engine — Day 1 rule-based.
 *
 * Input:  the request (model selector + messages) and which providers have keys.
 * Output: a RoutingDecision — provider, concrete model, the rule that fired,
 *         and a human-readable reason trail (the seed of Compass explainability).
 *
 * Rules, in order:
 *   1. Passthrough  — concrete model id requested → honor it (mapped by prefix).
 *   2. Explicit     — "compass/<intent>" → route that intent by the tier table.
 *   3. Detected     — "compass/auto" (or unknown) → detect intent, route by tier.
 *   Size escalation — very large inputs bump cheap → balanced (quality floor).
 *   Availability    — within a tier, first provider (by preference order) that
 *                     has an API key wins; decision still made when NO key is
 *                     present (dry-run/preview works keyless) but is flagged.
 */

import { DEFAULT_MAX_TOKENS, TIER_MODELS, TIER_PROVIDER_ORDER, estimateTokens, type Tier } from "./config.ts";
import { detectIntent, isIntent } from "./intent.ts";
import type { ChatCompletionRequest, Intent, ProviderName, RoutingDecision } from "./types.ts";

/** Intent → tier. The heart of "route by outcome, not by model". */
export const INTENT_TIER: Record<Intent, Tier> = {
  "commit-message": "cheap",
  "pr-description": "cheap",
  summarization: "cheap",
  chat: "cheap",
  search: "cheap",
  documentation: "balanced",
  coding: "balanced",
  debugging: "balanced",
  "pr-review": "balanced",
  brainstorming: "balanced",
  planning: "premium",
  architecture: "premium",
};

/** Inputs above this size get bumped one tier up from `cheap`. */
const SIZE_ESCALATION_TOKENS = 12_000;

export interface RouterEnv {
  availableProviders: ProviderName[];
}

export function route(req: ChatCompletionRequest, env: RouterEnv): RoutingDecision {
  const fullText = req.messages.map((m) => m.content).join("\n");
  const estTokens = estimateTokens(fullText);
  const reason: string[] = [];

  // ── Rule 1: concrete model passthrough ───────────────────────────
  const passthrough = matchPassthrough(req.model);
  if (passthrough) {
    reason.push(`Client requested concrete model "${req.model}" — passthrough`);
    reason.push(availabilityNote(passthrough.provider, env));
    return {
      intent: "chat",
      intent_source: "passthrough",
      provider: passthrough.provider,
      model: req.model,
      rule: "passthrough",
      reason,
      estimated_input_tokens: estTokens,
    };
  }

  // ── Rule 2/3: compass/<intent> or compass/auto ───────────────────
  let intent: Intent;
  let intentSource: RoutingDecision["intent_source"];

  const compassMatch = req.model.match(/^compass\/(.+)$/i);
  if (compassMatch && compassMatch[1] !== "auto" && isIntent(compassMatch[1])) {
    intent = compassMatch[1];
    intentSource = "explicit";
    reason.push(`Intent "${intent}" explicitly requested via model selector`);
  } else {
    const detected = detectIntent(req.messages);
    intent = detected.intent;
    intentSource = "detected";
    reason.push(
      detected.score > 0
        ? `Intent detected as "${intent}" (signal score ${detected.score})`
        : `No intent signals matched — defaulting to "chat"`,
    );
  }

  // ── Tier selection + size escalation ─────────────────────────────
  let tier = INTENT_TIER[intent];
  reason.push(`Intent "${intent}" maps to tier "${tier}"`);

  if (tier === "cheap" && estTokens > SIZE_ESCALATION_TOKENS) {
    tier = "balanced";
    reason.push(
      `Input ~${estTokens} tokens exceeds ${SIZE_ESCALATION_TOKENS} — escalated to "balanced" for quality`,
    );
  } else {
    reason.push(`Input ~${estTokens} tokens`);
  }

  // ── Provider selection by availability ───────────────────────────
  const order = TIER_PROVIDER_ORDER[tier];
  const provider = order.find((p) => env.availableProviders.includes(p)) ?? order[0]!;
  reason.push(availabilityNote(provider, env));

  const model = TIER_MODELS[provider][tier];
  reason.push(`Provider "${provider}" tier "${tier}" → ${model}`);

  return {
    intent,
    intent_source: intentSource,
    provider,
    model,
    rule: `intent-tier:${intent}→${tier}`,
    reason,
    estimated_input_tokens: estTokens,
  };
}

function matchPassthrough(model: string): { provider: ProviderName } | null {
  if (/^claude-/i.test(model)) return { provider: "anthropic" };
  if (/^(gpt-|o[0-9])/i.test(model)) return { provider: "openai" };
  if (/^gemini-/i.test(model)) return { provider: "gemini" };
  return null;
}

function availabilityNote(provider: ProviderName, env: RouterEnv): string {
  return env.availableProviders.includes(provider)
    ? `Provider "${provider}" has an API key configured`
    : `⚠ Provider "${provider}" has NO API key — execution will fail until one is set`;
}

export function resolveMaxTokens(req: ChatCompletionRequest): number {
  return req.max_completion_tokens ?? req.max_tokens ?? DEFAULT_MAX_TOKENS;
}
