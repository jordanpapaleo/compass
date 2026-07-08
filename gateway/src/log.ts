/**
 * Routing log — append-only JSONL at ~/.compass/routing-log.jsonl.
 *
 * One line per routed request: what came in, where it went, why, what it cost.
 * This is simultaneously (a) the audit trail behind the dashboard's Routing
 * Log view, (b) the raw training data for the Day 4 learning loop, and (c) the
 * eval surface showing exactly what the router did.
 *
 * JSONL over SQLite for Day 1: zero deps, human-greppable, append is atomic
 * enough at this write rate, trivially parsed for the UI. Revisit if history
 * queries get complex.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RoutingLogEntry } from "./types.ts";

const DATA_DIR = process.env.COMPASS_DATA_DIR ?? join(homedir(), ".compass");
const LOG_PATH = join(DATA_DIR, "routing-log.jsonl");

let dirReady: Promise<unknown> | null = null;

function ensureDir() {
  dirReady ??= mkdir(DATA_DIR, { recursive: true });
  return dirReady;
}

export async function appendLog(entry: RoutingLogEntry): Promise<void> {
  await ensureDir();
  await appendFile(LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

/** Most recent entries first. */
export async function readLog(limit = 100): Promise<RoutingLogEntry[]> {
  try {
    const raw = await readFile(LOG_PATH, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => JSON.parse(l) as RoutingLogEntry)
      .reverse();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export function logPath(): string {
  return LOG_PATH;
}
