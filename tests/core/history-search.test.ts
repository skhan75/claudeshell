import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectSlug, searchHistory } from "../../src/core/history-search.js";

describe("history search", () => {
  it("derives Claude Code's project slug from cwd", () => {
    expect(projectSlug("/Users/sami/workspace/claudeshell")).toBe("-Users-sami-workspace-claudeshell");
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
});
