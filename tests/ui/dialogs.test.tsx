import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { PermissionDialog, QuestionDialog } from "../../src/ui/dialogs.js";
import { renderWithCtx, tick, cleanupInk } from "./helpers.js";
import type { PermissionRequest, PermissionResult } from "../../src/core/types.js";

afterEach(cleanupInk);

function makeRequest(over: Partial<PermissionRequest> = {}) {
  const resolved: PermissionResult[] = [];
  const request: PermissionRequest = {
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
});
