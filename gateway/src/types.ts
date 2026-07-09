/**
 * Wire types for the Compass gateway.
 *
 * The public surface is OpenAI-compatible (POST /v1/chat/completions) so any
 * existing client (Claude Code, Cursor, curl, openai SDKs) can point at Compass
 * without modification. Internal types capture the routing decision so every
 * request is explainable and loggable.
 */

// ── OpenAI-compatible request/response ─────────────────────────────

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionRequest {
  /**
   * Model selector. Three forms:
   *  - "compass/auto"        → detect intent, route by rules
   *  - "compass/<intent>"    → explicit intent (e.g. "compass/pr-review")
   *  - concrete provider id  → passthrough (e.g. "claude-haiku-4-5", "gpt-*", "gemini-*")
   */
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  user?: string;
}

export interface ChatCompletionChoice {
  index: number;
  message: { role: "assistant"; content: string };
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  /** The concrete model that served the request (post-routing). */
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** Compass extension: why this request went where it did. */
  compass: RoutingDecision & { latency_ms: number; cost_usd: number | null };
}

// ── Routing ────────────────────────────────────────────────────────

export type Intent =
  | "pr-review"
  | "pr-description"
  | "commit-message"
  | "coding"
  | "debugging"
  | "planning"
  | "architecture"
  | "summarization"
  | "documentation"
  | "brainstorming"
  | "search"
  | "chat";

export type ProviderName = "anthropic" | "openai" | "gemini" | "zai" | "ollama";

export interface RoutingDecision {
  /** Detected or explicitly requested intent. */
  intent: Intent;
  /** How the intent was determined. */
  intent_source: "explicit" | "detected" | "passthrough";
  provider: ProviderName;
  /** Concrete provider model id the request is executed against. */
  model: string;
  /** The rule that fired, machine-readable. */
  rule: string;
  /** Human-readable explanation, one line per factor. */
  reason: string[];
  /** Rough input-size estimate used by size-sensitive rules. */
  estimated_input_tokens: number;
  /** Temperature chosen by the preference engine (only when client sent none). */
  temperature?: number;
}

// ── Provider adapter contract ──────────────────────────────────────

export interface CompletionParams {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** Some providers reject sampling params on newer models; adapters decide. */
  temperature?: number;
}

export interface CompletionResult {
  text: string;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderAdapter {
  name: ProviderName;
  /** True when the API key for this provider is configured. */
  available(): boolean;
  complete(params: CompletionParams): Promise<CompletionResult>;
  /** Yields text deltas; the server frames them as OpenAI-style SSE chunks. */
  stream(params: CompletionParams): AsyncGenerator<string, CompletionResult>;
  /** Drop any cached SDK client so the next call re-reads env (key changed). */
  reset?(): void;
}

// ── Routing log entry (persisted JSONL, one line per request) ──────

export interface GitContextSnapshot {
  branch: string;
  dirty: boolean;
  changed_files: number;
  insertions: number;
  deletions: number;
}

export interface RoutingLogEntry {
  id: string;
  ts: string; // ISO 8601
  /** Repo state at request time, when the client provided a cwd. */
  git?: GitContextSnapshot | null;
  /** Preference sliders at request time (Day 4 learning-loop input). */
  prefs?: Record<string, number>;
  intent: Intent;
  intent_source: RoutingDecision["intent_source"];
  provider: ProviderName;
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
