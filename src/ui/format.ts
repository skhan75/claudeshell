export function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

export function fmtUptime(sec: number): string {
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

export function bar(pct: number, width: number): string {
  const p = Number.isFinite(pct) ? pct : 0;
  const filled = Math.round((Math.max(0, Math.min(100, p)) / 100) * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

/** Rough context meter denominator; refined later if model metadata exposes it. */
export const CONTEXT_WINDOW = 200_000;
