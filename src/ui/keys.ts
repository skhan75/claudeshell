import type { Key } from "ink";

/** Match config bindings like "ctrl+k", "alt+t", "esc" against Ink useInput args. */
export function matchKey(binding: string, input: string, key: Key): boolean {
  const parts = binding.toLowerCase().split("+");
  const char = parts[parts.length - 1];
  if (char === "esc") return key.escape === true;
  const wantCtrl = parts.includes("ctrl");
  const wantAlt = parts.includes("alt");
  if ((key.ctrl ?? false) !== wantCtrl) return false;
  if ((key.meta ?? false) !== wantAlt) return false;
  return input.toLowerCase() === char;
}
