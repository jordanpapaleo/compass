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

## Day 3 — Personalization

### Preference model: four 0–100 axes, named by poles
`quality_cost / speed_accuracy / deterministic_creative / cloud_local`,
50 = neutral, persisted at `~/.compass/preferences.json`, served via
GET/PUT /v1/preferences. Bands: ≤24 / ≥76 count as "strong".

### How sliders change routing (all explained in the reason trail)
- Quality↔Cost and Speed↔Accuracy: ±1 tier bias, clamped to cheap..premium.
- Speed (strong) additionally reorders providers by OBSERVED avg latency
  mined from the routing log (≥2 providers with data) — personalization from
  the user's own history, groundwork for Day 4.
- Deterministic↔Creative: temperature 0..1.0 where the provider supports it;
  client-sent temperature always wins; Anthropic current-gen never gets one.
- Cloud↔Local: strong local promotes ollama to first choice; strong cloud
  excludes local from auto-routing (unless it's the only provider).
- Passthrough (explicit model id) bypasses preferences by design.
- Every log entry snapshots the prefs — Day 4 learning-loop input.

### Verified live (browser, real drags)
Same "Implement code" request: neutral → openai/gpt-5.4; Cloud↔Local at 100
→ ollama/qwen3:8b ("Ollama promoted to first choice"); Quality↔Cost at 90 →
gpt-5.4-mini ("tier −1, balanced→cheap"). Day 3 gate passed.

### React review caught a real bug
Preview effect keyed on client prefs fired before the debounced PUT landed —
but /v1/route reads prefs server-side, so it flashed stale decisions. Moved
slider-driven refresh into the save handler (effect only on sample change).

## Day 4 — Learning & Polish

### Learning engine: four insight kinds, computed live from real history
`gateway/src/learning.ts` analyzes the last 200 log entries on every
GET /v1/insights — nothing precomputed, nothing synthetic:
- provider-failing: ≥3 attempts, ≥80% errors → warning (fired on openai's
  real 429 streak).
- explicit-model-pattern: ≥3 dominant (≥70%) manual model picks for one
  intent → applyable suggestion (the spec's "always prefers Haiku" case).
- cost-optimization: ≥30% projected savings re-pricing real token counts on
  the cheapest known-priced cheap-tier model → applyable.
- latency-gap: ≥2x avg gap between providers (≥3 samples each) → info.

### Overrides: the apply loop
Suggestion → POST /v1/overrides → ~/.compass/overrides.json → router applies
right after intent resolution (rule "learned-override:<intent>", explained,
never on passthrough, falls back to rules if the pinned provider is
unconfigured). UI lists active learned routes with one-click removal.

### Passthrough now detects intent (for learning only)
Explicit-model requests still route verbatim, but the detected intent is
recorded so "user manually picks M for X" is observable. That's what let the
pattern fire on real usage.

### Bug found via the demo itself: client disconnect lost the log entry
A curl | head cut an SSE stream early → enqueue threw → the catch's error
send ALSO threw → logRequest never ran. Fixed: guarded send + close, log
always written. Failed/aborted streams are history too.

### Day 4 gate: PASSED on real history
Observed (3 genuine manual ollama picks + real openai 429s) → suggested →
applied via UI click → compass/auto request routed by learned-override:chat
and completed locally. Loop closed end-to-end.

## Packaging — self-contained macOS app (2026-07-09)

Goal: run Compass without the repo or system Node. Approach:
- Gateway bundled to one CJS file (esbuild), then a **Node SEA single
  executable** (`gateway/build-sidecar.sh`): esbuild → SEA blob → inject into a
  copied `node` binary via postject → ad-hoc sign. Output goes to
  `src-tauri/binaries/compass-gateway-<target-triple>` (Tauri's externalBin
  naming). ~120MB (bundles the Node runtime); gitignored, rebuilt via script.
- `index.ts` startup wrapped in an async IIFE (not top-level await) so it
  bundles to CommonJS for SEA.
- `tauri.conf.json` `bundle.externalBin` ships the sidecar inside the .app
  (Contents/MacOS/compass-gateway).
- `lib.rs` `build_gateway_command()` is cfg-split: **debug** runs the repo TS
  with system node (live reload for `tauri dev`); **release** runs the bundled
  sidecar next to the app executable.

### Verified
`npm run tauri build --bundles app` produces `Compass.app`; launching it starts
the bundled gateway on :4000 with no repo/node present. In the packaged app,
keys come from `~/.compass/config.json` via the Providers panel (no .env) —
which is exactly why the in-app key management exists.

### Outstanding
- **Signed .dmg:** the unsigned local build's DMG *wrapper* step
  (`bundle_dmg.sh`/create-dmg) fails; the `.app` itself builds fine. A proper
  distributable, notarized DMG comes from `release.sh` once Apple creds are
  filled into `sign.sh` (SIGNING.md) — that's the intended release path.
- Build script is aarch64-only in practice (uses the host's node); cross-arch
  would need per-target node binaries.

## Claude Code endpoint — Anthropic-compatible /v1/messages (2026-07-09)

Claude Code speaks Anthropic's Messages API, not OpenAI's. `POST /v1/messages`
(anthropicProxy.ts + server.ts) lets it route through Compass:
- Reduces the Anthropic request (system + message blocks, incl. tool_result
  text) to Compass's {role,content} for intent detection.
- Routes via the normal engine; `pickAnthropicModel()` maps the chosen tier to
  the Claude model (or honors an explicit claude-* passthrough).
- **Proxies raw to api.anthropic.com** with Compass's own key — so tools,
  thinking, and streaming keep 100% fidelity (no lossy translation).
- Cross-protocol routing (Anthropic request → non-Anthropic provider) is out of
  scope: it stays on Claude models. The router still picks WHICH Claude model by
  intent + sliders, and every call is logged.
- Compass ignores the client's key and uses ANTHROPIC_API_KEY from config; the
  user sets any placeholder key for Claude Code and configures the real one in
  the Providers panel. Setup: ANTHROPIC_BASE_URL=localhost:4000, ANTHROPIC_MODEL=compass/auto.

### Verified
Anthropic-shaped requests routed commit-message→haiku and architecture→opus,
returned proper Anthropic responses with usage; streaming passed native
message_start/... SSE through; all logged.

---

## Model catalog — Opus 5 + tier/catalog split (2026-08-12)

### Why
Adding a model meant editing `TIER_MODELS`, and that map holds exactly one
model per tier — so promoting Opus 5 to premium would have evicted Opus 4.8
from `routableModels()` and its Gateway chip, even though passthrough
(`/^claude-/` in router.ts) still routes it fine. Tier assignment and "models
Compass knows about" are different questions and now have different homes.

### How
- `PROVIDER_MODELS` (config.ts) — the per-provider catalog; a superset of
  `TIER_MODELS`. `routableModels()` builds chips from it instead of from tier
  values, so a provider can expose more models than it has tiers.
- `TIER_MODELS.anthropic.premium` → `claude-opus-5`. Same $5/$25 as 4.8, so no
  cost-model change; `compass/auto` architecture/premium work now lands on
  Opus 5.
- `claude-opus-4-8` keeps its PRICING entry and its chip — passthrough calls
  still report real cost.
- config.test.ts guards the invariant: every tier model must be in the catalog,
  and every Anthropic catalog model must be priced.

### Catalog is always shown; `configured` is separate from `enabled`
`routableModels()` no longer filters by `adapter.available()`. Every known model
is listed with two independent flags: `configured` (its provider has a key) and
`enabled` (the user's toggle). Chips for unconfigured models render greyed with
a "no key" label, so the catalog doubles as a menu of what a key would buy, and
a pre-set toggle survives until the key lands — `disabled_models` is keyed by
model id and never touched by key changes.

Verified with an empty `COMPASS_DATA_DIR` and no env keys: `/v1/models` returns
all 10 entries at `configured:false` (it returned `[]` before), and toggling an
unconfigured model off persists to `disabled_models`.

### Known limitation
Chips toggle auto-routing candidacy only. Turning off a catalog model that
isn't assigned to a tier is a no-op, because passthrough never consults
`disabledModels` — true before this change too, just now visible on more chips.
