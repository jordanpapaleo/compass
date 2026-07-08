/** Client for the local Compass gateway sidecar. */

export const GATEWAY_URL = "http://localhost:4000";

export interface ProviderStatus {
  name: string;
  key_configured: boolean;
}

export interface Health {
  status: string;
  service: string;
  providers: ProviderStatus[];
}

export interface GitContextSnapshot {
  branch: string;
  dirty: boolean;
  changed_files: number;
  insertions: number;
  deletions: number;
}

export interface RoutingLogEntry {
  id: string;
  ts: string;
  git?: GitContextSnapshot | null;
  intent: string;
  intent_source: "explicit" | "detected" | "passthrough";
  provider: string;
  model: string;
  rule: string;
  reason: string[];
  status: "ok" | "error";
  error?: string;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  stream: boolean;
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch(`${GATEWAY_URL}/health`);
  return (await res.json()) as Health;
}

export async function fetchRoutingLog(limit = 50): Promise<RoutingLogEntry[]> {
  const res = await fetch(`${GATEWAY_URL}/v1/routing-log?limit=${limit}`);
  const body = (await res.json()) as { entries: RoutingLogEntry[] };
  return body.entries;
}
