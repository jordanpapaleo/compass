/**
 * Anthropic adapter — raw @anthropic-ai/sdk.
 *
 * Notes:
 *  - OpenAI-shape `system` messages map to Anthropic's top-level `system`.
 *  - Current-gen models (Opus 4.7+, Sonnet 5, Fable) REJECT temperature/top_p
 *    with a 400 — we never forward sampling params to Anthropic. Prompting is
 *    the steering mechanism on these models.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { CompletionParams, CompletionResult, ProviderAdapter } from "../types.ts";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

function toAnthropic(params: CompletionParams) {
  const system = params.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const messages = params.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  return {
    model: params.model,
    max_tokens: params.maxTokens,
    ...(system ? { system } : {}),
    messages,
  };
}

export const anthropicAdapter: ProviderAdapter = {
  name: "anthropic",

  available() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  async complete(params): Promise<CompletionResult> {
    const response = await getClient().messages.create(toAnthropic(params));
    const text = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      finishReason: response.stop_reason ?? "stop",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  },

  async *stream(params): AsyncGenerator<string, CompletionResult> {
    const stream = getClient().messages.stream(toAnthropic(params));
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
    const final = await stream.finalMessage();
    const text = final.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      finishReason: final.stop_reason ?? "stop",
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
    };
  },
};
