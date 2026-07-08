/**
 * OpenAI adapter — raw `openai` SDK.
 *
 * The gateway's public surface is already OpenAI-shaped, so this adapter is
 * nearly a passthrough. Temperature is forwarded when the client set one.
 */

import OpenAI from "openai";
import type { CompletionResult, ProviderAdapter } from "../types.ts";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  client ??= new OpenAI(); // reads OPENAI_API_KEY
  return client;
}

export const openaiAdapter: ProviderAdapter = {
  name: "openai",

  available() {
    return Boolean(process.env.OPENAI_API_KEY);
  },

  async complete(params): Promise<CompletionResult> {
    const response = await getClient().chat.completions.create({
      model: params.model,
      messages: params.messages,
      max_completion_tokens: params.maxTokens,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    });
    const choice = response.choices[0];
    return {
      text: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason ?? "stop",
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  },

  async *stream(params): AsyncGenerator<string, CompletionResult> {
    const stream = await getClient().chat.completions.create({
      model: params.model,
      messages: params.messages,
      max_completion_tokens: params.maxTokens,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      stream: true,
      stream_options: { include_usage: true },
    });

    let text = "";
    let finishReason = "stop";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        yield delta;
      }
      if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    return { text, finishReason, inputTokens, outputTokens };
  },
};
