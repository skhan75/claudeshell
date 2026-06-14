/**
 * Per-model price table — PROJECTION ONLY. The SDK reports the real spend in
 * `total_cost_usd` (→ `Usage.costUsd`), and ALL meters/enforcement read that real value.
 * This table only powers "this fleet of 3 will cost ≈ $X" style estimates, so a stale
 * snapshot can at worst mislabel a projection — it can never mis-charge or wrongly block.
 *
 * Keyed by family prefix; longest-prefix wins, so a versioned id like "claude-opus-4-8"
 * resolves to the "claude-opus" row. Unknown ids fall back to the sonnet row.
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok?: number;
}

export const PRICING: Record<string, ModelPrice> = {
  "claude-opus": { inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, cacheWritePerMTok: 18.75 },
  "claude-sonnet": { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  "claude-haiku": { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
};

/** Sane default for ids without a family row (e.g. "claude-fable-5"): mid-tier sonnet. */
export const FALLBACK_PRICE: ModelPrice = PRICING["claude-sonnet"];

/** Resolve a model id to a price by longest matching family prefix; else FALLBACK. */
export function priceFor(model: string | undefined): ModelPrice {
  if (!model) return FALLBACK_PRICE;
  let best: { key: string; price: ModelPrice } | null = null;
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, price: PRICING[key] };
    }
  }
  return best?.price ?? FALLBACK_PRICE;
}

/** Projected USD for a token bundle at a model's rates. Pure — never reads Usage.costUsd. */
export function estimateCost(
  tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number },
  model: string | undefined,
): number {
  const p = priceFor(model);
  return (
    (tokens.inputTokens * p.inputPerMTok +
      tokens.outputTokens * p.outputPerMTok +
      tokens.cacheReadTokens * p.cacheReadPerMTok) /
    1_000_000
  );
}

/** Pre-spawn estimate: a small fixed per-worker token guess × n, for the "≈ $X" label. */
export function estimateSpawnCost(
  n: number,
  model: string | undefined,
  perWorkerTokens = { inputTokens: 8000, outputTokens: 4000, cacheReadTokens: 0 },
): number {
  return Math.max(0, n) * estimateCost(perWorkerTokens, model);
}
