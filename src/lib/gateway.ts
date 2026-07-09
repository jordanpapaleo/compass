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

// ── Provider management ────────────────────────────────────────────

export interface ProviderInfo {
  name: string;
  label: string;
  configured: boolean;
  custom: boolean;
  field: "api_key" | "base_url";
  models?: string[];
}

export async function fetchProviders(): Promise<ProviderInfo[]> {
  const res = await fetch(`${GATEWAY_URL}/v1/providers`);
  const body = (await res.json()) as { providers: ProviderInfo[] };
  return body.providers;
}

export async function setProviderKey(name: string, value: string): Promise<void> {
  await fetch(`${GATEWAY_URL}/v1/providers/${name}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

export async function clearProviderKey(name: string): Promise<void> {
  await fetch(`${GATEWAY_URL}/v1/providers/${name}`, { method: "DELETE" });
}

export interface NewCustomProvider {
  id: string;
  label: string;
  base_url: string;
  api_key: string;
  models: string[];
}

/** Returns an error message on failure, or null on success. */
export async function addCustomProvider(cp: NewCustomProvider): Promise<string | null> {
  const res = await fetch(`${GATEWAY_URL}/v1/custom-providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cp),
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
  return body?.error?.message ?? `error ${res.status}`;
}

export async function removeCustomProvider(id: string): Promise<void> {
  await fetch(`${GATEWAY_URL}/v1/custom-providers/${id}`, { method: "DELETE" });
}

// ── Chat (streaming) ───────────────────────────────────────────────

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface RoutedInfo {
  provider: string;
  model: string;
  intent: string;
  cost_usd: number | null;
}

/**
 * Stream a chat completion through Compass. Calls onDelta for each text chunk
 * and returns the routing info from the final chunk's `compass` field.
 */
export async function streamChat(
  model: string,
  messages: ChatMsg[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<RoutedInfo | null> {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 2000 }),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
    throw new Error(err?.error?.message ?? `gateway error ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let routed: RoutedInfo | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      const chunk = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
        compass?: { provider: string; model: string; intent: string };
        error?: { message: string };
      };
      if (chunk.error) throw new Error(chunk.error.message);
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
      if (chunk.compass) {
        routed = {
          provider: chunk.compass.provider,
          model: chunk.compass.model,
          intent: chunk.compass.intent,
          cost_usd: null,
        };
      }
    }
  }
  return routed;
}
