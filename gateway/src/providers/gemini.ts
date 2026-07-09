/**
 * Gemini adapter — raw @google/genai SDK.
 *
 * Message mapping: OpenAI roles → Gemini contents. Gemini uses "model" for
 * assistant turns and takes the system prompt as `systemInstruction`.
 */

import { GoogleGenAI } from "@google/genai";
import type { CompletionParams, CompletionResult, ProviderAdapter } from "../types.ts";

let client: GoogleGenAI | null = null;

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
}

function getClient(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: apiKey() });
  return client;
}

function toGemini(params: CompletionParams) {
  const system = params.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const contents = params.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));

  return {
    model: params.model,
    contents,
    config: {
      maxOutputTokens: params.maxTokens,
      ...(system ? { systemInstruction: system } : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    },
  };
}

export const geminiAdapter: ProviderAdapter = {
  name: "gemini",

  available() {
    return Boolean(apiKey());
  },

  reset() {
    client = null;
  },

  async complete(params): Promise<CompletionResult> {
    const response = await getClient().models.generateContent(toGemini(params));
    return {
      text: response.text ?? "",
      finishReason: response.candidates?.[0]?.finishReason ?? "stop",
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },

  async *stream(params): AsyncGenerator<string, CompletionResult> {
    const stream = await getClient().models.generateContentStream(toGemini(params));

    let text = "";
    let finishReason = "stop";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.text;
      if (delta) {
        text += delta;
        yield delta;
      }
      if (chunk.candidates?.[0]?.finishReason) {
        finishReason = chunk.candidates[0].finishReason;
      }
      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
    }

    return { text, finishReason, inputTokens, outputTokens };
  },
};
