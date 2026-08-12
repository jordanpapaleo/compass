import { describe, expect, it } from "vitest";
import { PRICING, PROVIDER_MODELS, TIER_MODELS } from "./config.ts";

describe("model catalog", () => {
  it("lists every tier model — a tier model missing here loses its Gateway chip", () => {
    for (const [provider, tiers] of Object.entries(TIER_MODELS)) {
      const catalog = PROVIDER_MODELS[provider as keyof typeof PROVIDER_MODELS];
      for (const model of Object.values(tiers)) {
        expect(catalog, `${provider}/${model}`).toContain(model);
      }
    }
  });

  it("prices every Anthropic model in the catalog", () => {
    // Anthropic ids and pricing are the verified set; other providers may carry
    // unpriced entries on purpose (cost is reported null rather than guessed).
    for (const model of PROVIDER_MODELS.anthropic) {
      expect(PRICING[model], model).toBeDefined();
    }
  });

  it("keeps the previous-generation Opus reachable after the tier moved to Opus 5", () => {
    expect(TIER_MODELS.anthropic.premium).toBe("claude-opus-5");
    expect(PROVIDER_MODELS.anthropic).toContain("claude-opus-4-8");
  });
});
