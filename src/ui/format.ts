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

/** Group a number with thousands separators, e.g. 36892 → "36,892". */
export function fmtComma(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Format a USD amount: cents precision normally, finer for sub-cent costs. */
export function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 0.01) return "$" + n.toFixed(4);
  return "$" + n.toFixed(2);
}

/** Human-readable byte size, e.g. 12000 → "12kb", 1500000 → "1.4mb". */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1000) return `${n}b`;
  if (n < 1_000_000) return `${Math.round(n / 1024)}kb`;
  return `${(n / 1_048_576).toFixed(1)}mb`;
}

/** A single-width glyph hinting a file's kind, by extension. */
export function fileIcon(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (["json"].includes(ext)) return "{}";
  if (["yml", "yaml", "toml", "ini", "env", "conf", "cfg"].includes(ext)) return "⚙";
  if (["md", "mdx", "txt", "rst"].includes(ext)) return "¶";
  if (
    ["go", "ts", "tsx", "js", "jsx", "py", "rs", "rb", "java", "c", "h", "cpp", "cc", "cs", "php", "swift", "kt", "sh"].includes(ext)
  )
    return "λ";
  return "›";
}

/** Rough context meter denominator; refined later if model metadata exposes it. */
export const CONTEXT_WINDOW = 200_000;
