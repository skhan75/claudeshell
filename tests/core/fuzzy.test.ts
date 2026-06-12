import { describe, it, expect } from "vitest";
import { fuzzyFilter } from "../../src/core/fuzzy.js";

describe("fuzzyFilter", () => {
  const items = ["fix tests", "toggle layout", "new session", "switch model"];

  it("matches subsequences and excludes non-matches", () => {
    const out = fuzzyFilter(items, "ts", (s) => s);
    expect(out).toContain("fix tests");
    expect(out).not.toContain("switch model");
  });

  it("ranks consecutive matches above scattered ones", () => {
    const out = fuzzyFilter(["t-e-s-t", "test"], "test", (s) => s);
    expect(out[0]).toBe("test");
  });

  it("empty query returns all items in original order", () => {
    expect(fuzzyFilter(items, "", (s) => s)).toEqual(items);
  });

  it("non-matching query returns empty", () => {
    expect(fuzzyFilter(items, "zzz", (s) => s)).toEqual([]);
  });

  it("prefers prefix matches", () => {
    const out = fuzzyFilter(["abc", "xaxbxc"], "abc", (s) => s);
    expect(out[0]).toBe("abc");
  });
});
