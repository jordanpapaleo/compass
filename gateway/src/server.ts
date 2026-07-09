/**
 * Compass gateway HTTP server (Hono).
 *
 * Routes:
 *   GET  /health               — liveness + which providers have keys
 *   POST /v1/chat/completions  — OpenAI-compatible; routes + executes (+SSE)
 *   POST /v1/route             — dry run: returns the RoutingDecision only
 *   GET  /v1/routing-log       — recent routing history (dashboard feed)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { ulid } from "ulid";
import { costUSD } from "./config.ts";
import { getGitContext, type GitContext } from "./context/git.ts";
import { appendLog, readLog } from "./log.ts";
import { anthropicAdapter } from "./providers/anthropic.ts";
import { geminiAdapter } from "./providers/gemini.ts";
import { openaiAdapter } from "./providers/openai.ts";
import { zaiAdapter } from "./providers/zai.ts";
import { resolveMaxTokens, route } from "./router.ts";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  CompletionResult,
  ProviderAdapter,
  ProviderName,
  RoutingDecision,
  RoutingLogEntry,
} from "./types.ts";

const ADAPTERS: Record<ProviderName, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  zai: zaiAdapter,
};

function availableProviders(): ProviderName[] {
  return (Object.keys(ADAPTERS) as ProviderName[]).filter((p) => ADAPTERS[p].available());
}

function validate(body: unknown): { ok: true; req: ChatCompletionRequest } | { ok: false; error: string } {
  const b = body as Partial<ChatCompletionRequest> | null;
  if (!b || typeof b !== "object") return { ok: false, error: "Request body must be a JSON object" };
  if (typeof b.model !== "string" || !b.model) return { ok: false, error: "`model` is required" };
  if (!Array.isArray(b.messages) || b.messages.length === 0)
    return { ok: false, error: "`messages` must be a non-empty array" };
  for (const m of b.messages) {
    if (!m || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string")
      return { ok: false, error: "each message needs role∈{system,user,assistant} and string content" };
  }
  return { ok: true, req: b as ChatCompletionRequest };
}

async function logRequest(
  id: string,
  decision: RoutingDecision,
  opts: {
    status: "ok" | "error";
    error?: string;
    latencyMs: number;
    result?: CompletionResult;
    stream: boolean;
    git?: GitContext | null;
  },
): Promise<void> {
  const entry: RoutingLogEntry = {
    id,
    ts: new Date().toISOString(),
    ...(opts.git ? { git: opts.git } : {}),
    intent: decision.intent,
    intent_source: decision.intent_source,
    provider: decision.provider,
    model: decision.model,
    rule: decision.rule,
    reason: decision.reason,
    status: opts.status,
    ...(opts.error ? { error: opts.error } : {}),
    latency_ms: opts.latencyMs,
    input_tokens: opts.result?.inputTokens ?? null,
    output_tokens: opts.result?.outputTokens ?? null,
    cost_usd: opts.result
      ? costUSD(decision.model, opts.result.inputTokens, opts.result.outputTokens)
      : null,
    stream: opts.stream,
  };
  await appendLog(entry).catch((e) => console.error("routing-log append failed:", e));
}

/**
 * Origins allowed to call the gateway from a browser context. Deliberately a
 * short allowlist, NOT a wildcard: a localhost API that reflects any Origin
 * would let arbitrary websites drive completions (and spend API credit) via
 * the user's browser. Non-browser clients (curl, SDKs) send no Origin and are
 * unaffected by CORS.
 */
const ALLOWED_ORIGINS = [
  "http://localhost:1420", // vite dev / tauri dev
  "tauri://localhost", // packaged Tauri (macOS/Linux)
  "http://tauri.localhost", // packaged Tauri (Windows)
];

