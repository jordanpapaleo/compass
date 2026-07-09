/**
 * Factory for OpenAI-protocol providers.
 *
 * The `openai` SDK speaks the wire protocol; the factory parameterizes base
 * URL + key so any OpenAI-compatible service becomes a Compass provider:
 * OpenAI itself, Z.ai (GLM — their docs specify the OpenAI SDK with a swapped
 * base URL), and later local runtimes (Ollama / LM Studio) the same way.
 */

import OpenAI from "openai";
import type { CompletionParams, CompletionResult, ProviderAdapter, ProviderName } from "../types.ts";

export interface OpenAICompatConfig {
  name: ProviderName;
  /** Env var holding the API key. */
  apiKeyEnv: string;
  /** Omit for api.openai.com. */
  baseURL?: string;
}

export function createOpenAICompatAdapter(cfg: OpenAICompatConfig): ProviderAdapter {
  let client: OpenAI | null = null;

  const getClient = (): OpenAI => {
    client ??= new OpenAI({
      apiKey: process.env[cfg.apiKeyEnv],
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    });
    return client;
  };

  return {
    name: cfg.name,

    available() {
      return Boolean(process.env[cfg.apiKeyEnv]);
    },

    async complete(params: CompletionParams): Promise<CompletionResult> {
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

    async *stream(params: CompletionParams): AsyncGenerator<string, CompletionResult> {
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
}
