import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectSlug, searchHistory } from "../../src/core/history-search.js";

describe("history search", () => {
  it("derives Claude Code's project slug from cwd", () => {
    expect(projectSlug("/Users/sami/workspace/openshell")).toBe("-Users-sami-workspace-openshell");
  });

  it("finds matching user/assistant text in project JSONL transcripts", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-hist-"));
    const projDir = join(root, "projects", "-repo");
    mkdirSync(projDir, { recursive: true });
    const lines = [
      JSON.stringify({ type: "user", message: { role: "user", content: "refactor the JWT validation" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "I fixed the issuer check" }] } }),
      "not json at all",
    ].join("\n");
    writeFileSync(join(projDir, "abc.jsonl"), lines);

    const hits = searchHistory("/repo", "jwt", { claudeDir: root, limit: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("JWT validation");
  });

  it("returns empty for a missing project dir", () => {
    expect(searchHistory("/nope", "x", { claudeDir: "/does/not/exist" })).toEqual([]);
  });

  it("respects the limit across many matches", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-hist-"));
    const projDir = join(root, "projects", "-repo");
    mkdirSync(projDir, { recursive: true });
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ type: "user", message: { role: "user", content: `needle ${i}` } })
    ).join("\n");
    writeFileSync(join(projDir, "a.jsonl"), lines);
    expect(searchHistory("/repo", "needle", { claudeDir: root, limit: 4 })).toHaveLength(4);
  });

  // FIX 2 pinning: file-count cap (MAX_FILES=40) + newest-first ordering
  it("scans at most 40 files and searches newest first (oldest file beyond cap is not found)", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-hist-cap-"));
    const projDir = join(root, "projects", "-repo");
    mkdirSync(projDir, { recursive: true });

    // Create 50 files with staggered mtimes so newest-first ordering is deterministic.
    // file-00.jsonl is OLDEST (i=0), file-49.jsonl is NEWEST (i=49).
    // With MAX_FILES=40, files 0..9 (the 10 oldest) are NOT scanned.
    const baseTime = Date.now() - 50_000;
    for (let i = 0; i < 50; i++) {
      const path = join(projDir, `file-${String(i).padStart(2, "0")}.jsonl`);
      const content = i === 0
        ? JSON.stringify({ type: "user", message: { role: "user", content: "uniqueoldneedle only here" } })
        : JSON.stringify({ type: "user", message: { role: "user", content: `commonneedle entry ${i}` } });
      writeFileSync(path, content);
      const mtime = new Date(baseTime + i * 1000);
      utimesSync(path, mtime, mtime);
    }

    // The unique needle is ONLY in file-00 (the oldest, beyond the 40-file cap) — must NOT be found.
    const hitsOld = searchHistory("/repo", "uniqueoldneedle", { claudeDir: root, limit: 20 });
    expect(hitsOld).toHaveLength(0);

    // A needle in a recent file (i=49, the newest) IS found.
    const hitsNew = searchHistory("/repo", "commonneedle entry 49", { claudeDir: root, limit: 20 });
    expect(hitsNew.length).toBeGreaterThan(0);
    expect(hitsNew[0].text).toContain("commonneedle entry 49");
  });

  it("caps hits at the limit even when 50 files exist", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-hist-lim-"));
    const projDir = join(root, "projects", "-repo");
    mkdirSync(projDir, { recursive: true });

    // 50 files each with one matching line; limit=5 wins over the file count
    const baseTime = Date.now() - 50_000;
    for (let i = 0; i < 50; i++) {
      const path = join(projDir, `f-${String(i).padStart(2, "0")}.jsonl`);
      writeFileSync(path, JSON.stringify({ type: "user", message: { role: "user", content: `fileneedle item ${i}` } }));
      const mtime = new Date(baseTime + i * 1000);
      utimesSync(path, mtime, mtime);
    }

    const hits = searchHistory("/repo", "fileneedle", { claudeDir: root, limit: 5 });
    expect(hits).toHaveLength(5);
  });

  it("skips files larger than the size cap", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-hist-"));
    const projDir = join(root, "projects", "-repo");
    mkdirSync(projDir, { recursive: true });
    const bigLine = JSON.stringify({ type: "user", message: { role: "user", content: "needle " + "x".repeat(6_000_000) } });
    writeFileSync(join(projDir, "big.jsonl"), bigLine);
    expect(searchHistory("/repo", "needle", { claudeDir: root })).toEqual([]);
  });
});
