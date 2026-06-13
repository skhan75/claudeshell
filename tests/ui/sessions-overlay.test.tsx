import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { SessionsOverlay } from "../../src/ui/SessionsOverlay.js";
import { renderWithCtx, makeCtx, tick, cleanupInk } from "./helpers.js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectSlug } from "../../src/core/history-search.js";

afterEach(cleanupInk);

/** Write a one-session .jsonl into <claudeDir>/projects/<slug(cwd)>/<id>.jsonl. */
function seedSession(claudeDir: string, cwd: string, id: string, firstUserText: string): void {
  const projDir = join(claudeDir, "projects", projectSlug(cwd));
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, `${id}.jsonl`),
    JSON.stringify({ type: "user", message: { role: "user", content: firstUserText } }) +
      "\n" +
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "ok" } }) +
      "\n"
  );
}

describe("SessionsOverlay", () => {
  it("lists a saved session's title and preview details", () => {
    const ctx = makeCtx();
    const claudeDir = mkdtempSync(join(tmpdir(), "cs-claude-"));
    seedSession(claudeDir, ctx.manager.active!.cwd, "abc123", "fix the jwt bug");

    const { lastFrame } = renderWithCtx(<SessionsOverlay onClose={() => {}} claudeDir={claudeDir} />, ctx);
    const frame = lastFrame()!;
    expect(frame).toContain("SAVED SESSIONS");
    expect(frame).toContain("fix the jwt bug");
    // Preview pane shows the session id + a message count.
    expect(frame).toContain("abc123");
    expect(frame).toContain("messages");
  });

  it("Enter resumes the highlighted session in a new tab", async () => {
    const ctx = makeCtx();
    const claudeDir = mkdtempSync(join(tmpdir(), "cs-claude-"));
    seedSession(claudeDir, ctx.manager.active!.cwd, "abc123", "fix the jwt bug");

    const before = ctx.manager.sessions.length;
    let closed = false;
    const { stdin } = renderWithCtx(
      <SessionsOverlay onClose={() => (closed = true)} claudeDir={claudeDir} />,
      ctx
    );
    await tick();
    stdin.write("\r"); // resume highlighted
    await tick();

    expect(ctx.manager.sessions.length).toBe(before + 1);
    const newTab = ctx.manager.active!;
    expect(newTab.title).toBe("fix the jwt bug");
    expect(newTab.claudeSessionId).toBe("abc123");
    expect(closed).toBe(true);
  });

  it("shows an empty state when no sessions exist for the project", () => {
    const ctx = makeCtx();
    const claudeDir = mkdtempSync(join(tmpdir(), "cs-claude-empty-"));
    const { lastFrame } = renderWithCtx(<SessionsOverlay onClose={() => {}} claudeDir={claudeDir} />, ctx);
    const frame = lastFrame()!;
    expect(frame).toContain("SAVED SESSIONS");
    expect(frame).toContain("No saved sessions for this project yet.");
  });
});
