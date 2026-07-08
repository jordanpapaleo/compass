/**
 * Central model + pricing configuration.
 *
 * Compass routes by TIER (cheap / balanced / premium), and each provider maps
 * a tier to a concrete model. Keeping this in one file means model churn is a
 * one-line edit, and the router never hardcodes a model name.
 *
 * ⚠️ Anthropic IDs and pricing are verified current (2026-06).
 * OpenAI / Gemini IDs and pricing are best-effort defaults — verify against
 * live `GET /v1/providers` once API keys are configured (the gateway exposes a
 * health probe for exactly this).
 */

import type { ProviderName } from "./types.ts";

export type Tier = "cheap" | "balanced" | "premium";

export const TIER_MODELS: Record<ProviderName, Record<Tier, string>> = {
  anthropic: {
    cheap: "claude-haiku-4-5",
    balanced: "claude-sonnet-5",
    premium: "claude-opus-4-8",
  },
  openai: {
    cheap: "gpt-4o-mini",
    balanced: "gpt-4o",
    premium: "gpt-4o", // update when a premium reasoning id is confirmed live
  },
  gemini: {
    cheap: "gemini-2.0-flash",
    balanced: "gemini-2.0-flash",
    premium: "gemini-2.5-pro",
  },
};

/** USD per 1M tokens: [input, output]. null = unknown, cost reported as null. */
export const PRICING: Record<string, [number, number]> = {
  // Anthropic — verified
  "claude-haiku-4-5": [1.0, 5.0],
  "claude-sonnet-5": [3.0, 15.0],
  "claude-opus-4-8": [5.0, 25.0],
  // OpenAI — approximate, verify
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10.0],
  // Gemini — approximate, verify
  "gemini-2.0-flash": [0.1, 0.4],
  "gemini-2.5-pro": [1.25, 10.0],
};

/**
 * Provider preference order per tier when more than one provider has a key.
 * Rule of thumb: cheap → fastest/cheapest first; premium → strongest first.
 */
export const TIER_PROVIDER_ORDER: Record<Tier, ProviderName[]> = {
  cheap: ["anthropic", "gemini", "openai"],
  balanced: ["anthropic", "openai", "gemini"],
  premium: ["anthropic", "openai", "gemini"],
};

export const DEFAULT_MAX_TOKENS = 4096;

export const PORT = Number(process.env.COMPASS_PORT ?? "") || 4000;

export function costUSD(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const p = PRICING[model];
  if (!p) return null;
  const [inPerM, outPerM] = p;
  return (inputTokens * inPerM + outputTokens * outPerM) / 1_000_000;
}

/** Rough token estimate for size-based rules (chars/4 heuristic). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