export function createApp(): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    }),
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "compass-gateway",
      providers: (Object.keys(ADAPTERS) as ProviderName[]).map((p) => ({
        name: p,
        key_configured: ADAPTERS[p].available(),
      })),
    }),
  );

  // Dry run — full routing decision, no provider call. Works without keys.
  app.post("/v1/route", async (c) => {
    const parsed = validate(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ error: { message: parsed.error } }, 400);
    const git = await getGitContext(c.req.header("x-compass-cwd"));
    const decision = route(parsed.req, { availableProviders: availableProviders() }, { git });
    return c.json({ decision, git });
  });

  app.get("/v1/routing-log", async (c) => {
    const limit = Number(c.req.query("limit") ?? "") || 100;
    return c.json({ entries: await readLog(limit) });
  });

  app.post("/v1/chat/completions", async (c) => {
    const parsed = validate(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ error: { message: parsed.error, type: "invalid_request_error" } }, 400);
    const req = parsed.req;

    const id = `cmpl-${ulid()}`;
    const git = await getGitContext(c.req.header("x-compass-cwd"));
    const decision = route(req, { availableProviders: availableProviders() }, { git });
    const adapter = ADAPTERS[decision.provider];
    const started = performance.now();

    if (!adapter.available()) {
      const error = `Provider "${decision.provider}" selected but no API key is configured`;
      await logRequest(id, decision, {
        status: "error",
        error,
        latencyMs: Math.round(performance.now() - started),
        stream: Boolean(req.stream),
        git,
      });
      return c.json(
        { error: { message: error, type: "compass_provider_unavailable", compass: decision } },
        503,
      );
    }

    const params = {
      model: decision.model,
      messages: req.messages,
      maxTokens: resolveMaxTokens(req),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };

    // ── Streaming (SSE, OpenAI chunk framing) ────────────────────
    if (req.stream) {
      const created = Math.floor(Date.now() / 1000);
      return c.body(
        new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            const send = (data: object) =>
              controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
            try {
              const gen = adapter.stream(params);
              let result: CompletionResult | undefined;
              while (true) {
                const { value, done } = await gen.next();
                if (done) {
                  result = value;
                  break;
                }
                send({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model: decision.model,
                  choices: [{ index: 0, delta: { content: value }, finish_reason: null }],
                });
              }
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model: decision.model,
                choices: [{ index: 0, delta: {}, finish_reason: result?.finishReason ?? "stop" }],
                usage: result
                  ? {
                      prompt_tokens: result.inputTokens,
                      completion_tokens: result.outputTokens,
                      total_tokens: result.inputTokens + result.outputTokens,
                    }
                  : undefined,
                compass: decision,
              });
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
              await logRequest(id, decision, {
                status: "ok",
                latencyMs: Math.round(performance.now() - started),
                ...(result ? { result } : {}),
                stream: true,
                git,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              send({ error: { message, type: "provider_error" } });
              await logRequest(id, decision, {
                status: "error",
                error: message,
                latencyMs: Math.round(performance.now() - started),
                stream: true,
                git,
              });
            } finally {
              controller.close();
            }
          },
        }),
        200,
        {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      );
    }

    // ── Non-streaming ────────────────────────────────────────────
    try {
      const result = await adapter.complete(params);
      const latencyMs = Math.round(performance.now() - started);
      await logRequest(id, decision, { status: "ok", latencyMs, result, stream: false, git });

      const response: ChatCompletionResponse = {
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: decision.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: result.text },
            finish_reason: result.finishReason,
          },
        ],
        usage: {
          prompt_tokens: result.inputTokens,
          completion_tokens: result.outputTokens,
          total_tokens: result.inputTokens + result.outputTokens,
        },
        compass: {
          ...decision,
          latency_ms: latencyMs,
          cost_usd: costUSD(decision.model, result.inputTokens, result.outputTokens),
        },
      };
      return c.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logRequest(id, decision, {
        status: "error",
        error: message,
        latencyMs: Math.round(performance.now() - started),
        stream: false,
        git,
      });
      return c.json({ error: { message, type: "provider_error", compass: decision } }, 502);
    }
  });

  return app;
}
