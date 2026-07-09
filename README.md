# Compass 🧭

**A personal AI router that runs on your machine.** You ask for the work; Compass
picks the model — by what the task is, what you care about (cost, speed, quality),
and what it has learned you prefer. Every decision is explained and logged.

Today everyone asks *"what's the best model?"* — but there isn't one. The best model
depends on what you're optimizing for. Compass turns that choice into something the
computer makes for you, transparently, and gets better at it over time.

---

## The mental model (read this first)

**Compass is infrastructure, not a chat app.** It does not have a chat box you type
into. It sits *between* the tools you already use and the AI providers, and routes
each request to the right place.

```
┌────────────────┐        ┌─────────────────────────┐        ┌──────────────┐
│  Your client   │        │        COMPASS          │        │  Providers   │
│  (Cursor, a    │───────▶│  gateway :4000          │───────▶│  Anthropic   │
│  script, curl, │  chat  │  • detect intent        │  calls │  OpenAI      │
│  the CLI…)     │        │  • apply prefs + learned │        │  Gemini      │
│                │◀───────│    routes                │◀───────│  Z.ai (GLM)  │
└────────────────┘ answer │  • pick provider/model   │ result │  Ollama 🖥️   │
                          │  • log the decision      │        │  (local)     │
                          └───────────┬─────────────┘        └──────────────┘
                                      │ reads
                             ~/.compass/  (log, prefs, learned routes)
                                      ▲ tunes
                          ┌───────────┴─────────────┐
                          │  Compass dashboard       │  ← you WATCH & TUNE here,
                          │  (the desktop app)       │     you don't chat here
                          └──────────────────────────┘
```

There are **two surfaces**, and they do different jobs:

| Surface | What it's for | Do you chat here? |
|---|---|---|
| **Your existing client** (Cursor, a script, the openai SDK, curl) | Where you actually send prompts | **Yes** — pointed at Compass's URL |
| **The Compass dashboard** (desktop app) | Control panel: sliders, routing log, suggestions | **No** — you tune and observe |

So *"where do I send chats?"* → from whatever tool you already use, after pointing it
at `http://localhost:4000/v1`. Compass is the plumbing behind it.

