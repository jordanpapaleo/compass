# Compass — Build Decisions Log

Decisions made autonomously during the build, with rationale. Constraints from
the spec (raw SDKs, Tauri stack, Helm seed) are recorded there, not here.

## Day 1 — Gateway & Routing

### Gateway is a standalone npm package (`gateway/`)
Separate `package.json` from the Tauri frontend. Keeps React deps and sidecar
deps independent, lets the sidecar be bundled/run on its own, and matches how
Tauri sidecars are packaged later. Frontend `npm install` stays fast.

### Server framework: Hono (`@hono/node-server`)
TS-first, tiny, Web-standard Request/Response (streams map cleanly to SSE),
and trivially embeddable. Express is heavier and callback-era; bare `node:http`
would mean hand-rolling routing/JSON handling for no benefit.

### Runtime: Node 24 native TypeScript (type stripping)
No build step, no `tsx`/`ts-node` dep. `node --watch --env-file-if-exists=.env
src/index.ts` runs the server directly. Requires explicit `.ts` import
extensions and `noEmit` — configured in `gateway/tsconfig.json`.

### Model selector contract (the public routing surface)
`model` field on the OpenAI-compatible request carries routing intent:
- `compass/auto` — detect intent from message content, route by rules
- `compass/<intent>` — explicit intent (e.g. `compass/commit-message`)
- concrete id (`claude-*`, `gpt-*`/`o*`, `gemini-*`) — passthrough
Rationale: works from ANY OpenAI-compatible client with zero client changes —
the model dropdown in Cursor becomes the Compass control surface.

### Routing = intent → tier → provider+model
Rules route to a **tier** (cheap/balanced/premium); each provider maps tiers to
concrete models in one config file (`gateway/src/config.ts`). Router never
hardcodes model names, so model churn is a one-line config edit. Size
escalation: inputs >12k est. tokens bump cheap→balanced (quality floor).
Provider chosen by per-tier preference order filtered by key availability.

### Intent detection: weighted regex signals, not an LLM call
A router that adds an LLM classification hop before every request spends
latency/cost it's supposed to save. Day 1 uses weighted keyword/pattern
scoring (fully unit-tested, explainable "signal score" in the reason trail).
The Day 4 learning loop and/or a cheap LLM classifier can layer on later.

### State store: append-only JSONL at `~/.compass/routing-log.jsonl`
Zero deps, human-greppable, atomic-enough appends at this rate, trivial to
parse for the dashboard. It triple-serves as: audit trail (Routing Log UI),
Day 4 learning-loop training data, and eval evidence. SQLite is the upgrade
path if queries get complex.

### Dry-run endpoint: `POST /v1/route`
Returns the full RoutingDecision without executing. Lets routing be
demonstrated/tested keylessly, and the dashboard can use it for "preview"
UX. `GET /health` reports which providers have keys.

### Sampling params are per-provider policy
Current-gen Anthropic models (Opus 4.7+/Sonnet 5) **reject** `temperature`/
`top_p` with a 400 — the Anthropic adapter never forwards them. OpenAI and
Gemini adapters forward `temperature` when the client set it.

### OpenAI/Gemini model ids + pricing are best-effort defaults
Anthropic ids/pricing verified current (claude-haiku-4-5 $1/$5, claude-sonnet-5
$3/$15, claude-opus-4-8 $5/$25 per MTok). OpenAI (`gpt-4o`, `gpt-4o-mini`) and
Gemini (`gemini-2.0-flash`, `gemini-2.5-pro`) ids/pricing are unverified
defaults in `config.ts` — verify against live APIs once keys exist, then
update the one file. Unknown models report `cost_usd: null` rather than a
guessed number.

### Compass metadata rides on the OpenAI response
Non-streaming responses carry a `compass` object (decision + latency + cost);
the final SSE chunk carries the same. Standard clients ignore unknown fields;
Compass-aware clients (our dashboard) get explainability for free.

### Errors are explained too
A 503 (no key) or 502 (provider failure) still includes the routing decision
and is still logged — failed routing attempts are data, not noise.

