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
import { analyze } from "./learning.ts";
import { getOverrides, removeOverride, setOverride, type IntentOverride } from "./overrides.ts";
import { getPreferences, sanitize, setPreferences, type Preferences } from "./preferences.ts";
import {
  addCustomProvider,
  clearKey,
  type CustomProvider,
  removeCustomProvider,
  setKey,
} from "./providerConfig.ts";
import {
  availableProviderNames,
  customProviderIds,
  customProviders,
  customTierAssignments,
  getAdapter,
  isBuiltin,
  providerList,
  rebuildCustomAdapters,
} from "./registry.ts";
import { resolveMaxTokens, route } from "./router.ts";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  CompletionResult,
  Intent,
  ProviderName,
  RoutingDecision,
  RoutingLogEntry,
} from "./types.ts";

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
      providers: providerList().map((p) => ({ name: p.name, key_configured: p.configured })),
    }),
  );

  // Provider list — built-ins + custom, for the Providers UI.
  app.get("/v1/providers", (c) => c.json({ providers: providerList() }));

  // Built-in provider key management (set/clear from the app, not a .env file).
  app.put("/v1/providers/:name", async (c) => {
    const name = c.req.param("name");
    if (!isBuiltin(name))
      return c.json({ error: { message: `"${name}" is not a built-in provider` } }, 404);
    const body = (await c.req.json().catch(() => null)) as { value?: string } | null;
    if (!body || typeof body.value !== "string" || !body.value.trim())
      return c.json({ error: { message: "body needs a non-empty `value`" } }, 400);
    await setKey(name as ProviderName, body.value.trim());
    getAdapter(name)?.reset?.(); // drop cached client so the new key is used
    return c.json({ name, configured: getAdapter(name)?.available() ?? false });
  });

  app.delete("/v1/providers/:name", async (c) => {
    const name = c.req.param("name");
    if (!isBuiltin(name))
      return c.json({ error: { message: `"${name}" is not a built-in provider` } }, 404);
    await clearKey(name as ProviderName);
    getAdapter(name)?.reset?.();
    return c.json({ name, configured: getAdapter(name)?.available() ?? false });
  });

  // Custom OpenAI-compatible providers — add any provider/model without a release.
  app.get("/v1/custom-providers", (c) =>
    // Never echo stored keys back — send metadata only.
    c.json({
      custom_providers: customProviders().map((p) => ({
        id: p.id,
        label: p.label,
        base_url: p.base_url,
        models: p.models,
        tiers: p.tiers ?? null,
      })),
    }),
  );

  app.post("/v1/custom-providers", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Partial<CustomProvider> | null;
    if (!body?.id || !body.base_url || !body.api_key || !Array.isArray(body.models))
      return c.json({ error: { message: "id, base_url, api_key, models[] required" } }, 400);
    try {
      await addCustomProvider({
        id: body.id,
        label: body.label ?? body.id,
        base_url: body.base_url,
        api_key: body.api_key,
        models: body.models,
        ...(body.tiers ? { tiers: body.tiers } : {}),
      });
      await rebuildCustomAdapters();
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: { message: e instanceof Error ? e.message : String(e) } }, 400);
    }
  });

  app.delete("/v1/custom-providers/:id", async (c) => {
    await removeCustomProvider(c.req.param("id"));
    await rebuildCustomAdapters();
    return c.json({ ok: true });
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
      { availableProviders: availableProviderNames(), customProviderIds: customProviderIds(), customTiers: customTierAssignments() },
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
      { availableProviders: availableProviderNames(), customProviderIds: customProviderIds(), customTiers: customTierAssignments() },
      { git, prefs, avgLatencyMs, overrides },
    );
    const started = performance.now();

    // Failover chain: the chosen provider, then its available alternates.
    const attempts = [
      { provider: decision.provider, model: decision.model },
      ...(decision.alternates ?? []),
    ].filter((a) => getAdapter(a.provider)?.available());

    if (attempts.length === 0) {
      const error = `Provider "${decision.provider}" selected but not configured`;
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

    const baseParams = {
      messages: req.messages,
      maxTokens: resolveMaxTokens(req),
      // Client temperature wins; otherwise the preference engine's choice.
      ...(req.temperature !== undefined
        ? { temperature: req.temperature }
        : decision.temperature !== undefined
          ? { temperature: decision.temperature }
          : {}),
    };

    // The decision as it actually played out (annotated when we fail over).
    const decisionFor = (
      a: { provider: string; model: string },
      failedOver: boolean,
    ): RoutingDecision =>
      failedOver
        ? {
            ...decision,
            provider: a.provider,
            model: a.model,
            reason: [...decision.reason, `⚠ failed over to ${a.provider}/${a.model} after an error`],
          }
        : decision;

    // ── Streaming (SSE, OpenAI chunk framing) ────────────────────
    if (req.stream) {
      const created = Math.floor(Date.now() / 1000);
      return c.body(
        new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            const send = (data: object) =>
              controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
            let settled = false;
            for (let i = 0; i < attempts.length && !settled; i++) {
              const a = attempts[i]!;
              const eff = decisionFor(a, i > 0);
              // biome-ignore lint/style/noNonNullAssertion: filtered to available adapters
              const adapter = getAdapter(a.provider)!;
              let emitted = false;
              try {
                const gen = adapter.stream({ ...baseParams, model: a.model });
                let result: CompletionResult | undefined;
                while (true) {
                  const { value, done } = await gen.next();
                  if (done) {
                    result = value;
                    break;
                  }
                  emitted = true;
                  send({
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model: a.model,
                    choices: [{ index: 0, delta: { content: value }, finish_reason: null }],
                  });
                }
                send({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model: a.model,
                  choices: [{ index: 0, delta: {}, finish_reason: result?.finishReason ?? "stop" }],
                  usage: result
                    ? {
                        prompt_tokens: result.inputTokens,
                        completion_tokens: result.outputTokens,
                        total_tokens: result.inputTokens + result.outputTokens,
                      }
                    : undefined,
                  compass: eff,
                });
                controller.enqueue(enc.encode("data: [DONE]\n\n"));
                await logRequest(id, eff, {
                  status: "ok",
                  latencyMs: Math.round(performance.now() - started),
                  ...(result ? { result } : {}),
                  stream: true,
                  git,
                  prefs,
                });
                settled = true;
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                await logRequest(`${id}-a${i}`, eff, {
                  status: "error",
                  error: message,
                  latencyMs: Math.round(performance.now() - started),
                  stream: true,
                  git,
                  prefs,
                });
                // Fail over only if nothing was streamed yet and more remain.
                if (emitted || i === attempts.length - 1) {
                  try {
                    send({ error: { message, type: "provider_error" } });
                  } catch {
                    /* client gone; already logged */
                  }
                  settled = true;
                }
              }
            }
            try {
              controller.close();
            } catch {
              /* already closed by cancellation */
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

    // ── Non-streaming (with failover) ────────────────────────────
    let lastError = "provider error";
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i]!;
      const eff = decisionFor(a, i > 0);
      // biome-ignore lint/style/noNonNullAssertion: filtered to available adapters
      const adapter = getAdapter(a.provider)!;
      try {
        const result = await adapter.complete({ ...baseParams, model: a.model });
        const latencyMs = Math.round(performance.now() - started);
        await logRequest(id, eff, { status: "ok", latencyMs, result, stream: false, git, prefs });

        const response: ChatCompletionResponse = {
          id,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: a.model,
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
            ...eff,
            latency_ms: latencyMs,
            cost_usd: costUSD(a.model, result.inputTokens, result.outputTokens, a.provider),
          },
        };
        return c.json(response);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await logRequest(`${id}-a${i}`, eff, {
          status: "error",
          error: lastError,
          latencyMs: Math.round(performance.now() - started),
          stream: false,
          git,
          prefs,
        });
        // loop continues → try the next provider in the failover chain
      }
    }
    return c.json({ error: { message: lastError, type: "provider_error", compass: decision } }, 502);
  });

  return app;
}
