/**
 * Learning engine — Day 4.
 *
 * Mines the routing log (real history, nothing synthetic) for patterns and
 * turns them into suggestions. Some are informational; some carry an `apply`
 * action that installs an intent override — the observe → suggest → apply
 * loop that makes Compass adaptive.
 */

import { PRICING, TIER_MODELS } from "./config.ts";
import type { Intent, ProviderName, RoutingLogEntry } from "./types.ts";

export interface InsightAction {
  type: "override";
  intent: Intent;
  /** Built-in provider name or custom provider id. */
  provider: string;
  model: string;
}

export interface Insight {
  id: string;
  kind: "provider-failing" | "explicit-model-pattern" | "cost-optimization" | "latency-gap";
  severity: "info" | "suggestion" | "warning";
  title: string;
  detail: string;
  /** Present when the insight can be applied as a routing override. */
  action?: InsightAction;
  /** How much history supports this (for trust). */
  evidence: { samples: number; window: number };
}

const MIN_FAIL_ATTEMPTS = 3;
const FAIL_RATE_THRESHOLD = 0.8;
const MIN_PATTERN_COUNT = 3;
const MIN_LATENCY_SAMPLES = 3;
const MIN_SAVINGS_PCT = 30;

export function analyze(
  entries: RoutingLogEntry[],
  overrides: Partial<Record<Intent, unknown>> = {},
): Insight[] {
  const insights: Insight[] = [];
  const window = entries.length;

  // ── 1. Providers that keep failing ────────────────────────────────
  const byProvider = groupBy(entries, (e) => e.provider);
  for (const [provider, es] of byProvider) {
    if (es.length < MIN_FAIL_ATTEMPTS) continue;
    const errors = es.filter((e) => e.status === "error");
    const rate = errors.length / es.length;
    if (rate >= FAIL_RATE_THRESHOLD) {
      const lastError = errors[0]?.error ?? "";
      insights.push({
        id: `provider-failing:${provider}`,
        kind: "provider-failing",
        severity: "warning",
        title: `${provider} is failing ${errors.length}/${es.length} recent requests`,
        detail: lastError.slice(0, 140) || "Repeated errors — check the account/key.",
        evidence: { samples: es.length, window },
      });
    }
  }

  // ── 2. User repeatedly picks an explicit model for an intent ─────
  const passthroughs = entries.filter(
    (e) => e.intent_source === "passthrough" && e.status === "ok",
  );
  const byIntentModel = groupBy(passthroughs, (e) => `${e.intent}→${e.provider}/${e.model}`);
  for (const [key, es] of byIntentModel) {
    const first = es[0]!;
    if (es.length < MIN_PATTERN_COUNT) continue;
    if (overrides[first.intent]) continue; // already applied
    const total = passthroughs.filter((e) => e.intent === first.intent).length;
    const share = es.length / total;
    if (share < 0.7) continue; // pattern must dominate
    insights.push({
      id: `explicit-model-pattern:${key}`,
      kind: "explicit-model-pattern",
      severity: "suggestion",
      title: `You route "${first.intent}" to ${first.provider}/${first.model} yourself (${es.length}× , ${Math.round(share * 100)}%)`,
      detail: `Make it automatic: requests detected as "${first.intent}" would go straight to ${first.model}.`,
      action: {
        type: "override",
        intent: first.intent,
        provider: first.provider,
        model: first.model,
      },
      evidence: { samples: es.length, window },
    });
  }

  // ── 3. Cost: intents running on pricier models than needed ───────
  const okWithCost = entries.filter(
    (e) => e.status === "ok" && e.cost_usd !== null && e.cost_usd > 0 && e.input_tokens !== null,
  );
  const byIntent = groupBy(okWithCost, (e) => e.intent);
  for (const [intent, es] of byIntent) {
    if (es.length < MIN_PATTERN_COUNT) continue;
    if (overrides[intent as Intent]) continue;
    const spent = sum(es.map((e) => e.cost_usd ?? 0));
    // Cheapest known-priced cheap-tier model across providers.
    const cheapCandidates = (Object.entries(TIER_MODELS) as [ProviderName, Record<string, string>][])
      .map(([provider, tiers]) => ({ provider, model: tiers.cheap! }))
      .filter((c) => PRICING[c.model]);
    if (cheapCandidates.length === 0) continue;
    const projected = cheapCandidates
      .map((c) => ({
        ...c,
        cost: sum(
          es.map(
            (e) =>
              ((e.input_tokens ?? 0) * PRICING[c.model]![0] +
                (e.output_tokens ?? 0) * PRICING[c.model]![1]) /
              1_000_000,
          ),
        ),
      }))
      .sort((a, b) => a.cost - b.cost)[0]!;
    const savingsPct = spent > 0 ? Math.round(((spent - projected.cost) / spent) * 100) : 0;
    const alreadyCheapest = es.every((e) => e.model === projected.model);
    if (savingsPct >= MIN_SAVINGS_PCT && !alreadyCheapest) {
      insights.push({
        id: `cost-optimization:${intent}`,
        kind: "cost-optimization",
        severity: "suggestion",
        title: `Switching "${intent}" to ${projected.model} saves ~${savingsPct}%`,
        detail: `${es.length} requests cost $${spent.toFixed(4)}; projected $${projected.cost.toFixed(4)} on ${projected.provider}/${projected.model} at the same token counts.`,
        action: {
          type: "override",
          intent: intent as Intent,
          provider: projected.provider,
          model: projected.model,
        },
        evidence: { samples: es.length, window },
      });
    }
  }

  // ── 4. Latency gaps between providers ─────────────────────────────
  const okEntries = entries.filter((e) => e.status === "ok");
  const latByProvider = [...groupBy(okEntries, (e) => e.provider)]
    .map(([provider, es]) => ({
      provider,
      n: es.length,
      avg: sum(es.map((e) => e.latency_ms)) / es.length,
    }))
    .filter((p) => p.n >= MIN_LATENCY_SAMPLES)
    .sort((a, b) => a.avg - b.avg);
  if (latByProvider.length >= 2) {
    const fastest = latByProvider[0]!;
    const slowest = latByProvider[latByProvider.length - 1]!;
    if (slowest.avg >= fastest.avg * 2) {
      insights.push({
        id: `latency-gap:${slowest.provider}`,
        kind: "latency-gap",
        severity: "info",
        title: `${slowest.provider} averages ${Math.round(slowest.avg)}ms vs ${fastest.provider} at ${Math.round(fastest.avg)}ms`,
        detail: `Over ${slowest.n}/${fastest.n} successful requests. The Speed slider already exploits this.`,
        evidence: { samples: slowest.n + fastest.n, window },
      });
    }
  }

  const order = { warning: 0, suggestion: 1, info: 2 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return m;
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}
