import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listProjectSessions } from "../../src/core/sessions-index.js";

function makeRoot(): { root: string; projDir: string } {
  const root = mkdtempSync(join(tmpdir(), "cs-si-"));
  const projDir = join(root, "projects", "-repo");
  mkdirSync(projDir, { recursive: true });
  return { root, projDir };
}

function userLine(text: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: text } });
}
function assistantLine(text: string): string {
  return JSON.stringify({ type: "assistant", message: { role: "assistant", content: text } });
}
function systemLine(text: string): string {
  return JSON.stringify({ type: "system", message: { content: text } });
}

describe("listProjectSessions", () => {
  it("returns [] for a missing project dir", () => {
    expect(listProjectSessions("/nope", { claudeDir: "/does/not/exist" })).toEqual([]);
  });

  it("lists sessions newest-first with title from first user message and correct messageCount", () => {
    const { root, projDir } = makeRoot();

    // session A — older
    const linesA = [
      userLine("Hello from session A"),
      assistantLine("Response A1"),
      userLine("Second user message A"),
    ].join("\n");
    writeFileSync(join(projDir, "session-a.jsonl"), linesA);
    const oldTime = new Date(Date.now() - 10_000);
    utimesSync(join(projDir, "session-a.jsonl"), oldTime, oldTime);

    // session B — newer
    const linesB = [
      userLine("Hello from session B"),
      assistantLine("Response B1"),
    ].join("\n");
    writeFileSync(join(projDir, "session-b.jsonl"), linesB);
    const newTime = new Date(Date.now() - 1_000);
    utimesSync(join(projDir, "session-b.jsonl"), newTime, newTime);

    const sessions = listProjectSessions("/repo", { claudeDir: root });

    expect(sessions).toHaveLength(2);
    // Newest first
    expect(sessions[0].sessionId).toBe("session-b");
    expect(sessions[1].sessionId).toBe("session-a");

    // Titles from first user message
    expect(sessions[0].title).toBe("Hello from session B");
    expect(sessions[1].title).toBe("Hello from session A");

    // messageCount: B has 1 user + 1 assistant = 2; A has 2 user + 1 assistant = 3
    expect(sessions[0].messageCount).toBe(2);
    expect(sessions[1].messageCount).toBe(3);

    // file is the basename
    expect(sessions[0].file).toBe("session-b.jsonl");
    expect(sessions[1].file).toBe("session-a.jsonl");

    // sessionId = filename without .jsonl
    expect(sessions[0].sessionId).toBe("session-b");
  });

  it("extracts the first USER message as title even when earlier lines are non-user types", () => {
    const { root, projDir } = makeRoot();

    const lines = [
      systemLine("Some system preamble"),
      assistantLine("Assistant speaks first"),
      userLine("Finally the user speaks"),
    ].join("\n");
    writeFileSync(join(projDir, "mixed.jsonl"), lines);

    const sessions = listProjectSessions("/repo", { claudeDir: root });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("Finally the user speaks");
  });

  it("uses (empty session) for a session with no user messages", () => {
    const { root, projDir } = makeRoot();

    const lines = [
      assistantLine("Just the assistant"),
      systemLine("And system"),
    ].join("\n");
    writeFileSync(join(projDir, "no-user.jsonl"), lines);

    const sessions = listProjectSessions("/repo", { claudeDir: root });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("(empty session)");
  });

  it("elides long titles to ~60 chars with an ellipsis", () => {
    const { root, projDir } = makeRoot();

    const longText = "This is a very long user message that exceeds sixty characters easily and should be truncated";
    writeFileSync(join(projDir, "long.jsonl"), userLine(longText));

    const sessions = listProjectSessions("/repo", { claudeDir: root });
    expect(sessions[0].title.length).toBeLessThanOrEqual(61); // 60 chars + "…"
    expect(sessions[0].title.endsWith("…")).toBe(true);
  });

  it("respects the limit option", () => {
    const { root, projDir } = makeRoot();

    const baseTime = Date.now() - 10_000;
    for (let i = 0; i < 10; i++) {
      const path = join(projDir, `s-${String(i).padStart(2, "0")}.jsonl`);
      writeFileSync(path, userLine(`Message ${i}`));
      const mtime = new Date(baseTime + i * 1000);
      utimesSync(path, mtime, mtime);
    }

    const sessions = listProjectSessions("/repo", { claudeDir: root, limit: 3 });
    expect(sessions).toHaveLength(3);
  });

  it("skips files larger than the 5 MB cap", () => {
    const { root, projDir } = makeRoot();

    const bigContent = userLine("needle " + "x".repeat(6_000_000));
    writeFileSync(join(projDir, "big.jsonl"), bigContent);

    const sessions = listProjectSessions("/repo", { claudeDir: root });
    expect(sessions).toHaveLength(0);
  });

  it("handles content as array of text blocks for title extraction", () => {
    const { root, projDir } = makeRoot();

    const arrayContent = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "from blocks" },
        ],
      },
    });
    writeFileSync(join(projDir, "blocks.jsonl"), arrayContent);

    const sessions = listProjectSessions("/repo", { claudeDir: root });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("Hello  from blocks");
  });

  it("skips malformed JSON lines without throwing", () => {
    const { root, projDir } = makeRoot();

    const lines = [
      "not json at all",
      "{broken",
      userLine("Good message after bad lines"),
    ].join("\n");
    writeFileSync(join(projDir, "malformed.jsonl"), lines);

    const sessions = listProjectSessions("/repo", { claudeDir: root });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("Good message after bad lines");
  });
});
