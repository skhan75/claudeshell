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

  // FIX 4 pinning tests: shift support, esc with modifiers, unknown token rejection
  it("shift support: shift+k requires shift=true", () => {
    expect(matchKey("shift+k", "k", k({}))).toBe(false);
    expect(matchKey("shift+k", "k", k({ shift: true }))).toBe(true);
  });

  it("ctrl+esc requires both ctrl and escape", () => {
    // bare esc without ctrl should not match ctrl+esc
    expect(matchKey("ctrl+esc", "", k({ escape: true }))).toBe(false);
    // ctrl+esc requires ctrl=true AND escape=true
    expect(matchKey("ctrl+esc", "", k({ ctrl: true, escape: true }))).toBe(true);
  });

  it("rejects unknown modifier tokens", () => {
    // 'cmd' is not a known modifier — must return false
    expect(matchKey("cmd+k", "k", k({ ctrl: true }))).toBe(false);
    expect(matchKey("win+k", "k", k({}))).toBe(false);
  });

  it("plain esc still matches without modifiers", () => {
    expect(matchKey("esc", "", k({ escape: true }))).toBe(true);
    expect(matchKey("esc", "", k({ escape: true, ctrl: false, meta: false, shift: false }))).toBe(true);
  });

  it("default bindings (ctrl+k, alt+t, esc, ctrl+o) still match", () => {
    expect(matchKey("ctrl+k", "k", k({ ctrl: true }))).toBe(true);
    expect(matchKey("alt+t", "t", k({ meta: true }))).toBe(true);
    expect(matchKey("esc", "", k({ escape: true }))).toBe(true);
    expect(matchKey("ctrl+o", "o", k({ ctrl: true }))).toBe(true);
  });
});
