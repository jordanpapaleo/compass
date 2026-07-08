# Compass Gateway

The always-on local sidecar: an **OpenAI-compatible endpoint** that routes each
request to the right provider/model by **intent**, explains every decision, and
logs it. Raw provider SDKs only (`@anthropic-ai/sdk`, `openai`, `@google/genai`).

## Run

```bash
cd gateway
npm install
cp .env.example .env   # add at least one provider key
npm run dev            # http://localhost:4000 (COMPASS_PORT to change)
```

Requires Node ≥ 24 (runs TypeScript natively — no build step).

## Point any OpenAI-compatible client at it

```bash
curl http://localhost:4000/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "compass/auto",
    "messages": [{"role": "user", "content": "Write a commit message for: fixed null check in auth.ts"}]
  }'
```

The `model` field is the routing surface:

| Value | Behavior |
|---|---|
| `compass/auto` | Detect intent from the messages, route by rules |
| `compass/<intent>` | Force an intent, e.g. `compass/pr-review`, `compass/commit-message` |
| `claude-*`, `gpt-*`, `o*`, `gemini-*` | Passthrough to that provider verbatim |

Intents: `pr-review, pr-description, commit-message, coding, debugging,
planning, architecture, summarization, documentation, brainstorming, search, chat`.

`stream: true` is supported (OpenAI SSE chunk framing). Responses carry a
`compass` field with the routing decision, latency, and cost.

## Endpoints

| Route | What |
|---|---|
| `POST /v1/chat/completions` | OpenAI-compatible, routed + executed (+SSE) |
| `POST /v1/route` | Dry run — returns the routing decision only (works keyless) |
| `GET /v1/routing-log?limit=N` | Recent routing history (feeds the dashboard) |
| `GET /health` | Liveness + which providers have keys |

## Where things live

- Routing rules & tiers: `src/router.ts` · intent signals: `src/intent.ts`
- Models & pricing (one file, edit on model churn): `src/config.ts`
- Provider adapters: `src/providers/*.ts`
- Log: `~/.compass/routing-log.jsonl` (override: `COMPASS_DATA_DIR`)

## Test

```bash
npm test          # routing brain unit tests
npm run test:types
```
