/**
 * Provider registry — built-in adapters plus user-added custom ones.
 *
 * Built-ins (anthropic, openai, gemini, ollama) have dedicated adapters.
 * Custom providers are OpenAI-compatible endpoints defined in config and
 * built into factory adapters on startup / on change — the "add whatever"
 * path, no release required.
 */

import { type CustomProvider, getCustomProviders } from "./providerConfig.ts";
import { anthropicAdapter } from "./providers/anthropic.ts";
import { geminiAdapter } from "./providers/gemini.ts";
import { createOpenAICompatAdapter } from "./providers/openai-compat.ts";
import { ollamaAdapter } from "./providers/ollama.ts";
import { openaiAdapter } from "./providers/openai.ts";
import type { ProviderAdapter } from "./types.ts";

const BUILTIN: Record<string, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
};

export const BUILTIN_NAMES = Object.keys(BUILTIN);

let custom: Record<string, ProviderAdapter> = {};
let customMeta: CustomProvider[] = [];

/** (Re)build custom adapters from config. Call at startup and after changes. */
export async function rebuildCustomAdapters(): Promise<void> {
  customMeta = await getCustomProviders();
  custom = {};
  for (const cp of customMeta) {
    custom[cp.id] = createOpenAICompatAdapter({
      name: cp.id,
      apiKey: cp.api_key,
      baseURL: cp.base_url,
    });
  }
}

export function getAdapter(id: string): ProviderAdapter | undefined {
  return BUILTIN[id] ?? custom[id];
}

export function isBuiltin(id: string): boolean {
  return id in BUILTIN;
}

export function customProviders(): CustomProvider[] {
  return customMeta;
}

export function customProviderIds(): string[] {
  return customMeta.map((c) => c.id);
}

/** Custom providers assigned to a tier — feeds compass/auto routing + failover. */
export function customTierAssignments(): Array<{
  provider: string;
  tier: "cheap" | "balanced" | "premium";
  model: string;
}> {
  const out: Array<{ provider: string; tier: "cheap" | "balanced" | "premium"; model: string }> = [];
  for (const c of customMeta) {
    if (!c.tiers) continue;
    for (const tier of ["cheap", "balanced", "premium"] as const) {
      const model = c.tiers[tier];
      if (model) out.push({ provider: c.id, tier, model });
    }
  }
  return out;
}

/** Names of every provider (built-in or custom) that is configured & usable. */
export function availableProviderNames(): string[] {
  const all = { ...BUILTIN, ...custom };
  return Object.keys(all).filter((n) => all[n]?.available());
}

export interface ProviderListItem {
  name: string;
  label: string;
  configured: boolean;
  custom: boolean;
  field: "api_key" | "base_url";
  models?: string[];
}

/** Everything the Providers UI shows: built-ins then customs. */
export function providerList(): ProviderListItem[] {
  const builtinItems: ProviderListItem[] = BUILTIN_NAMES.map((n) => ({
    name: n,
    label: n,
    configured: BUILTIN[n]?.available() ?? false,
    custom: false,
    field: n === "ollama" ? "base_url" : "api_key",
  }));
  const customItems: ProviderListItem[] = customMeta.map((c) => ({
    name: c.id,
    label: c.label,
    configured: custom[c.id]?.available() ?? false,
    custom: true,
    field: "api_key",
    models: c.models,
  }));
  return [...builtinItems, ...customItems];
}

/** {provider, model} pairs for every custom model — used to populate menus. */
export function customModelOptions(): Array<{ provider: string; label: string; model: string }> {
  return customMeta.flatMap((c) =>
    c.models.map((m) => ({ provider: c.id, label: `${c.label}: ${m}`, model: `${c.id}/${m}` })),
  );
}
