/**
 * Provider configuration — keys managed from the app, not a .env file.
 *
 * Stored at ~/.compass/config.json (perms 0600). On startup we copy these keys
 * into process.env so the existing adapters pick them up unchanged; on any
 * change we re-apply and reset the adapters' cached clients.
 *
 * Security note: this is local plaintext, same posture as the dev .env — fine
 * for a single-user local app. OS-keychain storage is a future hardening step
 * (would move the file's role to the Tauri backend). Nothing here is committed
 * or leaves the machine.
 */

import { chmod, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderName } from "./types.ts";

/** Env var each built-in provider's key/URL lives under (adapters read these). */
export const PROVIDER_ENV: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  ollama: "OLLAMA_BASE_URL", // a URL, not a secret
};

/**
 * A user-added OpenAI-compatible provider — the "add whatever" path. Covers
 * Groq, OpenRouter, DeepSeek, Together, Z.ai, local servers, anything that
 * speaks the OpenAI API. No release needed to add one.
 */
export interface CustomProvider {
  /** url-safe id used in routing, e.g. "groq". */
  id: string;
  /** display name, e.g. "Groq". */
  label: string;
  base_url: string;
  api_key: string;
  /** model ids this provider serves, e.g. ["llama-3.3-70b"]. */
  models: string[];
  /**
   * Optional: which model serves each routing tier. When set, this provider
   * participates in compass/auto routing (preferred for that tier) and in
   * failover. Omit to keep the provider explicit-selection only.
   */
  tiers?: { cheap?: string; balanced?: string; premium?: string };
}

export interface ProviderConfig {
  /** built-in provider name → key (or base URL for ollama). */
  keys: Partial<Record<ProviderName, string>>;
  /** user-added OpenAI-compatible providers. */
  custom_providers: CustomProvider[];
}

const DATA_DIR = process.env.COMPASS_DATA_DIR ?? join(homedir(), ".compass");
const CONFIG_PATH = join(DATA_DIR, "config.json");

let cache: ProviderConfig | null = null;

export async function getConfig(): Promise<ProviderConfig> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as ProviderConfig;
    if (!cache.keys) cache.keys = {};
    if (!Array.isArray(cache.custom_providers)) cache.custom_providers = [];
  } catch {
    cache = { keys: {}, custom_providers: [] };
  }
  return cache;
}

async function persist(): Promise<void> {
  await writeFile(CONFIG_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8").catch((e) =>
    console.error("provider config save failed:", e),
  );
  await chmod(CONFIG_PATH, 0o600).catch(() => {}); // owner-only
}

/**
 * Copy stored keys into process.env so adapters (which read process.env) see
 * them. Called once at startup and after every change. Stored keys take
 * precedence over an existing .env value only when non-empty.
 */
export async function applyToEnv(): Promise<void> {
  const cfg = await getConfig();
  for (const [name, value] of Object.entries(cfg.keys)) {
    if (value) process.env[PROVIDER_ENV[name as ProviderName]] = value;
  }
}

export async function setKey(name: ProviderName, value: string): Promise<ProviderConfig> {
  const cfg = await getConfig();
  cfg.keys = { ...cfg.keys, [name]: value };
  cache = cfg;
  process.env[PROVIDER_ENV[name]] = value;
  await persist();
  return cfg;
}

export async function clearKey(name: ProviderName): Promise<ProviderConfig> {
  const cfg = await getConfig();
  const { [name]: _removed, ...rest } = cfg.keys;
  cfg.keys = rest;
  cache = cfg;
  // Only unset env we own (a value that came from .env can't be restored, but
  // clearing intent should disable the provider regardless).
  delete process.env[PROVIDER_ENV[name]];
  await persist();
  return cfg;
}

// ── Custom providers ───────────────────────────────────────────────

export async function getCustomProviders(): Promise<CustomProvider[]> {
  return (await getConfig()).custom_providers;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

/** Add or replace a custom provider (by id). Returns the updated list. */
export async function addCustomProvider(cp: CustomProvider): Promise<CustomProvider[]> {
  const cfg = await getConfig();
  const clean: CustomProvider = {
    id: cp.id.trim().toLowerCase(),
    label: cp.label.trim() || cp.id,
    base_url: cp.base_url.trim(),
    api_key: cp.api_key.trim(),
    models: cp.models.map((m) => m.trim()).filter(Boolean),
    ...(cp.tiers && Object.values(cp.tiers).some(Boolean) ? { tiers: cp.tiers } : {}),
  };
  if (!ID_RE.test(clean.id)) throw new Error("id must be lowercase letters/digits/hyphens");
  if (!clean.base_url || !clean.models.length) throw new Error("base_url and at least one model required");
  cfg.custom_providers = [...cfg.custom_providers.filter((p) => p.id !== clean.id), clean];
  cache = cfg;
  await persist();
  return cfg.custom_providers;
}

export async function removeCustomProvider(id: string): Promise<CustomProvider[]> {
  const cfg = await getConfig();
  cfg.custom_providers = cfg.custom_providers.filter((p) => p.id !== id);
  cache = cfg;
  await persist();
  return cfg.custom_providers;
}
