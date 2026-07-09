#!/usr/bin/env node
/**
 * Terminal chat, routed through Compass. Zero dependencies (uses built-in
 * fetch). Run the gateway first (cd gateway && npm run dev), then:
 *
 *   node examples/chat.mjs                 # interactive, compass/auto
 *   node examples/chat.mjs compass/coding  # force an intent
 *   node examples/chat.mjs ollama/qwen3:8b # a specific model
 *
 * Type a message and press enter. Ctrl-C to quit.
 */

import { createInterface } from "node:readline";

const GATEWAY = "http://localhost:4000/v1/chat/completions";
const model = process.argv[2] ?? "compass/auto";
const messages = [];

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`\n🧭 Compass chat — model "${model}" (Ctrl-C to quit)\n`);
rl.setPrompt("you › ");
rl.prompt();

rl.on("line", async (line) => {
  const text = line.trim();
  if (!text) return rl.prompt();

  messages.push({ role: "user", content: text });
  process.stdout.write("ai  › ");
  rl.pause(); // stop reading input while the model responds

  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: 1000 }),
    });

    let reply = "";
    let routedTo = "";
    // Parse the OpenAI-style SSE stream.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) {
        if (!l.startsWith("data: ")) continue;
        const data = l.slice(6);
        if (data === "[DONE]") continue;
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          reply += delta;
          process.stdout.write(delta);
        }
        if (chunk.compass) routedTo = `${chunk.compass.provider}/${chunk.compass.model}`;
      }
    }
    messages.push({ role: "assistant", content: reply });
    console.log(`\n      ↳ routed to ${routedTo}\n`);
  } catch (err) {
    console.log(`\n[gateway offline? ${err.message}]\n`);
  }
  rl.resume();
  rl.prompt();
});

rl.on("close", () => {
  console.log("\nbye 👋");
  process.exit(0);
});
