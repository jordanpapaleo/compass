/**
 * Intent overrides — the applied output of the learning loop.
 *
 * An override pins an intent to a provider/model, installed from a suggestion
 * (or manually via the API). Router consults these right after intent
 * resolution; explicit-model (passthrough) requests are never affected.
 * Persisted at ~/.compass/overrides.json.
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Intent } from "./types.ts";

export interface IntentOverride {
  /** Built-in provider name or custom provider id. */
  provider: string;
  model: string;
  source: "learned" | "manual";
  applied_at: string; // ISO 8601
}

export type Overrides = Partial<Record<Intent, IntentOverride>>;

const DATA_DIR = process.env.COMPASS_DATA_DIR ?? join(homedir(), ".compass");
const OVERRIDES_PATH = join(DATA_DIR, "overrides.json");

let cache: Overrides | null = null;

export async function getOverrides(): Promise<Overrides> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(OVERRIDES_PATH, "utf8")) as Overrides;
  } catch {
    cache = {};
  }
  return cache;
}

async function persist(): Promise<void> {
  await writeFile(OVERRIDES_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8").catch((e) =>
    console.error("overrides save failed:", e),
  );
}

export async function setOverride(
  intent: Intent,
  o: Omit<IntentOverride, "applied_at">,
): Promise<Overrides> {
  const current = await getOverrides();
  cache = { ...current, [intent]: { ...o, applied_at: new Date().toISOString() } };
  await persist();
  return cache;
}

export async function removeOverride(intent: Intent): Promise<Overrides> {
  const current = await getOverrides();
  const { [intent]: _removed, ...rest } = current;
  cache = rest;
  await persist();
  return cache;
}
