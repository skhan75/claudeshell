import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listProjectFiles, listProjectFilesCached } from "../../src/core/files.js";

describe("listProjectFiles", () => {
  it("lists files, skips node_modules, does not follow symlinked dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-files-"));
    writeFileSync(join(root, "a.ts"), "");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "b.ts"), "");
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "skip.js"), "");
    symlinkSync(root, join(root, "loop")); // cycle: root/loop -> root
    const files = listProjectFiles(root);
    expect(files).toContain("a.ts");
    expect(files).toContain(join("src", "b.ts"));
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    expect(files.some((f) => f.startsWith("loop"))).toBe(false);
  });

  it("cached variant returns the identical array within the TTL", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-files-"));
    writeFileSync(join(root, "a.ts"), "");
    const first = listProjectFilesCached(root);
    const second = listProjectFilesCached(root);
    expect(second).toBe(first);
  });
});
