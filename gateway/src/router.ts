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
import type { GitContext } from "./context/git.ts";
import { detectIntent, isIntent } from "./intent.ts";
import type { Overrides } from "./overrides.ts";
import { STRONG_LEFT, STRONG_RIGHT, type Preferences } from "./preferences.ts";
import type { ChatCompletionRequest, Intent, ProviderName, RoutingDecision } from "./types.ts";

const TIERS: Tier[] = ["cheap", "balanced", "premium"];

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

export interface RouterContext {
  git?: GitContext | null;
  /** User preference sliders — omitted/neutral values leave rules unchanged. */
  prefs?: Preferences | null;
  /**
   * Observed average latency per provider (ms), mined from the routing log.
   * Used only under a strong speed preference.
   */
  avgLatencyMs?: Partial<Record<ProviderName, number>>;
  /** Applied learning-loop overrides: intent → pinned provider/model. */
  overrides?: Overrides | null;
}

/** Working diffs above this size escalate VCS-related intents one tier. */
const LARGE_DIFF_LINES = 800;

/** Intents whose routing should consider repo state. */
const VCS_INTENTS: Intent[] = ["pr-review", "pr-description", "commit-message"];

export function route(
  req: ChatCompletionRequest,
  env: RouterEnv,
  ctx: RouterContext = {},
): RoutingDecision {
  const fullText = req.messages.map((m) => m.content).join("\n");
  const estTokens = estimateTokens(fullText);
  const reason: string[] = [];

  // ── Rule 1: concrete model passthrough ───────────────────────────
  const passthrough = matchPassthrough(req.model);
  if (passthrough) {
    // Intent is still detected (not used for routing) so the learning loop
    // can see "user manually picks model M for intent X" patterns.
    const detected = detectIntent(req.messages);
    reason.push(`Client requested concrete model "${req.model}" — passthrough`);
    if (detected.score > 0) reason.push(`(request looks like "${detected.intent}" — recorded for learning)`);
    reason.push(availabilityNote(passthrough.provider, env));
    return {
      intent: detected.intent,
      intent_source: "passthrough",
      provider: passthrough.provider,
      model: passthrough.model,
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

  // ── Learned overrides: applied suggestions short-circuit tiers ───
  const override = ctx.overrides?.[intent];
  if (override) {
    if (env.availableProviders.includes(override.provider)) {
      reason.push(
        `Learned override: "${intent}" pinned to ${override.provider}/${override.model} (applied ${override.applied_at.slice(0, 10)})`,
      );
      return {
        intent,
        intent_source: intentSource,
        provider: override.provider,
        model: override.model,
        rule: `learned-override:${intent}`,
        reason,
        estimated_input_tokens: estTokens,
      };
    }
    reason.push(
      `Learned override for "${intent}" targets ${override.provider} which is not configured — falling back to rules`,
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

  // ── Git context (Day 2): repo facts inform VCS-related intents ───
  const git = ctx.git;
  if (git) {
    reason.push(
      `Git: branch "${git.branch}", ${git.changed_files} files changed (+${git.insertions}/-${git.deletions})${git.dirty ? ", dirty" : ""}`,
    );
    const diffLines = git.insertions + git.deletions;
    if (VCS_INTENTS.includes(intent) && tier === "cheap" && diffLines > LARGE_DIFF_LINES) {
      tier = "balanced";
      reason.push(
        `Working diff ${diffLines} lines exceeds ${LARGE_DIFF_LINES} — escalated to "balanced" for quality`,
      );
    }
  }

  // ── Preferences (Day 3): sliders bias tier and provider order ────
  const prefs = ctx.prefs;
  let temperature: number | undefined;

  if (prefs) {
    // Quality ↔ Cost and Speed ↔ Accuracy shift the tier, clamped.
    let bias = 0;
    if (prefs.quality_cost <= STRONG_LEFT) {
      bias += 1;
      reason.push(`Preference: quality over cost (${prefs.quality_cost}) — tier +1`);
    } else if (prefs.quality_cost >= STRONG_RIGHT) {
      bias -= 1;
      reason.push(`Preference: cost over quality (${prefs.quality_cost}) — tier −1`);
    }
    if (prefs.speed_accuracy >= STRONG_RIGHT) {
      bias += 1;
      reason.push(`Preference: accuracy over speed (${prefs.speed_accuracy}) — tier +1`);
    } else if (prefs.speed_accuracy <= STRONG_LEFT) {
      bias -= 1;
      reason.push(`Preference: speed over accuracy (${prefs.speed_accuracy}) — tier −1`);
    }
    if (bias !== 0) {
      const idx = Math.min(2, Math.max(0, TIERS.indexOf(tier) + bias));
      const newTier = TIERS[idx]!;
      if (newTier !== tier) {
        reason.push(`Tier "${tier}" → "${newTier}" after preference bias`);
        tier = newTier;
      } else {
        reason.push(`Tier stays "${tier}" (bias clamped at range edge)`);
      }
    }

    // Deterministic ↔ Creative → temperature where the provider supports it.
    if (prefs.deterministic_creative !== 50 && req.temperature === undefined) {
      temperature = Math.round((prefs.deterministic_creative / 100) * 10) / 10;
      reason.push(
        `Preference: ${prefs.deterministic_creative < 50 ? "deterministic" : "creative"} (${prefs.deterministic_creative}) — temperature ${temperature} where supported`,
      );
    }
  }

  // ── Provider selection by availability ───────────────────────────
  let order = [...TIER_PROVIDER_ORDER[tier]];

  if (prefs) {
    // Cloud ↔ Local reshapes the candidate order.
    if (prefs.cloud_local >= STRONG_RIGHT && env.availableProviders.includes("ollama")) {
      order = ["ollama", ...order.filter((p) => p !== "ollama")];
      reason.push(`Preference: local over cloud (${prefs.cloud_local}) — Ollama promoted to first choice`);
    } else if (prefs.cloud_local <= STRONG_LEFT) {
      const withoutLocal = order.filter((p) => p !== "ollama");
      if (withoutLocal.some((p) => env.availableProviders.includes(p))) {
        order = withoutLocal;
        reason.push(`Preference: cloud over local (${prefs.cloud_local}) — local excluded from auto-routing`);
      }
    }

    // Strong speed preference: reorder by observed latency when we have data.
    if (prefs.speed_accuracy <= STRONG_LEFT && ctx.avgLatencyMs) {
      const lat = ctx.avgLatencyMs;
      const known = order.filter((p) => lat[p] !== undefined && env.availableProviders.includes(p));
      if (known.length >= 2) {
        known.sort((a, b) => (lat[a] ?? Infinity) - (lat[b] ?? Infinity));
        order = [...known, ...order.filter((p) => !known.includes(p))];
        reason.push(
          `Speed preference: providers reordered by observed latency (${known
            .map((p) => `${p} ${Math.round(lat[p]!)}ms`)
            .join(", ")})`,
        );
      }
    }
  }

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
    ...(temperature !== undefined ? { temperature } : {}),
  };
}

function matchPassthrough(model: string): { provider: ProviderName; model: string } | null {
  if (/^claude-/i.test(model)) return { provider: "anthropic", model };
  if (/^(gpt-|o[0-9])/i.test(model)) return { provider: "openai", model };
  if (/^gemini-/i.test(model)) return { provider: "gemini", model };
  if (/^glm-/i.test(model)) return { provider: "zai", model };
  // ollama/<anything> → local, model name passed through verbatim
  const local = /^ollama\/(.+)$/i.exec(model);
  if (local) return { provider: "ollama", model: local[1]! };
  return null;
}

function availabilityNote(provider: ProviderName, env: RouterEnv): string {
  return env.availableProviders.includes(provider)
    ? `Provider "${provider}" is configured and available`
    : `⚠ Provider "${provider}" is NOT configured — execution will fail until it is`;
}

export function resolveMaxTokens(req: ChatCompletionRequest): number {
  return req.max_completion_tokens ?? req.max_tokens ?? DEFAULT_MAX_TOKENS;
}
