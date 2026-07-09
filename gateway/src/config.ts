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
    // Verified live against the models endpoint 2026-07-08 (gpt-5.4 family)
    cheap: "gpt-5.4-mini",
    balanced: "gpt-5.4",
    premium: "gpt-5.4-pro",
  },
  gemini: {
    cheap: "gemini-2.0-flash",
    balanced: "gemini-2.0-flash",
    premium: "gemini-2.5-pro",
  },
  zai: {
    // Single verified model (docs.z.ai, 2026-07-08); GLM-5.2 spans tiers —
    // near-frontier SWE quality at cheap-tier pricing is its whole pitch.
    cheap: "glm-5.2",
    balanced: "glm-5.2",
    premium: "glm-5.2",
  },
  ollama: {
    // Local model — whatever is pulled locally; override via OLLAMA_MODEL.
    cheap: process.env.OLLAMA_MODEL ?? "qwen3:8b",
    balanced: process.env.OLLAMA_MODEL ?? "qwen3:8b",
    premium: process.env.OLLAMA_MODEL ?? "qwen3:8b",
  },
};

/** USD per 1M tokens: [input, output]. null = unknown, cost reported as null. */
export const PRICING: Record<string, [number, number]> = {
  // Anthropic — verified
  "claude-haiku-4-5": [1.0, 5.0],
  "claude-sonnet-5": [3.0, 15.0],
  "claude-opus-4-8": [5.0, 25.0],
  // OpenAI — gpt-5.4 pricing not yet verified; absent entries report cost null
  // rather than a guessed number. Add [in, out] per MTok once confirmed.
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10.0],
  // Gemini — approximate, verify
  "gemini-2.0-flash": [0.1, 0.4],
  "gemini-2.5-pro": [1.25, 10.0],
  // Z.ai — first-party pricing, verified 2026-07-08 (web)
  "glm-5.2": [1.4, 4.4],
};

/**
 * Provider preference order per tier when more than one provider has a key.
 * Rule of thumb: cheap → fastest/cheapest first; premium → strongest first.
 */
export const TIER_PROVIDER_ORDER: Record<Tier, ProviderName[]> = {
  // Ollama sits last everywhere: local 8B-class models are the fallback when
  // no cloud key exists (or the explicit choice via ollama/<model>), not the
  // default. The learning loop may promote it per-intent later.
  cheap: ["anthropic", "gemini", "zai", "openai", "ollama"],
  // GLM-5.2 slots second for balanced: near-frontier SWE benchmark scores at
  // ~1/3 the cost of sonnet-tier — exactly the tradeoff this tier optimizes.
  balanced: ["anthropic", "zai", "openai", "gemini", "ollama"],
  premium: ["anthropic", "openai", "zai", "gemini", "ollama"],
};

export const DEFAULT_MAX_TOKENS = 4096;

export const PORT = Number(process.env.COMPASS_PORT ?? "") || 4000;

export function costUSD(
  model: string,
  inputTokens: number,
  outputTokens: number,
  provider?: string,
): number | null {
  if (provider === "ollama") return 0; // local inference is free
  const p = PRICING[model];
  if (!p) return null;
  const [inPerM, outPerM] = p;
  return (inputTokens * inPerM + outputTokens * outPerM) / 1_000_000;
}

/** Rough token estimate for size-based rules (chars/4 heuristic). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
