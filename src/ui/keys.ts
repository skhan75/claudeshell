import type { Key } from "ink";

const KNOWN_MODIFIERS = new Set(["ctrl", "alt", "shift"]);

/** Match config bindings like "ctrl+k", "alt+t", "shift+k", "esc" against Ink useInput args.
 *
 * NOTE: Ink always sets key.meta=true when key.escape=true (by design — see use-input.js line 65).
 * Therefore the alt/meta check is skipped for the "esc" key to avoid false negatives.
 * Only ctrl and shift are checked against the esc key's modifiers.
 */
export function matchKey(binding: string, input: string, key: Key): boolean {
  const parts = binding.toLowerCase().split("+");
  const char = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  // Reject unknown modifier tokens
  for (const mod of modifiers) {
    if (!KNOWN_MODIFIERS.has(mod)) return false;
  }

  const wantCtrl = modifiers.includes("ctrl");
  const wantAlt = modifiers.includes("alt");
  const wantShift = modifiers.includes("shift");

  if ((key.ctrl ?? false) !== wantCtrl) return false;
  if ((key.shift ?? false) !== wantShift) return false;

  if (char === "esc") {
    // Skip the alt/meta check for esc: Ink always sets key.meta=true when key.escape=true,
    // so requiring wantAlt===key.meta would break plain "esc" bindings.
    return key.escape === true;
  }

  if ((key.meta ?? false) !== wantAlt) return false;
  return input.toLowerCase() === char;
}
