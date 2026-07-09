/**
 * Z.ai adapter — GLM models (open weights, MIT) via Z.ai's hosted API.
 *
 * Z.ai's API is natively OpenAI-compatible; their docs specify using the
 * OpenAI SDK with a swapped base URL. Verified 2026-07-08 from docs.z.ai:
 * base `https://api.z.ai/api/paas/v4/`, Bearer auth, model id `glm-5.2`.
 */

import { createOpenAICompatAdapter } from "./openai-compat.ts";

export const zaiAdapter = createOpenAICompatAdapter({
  name: "zai",
  apiKeyEnv: "ZAI_API_KEY",
  baseURL: "https://api.z.ai/api/paas/v4/",
});
