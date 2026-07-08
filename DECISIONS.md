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

### Deferred (not needed for Day 1 gate)
- Tauri sidecar wiring (spawn/supervise gateway from the app) — Day 2, needs
  the app shell talking to the gateway anyway for the Routing Log view.
- Cross-provider fallback retry on provider *failure* (only key-absence
  fallback exists now) — Execution Engine work, spec'd for later days.
- Anthropic prompt-caching passthrough, parallel/voting modes — future.
