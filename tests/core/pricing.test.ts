import { describe, it, expect } from "vitest";
import { priceFor, estimateCost, estimateSpawnCost, PRICING, FALLBACK_PRICE } from "../../src/core/pricing.js";

describe("pricing (projection-only)", () => {
  it("resolves model ids to a price by longest-prefix family", () => {
    expect(priceFor("claude-opus-4-8")).toBe(PRICING["claude-opus"]);
    expect(priceFor("claude-sonnet-4-6")).toBe(PRICING["claude-sonnet"]);
    expect(priceFor("claude-haiku-4-5")).toBe(PRICING["claude-haiku"]);
  });

  it("falls back for unknown / undefined ids without throwing", () => {
    expect(priceFor("claude-fable-5")).toBe(FALLBACK_PRICE);
    expect(priceFor(undefined)).toBe(FALLBACK_PRICE);
    expect(priceFor("totally-unknown")).toBe(FALLBACK_PRICE);
  });

  it("estimateCost prices each token bucket at the model's rate", () => {
    expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }, "claude-opus-4-8")).toBe(15);
    expect(estimateCost({ inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0 }, "claude-opus-4-8")).toBe(75);
    expect(estimateCost({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }, "claude-opus-4-8")).toBe(1.5);
    expect(estimateCost({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, "claude-opus-4-8")).toBe(0);
  });

  it("estimateSpawnCost scales the per-worker estimate by n (≥0)", () => {
    const per = estimateCost({ inputTokens: 8000, outputTokens: 4000, cacheReadTokens: 0 }, "claude-sonnet-4-6");
    expect(estimateSpawnCost(3, "claude-sonnet-4-6")).toBeCloseTo(3 * per, 10);
    expect(estimateSpawnCost(0, "claude-sonnet-4-6")).toBe(0);
    expect(estimateSpawnCost(-2, "claude-sonnet-4-6")).toBe(0);
  });
});
