import { describe, it, expect } from "vitest";
import { matchKey } from "../../src/ui/keys.js";
import type { Key } from "ink";

const k = (partial: Partial<Key>): Key => partial as Key;

describe("matchKey", () => {
  it("matches ctrl, alt, and esc bindings", () => {
    expect(matchKey("ctrl+k", "k", k({ ctrl: true }))).toBe(true);
    expect(matchKey("alt+t", "t", k({ meta: true }))).toBe(true);
    expect(matchKey("esc", "", k({ escape: true }))).toBe(true);
  });
  it("rejects wrong modifiers", () => {
    expect(matchKey("ctrl+k", "k", k({}))).toBe(false);
    expect(matchKey("alt+t", "t", k({ ctrl: true }))).toBe(false);
  });
});
