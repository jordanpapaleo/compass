# Using Compass — concrete examples

**The universal rule:** any tool that lets you set a *custom OpenAI endpoint* works
with Compass. It's always the same three values:

| Setting | Value |
|---|---|
| Base URL / API base | `http://localhost:4000/v1` |
| API key | anything (Compass ignores it; it holds the real keys) |
| Model | `compass/auto` (or `compass/<intent>`, or a specific model) |

Start the gateway first: `cd gateway && npm run dev`.

---

## Runnable examples in this folder (tested)

```bash
# One-shot question — prints the answer + where it routed
node examples/ask.mjs "Write a commit message for adding retries"
node examples/ask.mjs "Design a cache layer" compass/architecture
node examples/ask.mjs "hello" ollama/qwen3:8b

# Interactive terminal chat (streams the reply)
node examples/chat.mjs                 # compass/auto
node examples/chat.mjs compass/coding  # force an intent

# Python, with the official OpenAI SDK
pip install openai && python examples/basic.py
```

No dependencies for the `.mjs` ones — plain Node ≥ 24.

---

## Your own code

**Node / TypeScript** (`npm install openai`):
```js
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "http://localhost:4000/v1", apiKey: "unused" });
const r = await client.chat.completions.create({
  model: "compass/auto",
  messages: [{ role: "user", content: "Explain a bloom filter" }],
});
console.log(r.choices[0].message.content);
```

**curl** (handy for testing):
```bash
curl http://localhost:4000/v1/chat/completions -H 'content-type: application/json' -d '{
  "model": "compass/auto",
  "messages": [{"role":"user","content":"Review this PR"}]
}'
```

---

## Real tools

### Cursor (the editor)
Settings → **Models** → scroll to "OpenAI API Key" section → enable **Override OpenAI
Base URL** → set it to `http://localhost:4000/v1`. Put any string as the API key. Add a
custom model named `compass/auto`. Now Cursor's chat and inline edits route through
Compass.

### A chat UI in your browser — Open WebUI
Want a ChatGPT-style window backed by Compass? [Open WebUI](https://openwebui.com) is a
self-hosted chat app that connects to any OpenAI-compatible endpoint:
```bash
docker run -d -p 3000:8080 --name open-webui ghcr.io/open-webui/open-webui:main
```
Open `http://localhost:3000` → Settings → **Connections** → add an OpenAI connection:
base URL `http://localhost:4000/v1`, any API key. Then pick `compass/auto` as the model
and chat. (This is the closest thing to "a place to just use Compass" until the built-in
chat panel lands.)

> On macOS, `host.docker.internal:4000` instead of `localhost:4000` if the container
> can't reach the gateway.

### Terminal coding agent — Aider
```bash
export OPENAI_API_BASE=http://localhost:4000/v1
export OPENAI_API_KEY=unused
aider --model openai/compass/auto
```

### Editors & agents with a custom-endpoint setting
These all have an "OpenAI base URL" / "custom provider" field — point it at
`http://localhost:4000/v1`, any key, model `compass/auto`:

- **Continue.dev** (VS Code / JetBrains) — add a model with provider `openai` and
  `apiBase: http://localhost:4000/v1`
- **Zed** — Assistant settings → OpenAI-compatible provider → set the API URL
- **Cline / Roo Code** (VS Code) — API provider "OpenAI Compatible" → base URL + model

If a tool speaks the OpenAI API and lets you change where it points, it works. If it's
hardwired to `api.openai.com` with no override, it won't.

---

## What you get back

Every response carries a nonstandard `compass` field with the routing decision, cost,
and latency — that's how `ask.mjs` prints `↳ anthropic/claude-haiku-4-5 · commit-message
· $0.00022 · 1328ms`. Standard clients ignore the extra field; Compass-aware ones (like
these examples) can show it.

Watch all of it live in the dashboard's Routing Log.
