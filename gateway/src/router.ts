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
import type { ChatCompletionRequest, Intent, RoutingDecision } from "./types.ts";

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

interface Candidate {
  provider: string;
  model: string;
}

export interface RouterEnv {
  /** Names of configured providers (built-in names or custom ids). */
  availableProviders: string[];
  /** Ids of user-added custom providers, for passthrough matching. */
  customProviderIds?: string[];
  /** Custom providers assigned to a tier, for auto-routing + failover. */
  customTiers?: Array<{ provider: string; tier: Tier; model: string }>;
}

export interface RouterContext {
  git?: GitContext | null;
  /** User preference sliders — omitted/neutral values leave rules unchanged. */
  prefs?: Preferences | null;
  /**
   * Observed average latency per provider (ms), mined from the routing log.
   * Used only under a strong speed preference.
   */
  avgLatencyMs?: Partial<Record<string, number>>;
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
  const passthrough = matchPassthrough(req.model, env.customProviderIds ?? []);
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

  // ── Candidate list ───────────────────────────────────────────────
  // Custom providers assigned to this tier come first (an explicit choice to
  // use them), then the built-ins. Each candidate carries its concrete model.
  const customForTier = (env.customTiers ?? [])
    .filter((c) => c.tier === tier)
    .map((c) => ({ provider: c.provider, model: c.model }));
  let candidates: Candidate[] = [
    ...customForTier,
    ...TIER_PROVIDER_ORDER[tier].map((p) => ({ provider: p as string, model: TIER_MODELS[p][tier] })),
  ];
  if (customForTier.length) {
    reason.push(
      `Custom provider(s) for tier "${tier}": ${customForTier.map((c) => `${c.provider}/${c.model}`).join(", ")}`,
    );
  }

  if (prefs) {
    // Cloud ↔ Local reshapes the candidate order.
    if (prefs.cloud_local >= STRONG_RIGHT && env.availableProviders.includes("ollama")) {
      candidates = [
        ...candidates.filter((c) => c.provider === "ollama"),
        ...candidates.filter((c) => c.provider !== "ollama"),
      ];
      reason.push(`Preference: local over cloud (${prefs.cloud_local}) — Ollama promoted to first choice`);
    } else if (prefs.cloud_local <= STRONG_LEFT) {
      const withoutLocal = candidates.filter((c) => c.provider !== "ollama");
      if (withoutLocal.some((c) => env.availableProviders.includes(c.provider))) {
        candidates = withoutLocal;
        reason.push(`Preference: cloud over local (${prefs.cloud_local}) — local excluded from auto-routing`);
      }
    }

    // Strong speed preference: reorder by observed latency when we have data.
    if (prefs.speed_accuracy <= STRONG_LEFT && ctx.avgLatencyMs) {
      const lat = ctx.avgLatencyMs;
      const known = candidates.filter(
        (c) => lat[c.provider] !== undefined && env.availableProviders.includes(c.provider),
      );
      if (known.length >= 2) {
        known.sort((a, b) => (lat[a.provider] ?? Infinity) - (lat[b.provider] ?? Infinity));
        const knownSet = new Set(known);
        candidates = [...known, ...candidates.filter((c) => !knownSet.has(c))];
        reason.push(
          `Speed preference: providers reordered by observed latency (${known
            .map((c) => `${c.provider} ${Math.round(lat[c.provider] ?? 0)}ms`)
            .join(", ")})`,
        );
      }
    }
  }

  // Available candidates, in order. First is the pick; the rest are failover.
  const available = candidates.filter((c) => env.availableProviders.includes(c.provider));
  const chosen = available[0] ?? candidates[0]!;
  const alternates = available.slice(1);
  reason.push(availabilityNote(chosen.provider, env));
  reason.push(`Provider "${chosen.provider}" tier "${tier}" → ${chosen.model}`);
  if (alternates.length) {
    reason.push(`Failover order: ${alternates.map((a) => `${a.provider}/${a.model}`).join(" → ")}`);
  }

  return {
    intent,
    intent_source: intentSource,
    provider: chosen.provider,
    model: chosen.model,
    rule: `intent-tier:${intent}→${tier}`,
    tier,
    reason,
    estimated_input_tokens: estTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(alternates.length ? { alternates } : {}),
  };
}

function matchPassthrough(
  model: string,
  customIds: string[],
): { provider: string; model: string } | null {
  if (/^claude-/i.test(model)) return { provider: "anthropic", model };
  if (/^(gpt-|o[0-9])/i.test(model)) return { provider: "openai", model };
  if (/^gemini-/i.test(model)) return { provider: "gemini", model };
  // "<provider>/<model>" — ollama or any custom provider id
  const slash = /^([a-z0-9-]+)\/(.+)$/i.exec(model);
  if (slash) {
    const id = slash[1]!.toLowerCase();
    if (id === "ollama" || customIds.includes(id)) return { provider: id, model: slash[2]! };
  }
  return null;
}

function availabilityNote(provider: string, env: RouterEnv): string {
  return env.availableProviders.includes(provider)
    ? `Provider "${provider}" is configured and available`
    : `⚠ Provider "${provider}" is NOT configured — execution will fail until it is`;
}

export function resolveMaxTokens(req: ChatCompletionRequest): number {
  return req.max_completion_tokens ?? req.max_tokens ?? DEFAULT_MAX_TOKENS;
}
