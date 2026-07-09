#!/usr/bin/env node
/**
 * One-shot: ask Compass a single question from the command line. Zero deps.
 *
 *   node examples/ask.mjs "Write a commit message for adding retries"
 *   node examples/ask.mjs "Design a cache" compass/architecture
 *   node examples/ask.mjs "hello" ollama/qwen3:8b
 *
 * Prints the answer, then which model Compass routed it to.
 */

const prompt = process.argv[2];
const model = process.argv[3] ?? "compass/auto";

if (!prompt) {
  console.error('usage: node examples/ask.mjs "your question" [model]');
  process.exit(1);
}

const res = await fetch("http://localhost:4000/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1000,
  }),
});

const data = await res.json();
if (data.error) {
  console.error(`error: ${data.error.message}`);
  process.exit(1);
}

console.log(data.choices[0].message.content.trim());
const c = data.compass;
if (c) {
  const cost = c.cost_usd != null ? `$${c.cost_usd.toFixed(5)}` : "n/a";
  console.log(`\n↳ ${c.provider}/${c.model} · ${c.intent} · ${cost} · ${c.latency_ms}ms`);
}
