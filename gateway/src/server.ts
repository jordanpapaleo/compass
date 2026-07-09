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
import { appendLog, avgLatencyByProvider, readLog } from "./log.ts";
import { anthropicAdapter } from "./providers/anthropic.ts";
import { geminiAdapter } from "./providers/gemini.ts";
import { ollamaAdapter } from "./providers/ollama.ts";
import { openaiAdapter } from "./providers/openai.ts";
import { zaiAdapter } from "./providers/zai.ts";
import { analyze } from "./learning.ts";
import { getOverrides, removeOverride, setOverride, type IntentOverride } from "./overrides.ts";
import { getPreferences, sanitize, setPreferences, type Preferences } from "./preferences.ts";
import { clearKey, setKey } from "./providerConfig.ts";
import { resolveMaxTokens, route } from "./router.ts";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  CompletionResult,
  Intent,
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
  ollama: ollamaAdapter,
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
    prefs?: Preferences;
  },
): Promise<void> {
  const entry: RoutingLogEntry = {
    id,
    ts: new Date().toISOString(),
    ...(opts.git ? { git: opts.git } : {}),
    ...(opts.prefs ? { prefs: { ...opts.prefs } } : {}),
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
      ? costUSD(decision.model, opts.result.inputTokens, opts.result.outputTokens, decision.provider)
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

  // Provider key management — set/clear from the app instead of a .env file.
  app.get("/v1/providers", (c) =>
    c.json({
      providers: (Object.keys(ADAPTERS) as ProviderName[]).map((p) => ({
        name: p,
        configured: ADAPTERS[p].available(),
        // ollama takes a base URL, the rest take an API key.
        field: p === "ollama" ? "base_url" : "api_key",
      })),
    }),
  );

  app.put("/v1/providers/:name", async (c) => {
    const name = c.req.param("name") as ProviderName;
    if (!(name in ADAPTERS)) return c.json({ error: { message: `unknown provider "${name}"` } }, 404);
    const body = (await c.req.json().catch(() => null)) as { value?: string } | null;
    if (!body || typeof body.value !== "string" || !body.value.trim())
      return c.json({ error: { message: "body needs a non-empty `value`" } }, 400);
    await setKey(name, body.value.trim());
    ADAPTERS[name].reset?.(); // drop any cached client so the new key is used
    return c.json({ name, configured: ADAPTERS[name].available() });
  });

  app.delete("/v1/providers/:name", async (c) => {
    const name = c.req.param("name") as ProviderName;
    if (!(name in ADAPTERS)) return c.json({ error: { message: `unknown provider "${name}"` } }, 404);
    await clearKey(name);
    ADAPTERS[name].reset?.();
    return c.json({ name, configured: ADAPTERS[name].available() });
  });

  // Dry run — full routing decision, no provider call. Works without keys.
  app.post("/v1/route", async (c) => {
    const parsed = validate(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ error: { message: parsed.error } }, 400);
    const git = await getGitContext(c.req.header("x-compass-cwd"));
    const [prefs, avgLatencyMs, overrides] = await Promise.all([
      getPreferences(),
      avgLatencyByProvider(),
      getOverrides(),
    ]);
    const decision = route(
      parsed.req,
      { availableProviders: availableProviders() },
      { git, prefs, avgLatencyMs, overrides },
    );
    return c.json({ decision, git, preferences: prefs });
  });

  app.get("/v1/routing-log", async (c) => {
    const limit = Number(c.req.query("limit") ?? "") || 100;
    return c.json({ entries: await readLog(limit) });
  });

  app.get("/v1/preferences", async (c) => c.json({ preferences: await getPreferences() }));

  app.put("/v1/preferences", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Partial<Preferences> | null;
    if (!body || typeof body !== "object")
      return c.json({ error: { message: "body must be a JSON object of slider values" } }, 400);
    const saved = await setPreferences(sanitize({ ...(await getPreferences()), ...body }));
    return c.json({ preferences: saved });
  });

  // Learning loop: suggestions computed live from real routing history.
  app.get("/v1/insights", async (c) => {
    const [entries, overrides] = await Promise.all([readLog(200), getOverrides()]);
    return c.json({ insights: analyze(entries, overrides), overrides });
  });

  app.get("/v1/overrides", async (c) => c.json({ overrides: await getOverrides() }));

  app.post("/v1/overrides", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | ({ intent: Intent } & Omit<IntentOverride, "applied_at">)
      | null;
    if (!body?.intent || !body.provider || !body.model)
      return c.json({ error: { message: "intent, provider, model required" } }, 400);
    const overrides = await setOverride(body.intent, {
      provider: body.provider,
      model: body.model,
      source: body.source ?? "learned",
    });
    return c.json({ overrides });
  });

  app.delete("/v1/overrides/:intent", async (c) =>
    c.json({ overrides: await removeOverride(c.req.param("intent") as Intent) }),
  );

  app.post("/v1/chat/completions", async (c) => {
    const parsed = validate(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ error: { message: parsed.error, type: "invalid_request_error" } }, 400);
    const req = parsed.req;

    const id = `cmpl-${ulid()}`;
    const git = await getGitContext(c.req.header("x-compass-cwd"));
    const [prefs, avgLatencyMs, overrides] = await Promise.all([
      getPreferences(),
      avgLatencyByProvider(),
      getOverrides(),
    ]);
    const decision = route(
      req,
      { availableProviders: availableProviders() },
      { git, prefs, avgLatencyMs, overrides },
    );
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
        prefs,
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
      // Client temperature wins; otherwise the preference engine's choice.
      ...(req.temperature !== undefined
        ? { temperature: req.temperature }
        : decision.temperature !== undefined
          ? { temperature: decision.temperature }
          : {}),
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
                prefs,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              // The client may have disconnected — enqueue on a closed stream
              // throws, and an unlogged request would be a hole in history.
              try {
                send({ error: { message, type: "provider_error" } });
              } catch {
                /* client gone; still log below */
              }
              await logRequest(id, decision, {
                status: "error",
                error: message,
                latencyMs: Math.round(performance.now() - started),
                stream: true,
                git,
                prefs,
              });
            } finally {
              try {
                controller.close();
              } catch {
                /* already closed by cancellation */
              }
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
      await logRequest(id, decision, { status: "ok", latencyMs, result, stream: false, git, prefs });

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
          cost_usd: costUSD(decision.model, result.inputTokens, result.outputTokens, decision.provider),
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
        prefs,
      });
      return c.json({ error: { message, type: "provider_error", compass: decision } }, 502);
    }
  });

  return app;
}
