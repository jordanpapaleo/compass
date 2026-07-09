/**
 * Ollama adapter — local models via Ollama's OpenAI-compatible endpoint.
 *
 * Keyless and free: enabled by setting OLLAMA_BASE_URL (normally
 * http://localhost:11434/v1). The served model is whatever the client asks
 * for via `ollama/<model>` passthrough, or OLLAMA_MODEL for tier routing.
 * This is the spec's "offline/local-first routing" — same factory as
 * openai/zai, pointed at localhost.
 */

import { createOpenAICompatAdapter } from "./openai-compat.ts";

export const ollamaAdapter = createOpenAICompatAdapter({
  name: "ollama",
  baseURLEnv: "OLLAMA_BASE_URL",
});