> **Want a chat box inside Compass itself?** That's a deliberate design choice, not an
> oversight — Compass is currently pure routing infrastructure. A built-in chat panel
> (so the dashboard is *also* a place you can use it directly, no other tool needed) is
> a natural next feature. See [Roadmap](#roadmap).

---

## Quick start

**Prerequisites:** Node ≥ 24, and [Ollama](https://ollama.com) if you want free local
routing (`ollama pull qwen3:8b`).

```bash
# 1. Start the gateway (the router)
cd gateway
npm install
cp .env.example .env          # add at least one provider key (see Providers)
npm run dev                   # → http://localhost:4000

# 2. Start the dashboard (control panel) — optional but nice
cd ..
npm install
npm run dev                   # → http://localhost:1420
# …or the real desktop app, which starts the gateway itself:
npm run tauri dev
```

You need **at least one** provider working. The zero-cost path: install Ollama, set
`OLLAMA_BASE_URL=http://localhost:11434/v1` in `.env`, and you can route locally for
free with no API keys at all.

---

## Using it

### From any OpenAI-compatible client

Compass speaks the OpenAI API. Point a client at it and change one line — the model:

```bash
curl http://localhost:4000/v1/chat/completions -H 'content-type: application/json' -d '{
  "model": "compass/auto",
  "messages": [{"role": "user", "content": "Write a commit message for my staged changes"}]
}'
```

```js
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "http://localhost:4000/v1", apiKey: "unused" });
await client.chat.completions.create({
  model: "compass/auto",
  messages: [{ role: "user", content: "Design a rate limiter" }],
});
```

The `apiKey` is ignored — Compass holds the real keys and calls providers on your
behalf.

### From Cursor

Settings → Models → enable "Override OpenAI Base URL" → `http://localhost:4000/v1`,
any key, add a custom model named `compass/auto`. Cursor now routes through Compass.

### The `model` field is the control surface

| Value | Behavior |
|---|---|
| `compass/auto` | Detect the intent, route by rules + your sliders + learned routes |
| `compass/<intent>` | Force an intent — e.g. `compass/pr-review`, `compass/commit-message` |
| `claude-opus-4-8`, `gpt-5.4`, `gemini-2.5-pro`, `glm-5.2` | Passthrough to that exact model |
| `ollama/<model>` | Straight to your local model, e.g. `ollama/qwen3:8b` |

Intents: `pr-review, pr-description, commit-message, coding, debugging, planning,
architecture, summarization, documentation, brainstorming, search, chat`.

Streaming (`"stream": true`) is supported. Every response carries a `compass` field
with the routing decision, cost, and latency.

### The dashboard

- **Personalization** — four sliders (Quality↔Cost, Speed↔Accuracy,
  Deterministic↔Creative, Cloud↔Local) with a live preview. They change routing for
  every future `compass/auto` request and persist across restarts.
- **Optimization Suggestions** — the learning loop. As history accumulates, Compass
  surfaces patterns ("you keep picking Ollama for chat — automate it?"). Click **Apply**
  and it becomes a learned route; remove it anytime.
- **Routing Log** — every request with a plain-English "Why", cost, latency, and git
  context. This is both the audit trail and what the learning loop feeds on.

---

## Providers & keys

Add keys to `gateway/.env` (gitignored — never commit it). Providers light up
automatically on restart; the dashboard shows which are configured.

| Env var | Provider | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) | Pay-as-you-go |
| `OPENAI_API_KEY` | OpenAI (GPT) | Pay-as-you-go |
| `GEMINI_API_KEY` | Google (Gemini) | Free tier available (tight rate limits) |
| `ZAI_API_KEY` | Z.ai (GLM-5.2, open weights) | Near-frontier coding at ~⅓ Sonnet cost |
| `OLLAMA_BASE_URL` | Local models via Ollama | **Free, no key.** `http://localhost:11434/v1` |

> ⚠️ **`.env` is for development only.** A packaged app can't ship a `.env`, and end
> users shouldn't edit files. Real distribution needs an in-app Settings screen that
> stores keys in the OS keychain — see [Roadmap](#roadmap). This is the top gap before
> Compass can be handed to someone else.

---

## How routing works

1. **Passthrough** — a concrete model id (`claude-*`, `gpt-*`, `gemini-*`, `glm-*`,
   `ollama/*`) is honored verbatim.
2. **Learned override** — if you've applied a suggestion for this intent, it wins.
3. **Intent → tier → provider/model** — the intent maps to a tier
   (cheap/balanced/premium); each provider maps a tier to a concrete model in one config
   file. Sliders bias the tier and reshape provider order; large inputs or big git diffs
   escalate a tier for quality.
4. **Availability** — the first configured provider in the tier's preference order wins.

Precedence: **passthrough > learned override > preferences > tier rules.** Every step
that fires writes a line into the decision's "Why" trail.

Routing by *tier* (not hardcoded model names) means model churn is a one-line config
edit in `gateway/src/config.ts`.

---

## Architecture

```
compass/
├── gateway/                  Node/TS router (the sidecar) — runs on :4000
│   └── src/
│       ├── server.ts         Hono HTTP server, OpenAI-compatible endpoints
│       ├── router.ts         the routing brain (intent→tier→provider, prefs, overrides)
│       ├── intent.ts         weighted-regex intent detection
│       ├── config.ts         models, pricing, tier/provider tables (edit here on churn)
│       ├── preferences.ts    the four sliders, persisted
│       ├── learning.ts       mines the log for suggestions
│       ├── overrides.ts      applied learned routes
│       ├── log.ts            append-only routing log
│       ├── context/git.ts    repo state (branch, diff size) as a routing signal
│       └── providers/        raw provider SDKs: anthropic, openai(+factory), gemini,
│                             zai, ollama  (no vendor gateway — direct SDKs)
├── src/                      React dashboard (Tauri frontend)
│   └── components/           GatewayCard, Personalization, Suggestions, RoutingLog
├── src-tauri/                Rust shell — spawns & supervises the gateway sidecar
└── ~/.compass/              your data: routing-log.jsonl, preferences.json, overrides.json
```

Endpoints: `POST /v1/chat/completions` (OpenAI-compatible, routed + executed),
`POST /v1/messages` (Anthropic-compatible, for Claude Code), `POST /v1/route` (dry-run
decision, works without keys), `GET|PUT|DELETE /v1/providers`,
`GET|POST|DELETE /v1/custom-providers`, `GET /v1/routing-log`, `GET /v1/insights`,
`GET|PUT /v1/preferences`, `GET|POST|DELETE /v1/overrides`, `GET /health`.

**Your data never leaves your machine** except the model calls themselves, which go
directly to each provider (or stay fully local with Ollama).

---

## Develop

```bash
cd gateway && npm test        # 54 routing/learning/context tests
npm run test:types            # gateway typecheck
cd .. && npm run build        # frontend typecheck + build
cd src-tauri && cargo check   # Rust shell
```

Design decisions and their rationale are logged in [DECISIONS.md](./DECISIONS.md).
Release/signing setup is in [SIGNING.md](./SIGNING.md).

---

## Current limitations

- **`/v1/messages` (Claude Code) stays on Claude models** — routing among Claude models
  by intent, proxied to Anthropic with full tool/streaming fidelity. Routing an Anthropic
  request to a non-Anthropic provider would need tool-call translation (future work).
- **Custom providers auto-route only when you assign them a tier** — otherwise they're
  explicit-selection (pick them in Chat or `id/model`).
- **Packaged keys are local plaintext** (`~/.compass/config.json`, owner-only) — an
  OS-keychain upgrade would harden this.
- **Signed `.dmg`** needs Apple credentials in `sign.sh` (see `SIGNING.md`); the unsigned
  `.app` builds and runs today.

## Done / Roadmap

Most of the original roadmap shipped:

- ✅ **In-app key & provider management** — Providers panel; keys in `~/.compass/config.json`.
- ✅ **Add any custom OpenAI-compatible provider** — no release needed.
- ✅ **Anthropic-compatible endpoint** — Claude Code routes through Compass (`/v1/messages`).
- ✅ **Built-in chat panel** — use Compass directly in the dashboard.
- ✅ **Cross-provider failover** — retry the next provider on error (streaming + non-streaming).
- ✅ **Custom-provider auto-routing** — assign a custom provider to a tier.
- ✅ **Packaged desktop app** — self-contained `Compass.app` with a bundled gateway sidecar.

Remaining:

- **Signed, notarized `.dmg`** via `release.sh` (needs Apple creds in `sign.sh`).
- **OS-keychain** key storage (currently local plaintext).
- **Cross-protocol tool translation** so `/v1/messages` can route to non-Anthropic providers.

---

*Compass was built in a four-day autonomous sprint as an evaluation of the Claude Fable
model. The full spec, plan, and evaluation are in the project's Helm note.*
