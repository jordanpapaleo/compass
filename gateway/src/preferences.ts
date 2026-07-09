/**
 * Preference engine — Day 3.
 *
 * Four axes, each 0–100, named by their poles so the numbers can't be
 * misread. 50 = neutral. Persisted to ~/.compass/preferences.json; the
 * router folds them into every non-passthrough decision (explicit model
 * requests bypass preferences — the user already said exactly what they want).
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Preferences {
  /** 0 = maximize quality · 100 = minimize cost */
  quality_cost: number;
  /** 0 = maximize speed · 100 = maximize accuracy */
  speed_accuracy: number;
  /** 0 = deterministic · 100 = creative (maps to temperature where supported) */
  deterministic_creative: number;
  /** 0 = prefer cloud · 100 = prefer local */
  cloud_local: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  quality_cost: 50,
  speed_accuracy: 50,
  deterministic_creative: 50,
  cloud_local: 50,
};

const DATA_DIR = process.env.COMPASS_DATA_DIR ?? join(homedir(), ".compass");
const PREFS_PATH = join(DATA_DIR, "preferences.json");

let cache: Preferences | null = null;

function clamp(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 50;
  return Math.min(100, Math.max(0, Math.round(v)));
}

export function sanitize(p: Partial<Preferences> | null | undefined): Preferences {
  return {
    quality_cost: clamp(p?.quality_cost),
    speed_accuracy: clamp(p?.speed_accuracy),
    deterministic_creative: clamp(p?.deterministic_creative),
    cloud_local: clamp(p?.cloud_local),
  };
}

export async function getPreferences(): Promise<Preferences> {
  if (cache) return cache;
  try {
    const raw = await readFile(PREFS_PATH, "utf8");
    cache = sanitize(JSON.parse(raw) as Partial<Preferences>);
  } catch {
    cache = { ...DEFAULT_PREFERENCES };
  }
  return cache;
}

export async function setPreferences(p: Partial<Preferences>): Promise<Preferences> {
  const merged = sanitize({ ...(await getPreferences()), ...p });
  cache = merged;
  await writeFile(PREFS_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8").catch((e) =>
    console.error("preferences save failed:", e),
  );
  return merged;
}

/** Bands: ≤24 strong-left, ≥76 strong-right, otherwise neutral-ish. */
export const STRONG_LEFT = 24;
export const STRONG_RIGHT = 76;