### Tauri sidecar wiring: dev-mode spawn via system node
The app spawns the gateway on launch (`spawn_gateway()` in `lib.rs`) using
system `node` with cwd `gateway/`, kills it on `RunEvent::Exit`. Non-fatal on
failure — the dashboard shows "gateway offline", and an externally-run
gateway (e.g. `npm run dev`) is also fine (the child exits on port conflict).
**Packaged builds** need a compiled sidecar binary bundled via Tauri's
externalBin — deferred until first release; dev is the Day 1–4 environment.

### Gateway CORS: short origin allowlist, not wildcard
Found via live browser verification: the WebView's cross-origin fetch to
`localhost:4000` was blocked (no CORS headers). Fixed with an allowlist of
`http://localhost:1420`, `tauri://localhost`, `http://tauri.localhost` —
deliberately NOT `*`/reflect-any-origin, or any website in the user's browser
could drive completions (and spend API credit) through the local gateway.
Non-browser clients (curl/SDKs) send no Origin and are unaffected.

### Day 1 verification notes
- OpenAI model ids verified against the live models endpoint (2026-07-08):
  gpt-4o defaults were stale → gpt-5.4 family. Pricing for 5.4 not published
  via API → cost reported as null until confirmed.
- Live-completion gate blocked by OpenAI 429 (account quota, key valid —
  models.list works). Compass-side pipeline verified: intent → route →
  provider call → error handling → routing-log entry with latency.
- Dashboard verified in a real browser against the running gateway:
  online badge + per-provider key status render from live /health.

### Deferred (not needed for Day 1 gate)
- Packaged-app sidecar binary (externalBin) — first release.
- Cross-provider fallback retry on provider *failure* (only key-absence
  fallback exists now) — Execution Engine work, spec'd for later days.
- Anthropic prompt-caching passthrough, parallel/voting modes — future.

## Provider addition — Z.ai / GLM-5.2 (2026-07-08)

### Why
Near-frontier SWE-benchmark quality at ~1/3 sonnet-tier cost, MIT open
weights — exactly the quality/cost tradeoff Compass's balanced tier exists to
exploit, and a first step toward the spec's open/local-model future (Ollama,
LM Studio use the same integration shape).

### How
- Z.ai's API is natively OpenAI-compatible (their docs prescribe the OpenAI
  SDK with swapped base URL) — refactored the OpenAI adapter into
  `providers/openai-compat.ts`, a factory parameterized by name/baseURL/key
  env. `openai` and `zai` are two instances; local runtimes can be a third.
- Verified against docs.z.ai + web (2026-07-08), NOT the marketing email:
  base `https://api.z.ai/api/paas/v4/`, model `glm-5.2`, $1.40/$4.40 per MTok.
- Routing: `glm-*` passthrough; tier order slots zai 2nd for balanced,
  3rd premium, 3rd cheap. `ZAI_API_KEY` in .env.
- Benchmark claims from the email (FrontierSWE 74.4 etc.) are NOT encoded
  anywhere — routing preference is based on verified pricing only.

## Provider addition — Ollama local (2026-07-08) · Day 1 gate PASSED

Jordan asked about running GLM-5.2 locally. Verified hardware first: M3 Pro /
18GB — a 753B-param MoE (~400GB quantized) is not local-feasible there; GLM
stays on Z.ai's hosted API. BUT Ollama was already installed with qwen3:8b —
and Ollama speaks the OpenAI protocol, so the openai-compat factory gained a
keyless mode (`baseURLEnv` gates availability instead of an API-key env).

- `ollama/<model>` passthrough (prefix stripped); tier order slots ollama
  LAST everywhere — an 8B local model is the fallback/explicit choice, not
  the default. The learning loop may promote it per-intent later.
- Local cost reported as $0 (not null — free is a fact, not an unknown).
- This delivered the spec's "offline/local-first routing" future feature
  early, and CLOSED THE DAY 1 GATE with zero cloud quota: real completion +
  real streaming through the gateway, logged with tokens/latency/$0 cost.
