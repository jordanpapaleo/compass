/** OpenAI adapter — the OpenAI-protocol factory pointed at api.openai.com. */

import { createOpenAICompatAdapter } from "./openai-compat.ts";

export const openaiAdapter = createOpenAICompatAdapter({
  name: "openai",
  apiKeyEnv: "OPENAI_API_KEY",
});
