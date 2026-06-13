import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { PermissionDialog, QuestionDialog } from "../../src/ui/dialogs.js";
import { renderWithCtx, tick, cleanupInk } from "./helpers.js";
import type { PermissionRequest, PermissionResult } from "../../src/core/types.js";

afterEach(cleanupInk);

function makeRequest(over: Partial<PermissionRequest> = {}) {
  const resolved: PermissionResult[] = [];
  const request: PermissionRequest = {
    id: "perm-test",
    toolName: "Bash",
    input: { command: "rm -rf /tmp/x" },
    suggestions: [
      { destination: "session", kind: "a" },
      { destination: "localSettings", kind: "b" },
    ],
    resolve: (r) => resolved.push(r),
    ...over,
  };
  return { request, resolved };
}

describe("PermissionDialog", () => {
  it("y allows once with the original input", async () => {
    const { request, resolved } = makeRequest();
    const { stdin, lastFrame } = renderWithCtx(<PermissionDialog request={request} />);
    await tick();
    expect(lastFrame()).toContain("Bash");
    expect(lastFrame()).toContain("rm -rf /tmp/x");
    stdin.write("y");
    await tick();
    expect(resolved[0]).toMatchObject({ behavior: "allow", updatedInput: { command: "rm -rf /tmp/x" } });
  });

  it("a allows and persists the localSettings suggestion", async () => {
    const { request, resolved } = makeRequest();
    const { stdin } = renderWithCtx(<PermissionDialog request={request} />);
    await tick();
    stdin.write("a");
    await tick();
    const r = resolved[0] as Extract<PermissionResult, { behavior: "allow" }>;
    expect(r.updatedPermissions).toEqual([{ destination: "localSettings", kind: "b" }]);
  });

  it("n + typed reason denies with that message", async () => {
    const { request, resolved } = makeRequest();
    const { stdin } = renderWithCtx(<PermissionDialog request={request} />);
    await tick();
    stdin.write("n");
    await tick();
    stdin.write("use trash instead");
    await tick();
    stdin.write("\r");
    await tick();
    expect(resolved[0]).toMatchObject({ behavior: "deny", message: "use trash instead" });
  });
});

describe("QuestionDialog", () => {
  it("answers a single-select question with the chosen label", async () => {
    const { request, resolved } = makeRequest({
      toolName: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Which DB?",
            header: "DB",
            options: [{ label: "Postgres", description: "relational" }, { label: "SQLite", description: "embedded" }],
            multiSelect: false,
          },
        ],
      },
    });
    const { stdin, lastFrame } = renderWithCtx(<QuestionDialog request={request} />);
    await tick();
    expect(lastFrame()).toContain("Which DB?");
    stdin.write("j"); // move to SQLite
    await tick();
    stdin.write("\r");
    await tick();
    const r = resolved[0] as Extract<PermissionResult, { behavior: "allow" }>;
    expect((r.updatedInput.answers as Record<string, string>)["Which DB?"]).toBe("SQLite");
    expect(r.updatedInput.questions).toBeDefined();
  });

  it("joins multi-select answers with a comma", async () => {
    const { request, resolved } = makeRequest({
      toolName: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Which sections?",
            header: "Sections",
            options: [{ label: "Intro" }, { label: "Body" }, { label: "Outro" }],
            multiSelect: true,
          },
        ],
      },
    });
    const { stdin } = renderWithCtx(<QuestionDialog request={request} />);
    await tick();
    stdin.write(" ");      // check Intro
    await tick();
    stdin.write("j");
    await tick();
    stdin.write(" ");      // check Body
    await tick();
    stdin.write("\r");
    await tick();
    const r = resolved[0] as Extract<PermissionResult, { behavior: "allow" }>;
    expect((r.updatedInput.answers as Record<string, string>)["Which sections?"]).toBe("Intro, Body");
  });

  it("a second request gets a fresh dialog (keyed remount, no stale state)", async () => {
    // simulate App's keyed rendering with two sequential requests
    const first = makeRequest({
      toolName: "AskUserQuestion",
      input: { questions: [{ question: "Q1?", header: "A", options: [{ label: "x" }, { label: "y" }], multiSelect: false }] },
    });
    (first.request as { id: string }).id = "perm-1";
    const second = makeRequest({
      toolName: "AskUserQuestion",
      input: { questions: [{ question: "Q2?", header: "B", options: [{ label: "p" }, { label: "q" }], multiSelect: false }] },
    });
    (second.request as { id: string }).id = "perm-2";

    const r1 = renderWithCtx(<QuestionDialog key={first.request.id} request={first.request} />);
    await tick();
    r1.stdin.write("j");
    await tick();
    r1.rerender(<QuestionDialog key={second.request.id} request={second.request} />);
    await tick();
    expect(r1.lastFrame()).toContain("Q2?");
    r1.stdin.write("\r"); // selection must be reset to index 0 → "p"
    await tick();
    const resolved = second.resolved[0] as Extract<PermissionResult, { behavior: "allow" }>;
    expect((resolved.updatedInput.answers as Record<string, string>)["Q2?"]).toBe("p");
  });

  it("does not crash on a zero-option question", async () => {
    const { request, resolved } = makeRequest({
      toolName: "AskUserQuestion",
      input: { questions: [{ question: "Empty?", header: "E", options: [], multiSelect: false }] },
    });
    const { stdin } = renderWithCtx(<QuestionDialog request={request} />);
    await tick();
    stdin.write("\r");
    await tick();
    const r = resolved[0] as Extract<PermissionResult, { behavior: "allow" }>;
    expect((r.updatedInput.answers as Record<string, string>)["Empty?"]).toBe("");
  });

  it("resolves empty-questions requests automatically", async () => {
    const { request, resolved } = makeRequest({ toolName: "AskUserQuestion", input: { questions: [] } });
    renderWithCtx(<QuestionDialog request={request} />);
    await tick();
    expect(resolved).toHaveLength(1);
  });
});

describe("PermissionDialog — pinning tests", () => {
  it("trigger characters are typable inside a deny reason", async () => {
    const { request, resolved } = makeRequest();
    const { stdin } = renderWithCtx(<PermissionDialog request={request} />);
    await tick();
    stdin.write("n");
    await tick();
    stdin.write("yo nano");
    await tick();
    stdin.write("\r");
    await tick();
    expect(resolved[0]).toMatchObject({ behavior: "deny", message: "yo nano" });
  });

  it("rapid double-keys resolve exactly once", async () => {
    const { request, resolved } = makeRequest();
    const { stdin } = renderWithCtx(<PermissionDialog request={request} />);
    await tick();
    stdin.write("y");
    stdin.write("y"); // second event before any re-render
    await tick();
    expect(resolved).toHaveLength(1);
  });

  it("a pasted multi-char chunk does not trigger permission keys", async () => {
    const { request, resolved } = makeRequest();
    const { stdin } = renderWithCtx(<PermissionDialog request={request} />);
    await tick();
    stdin.write("yes do it"); // paste-like chunk — must NOT resolve
    await tick();
    expect(resolved).toHaveLength(0);
  });
});
