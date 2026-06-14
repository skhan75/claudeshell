import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { ReviewOverlay } from "../../src/ui/ReviewOverlay.js";
import { Review, type GitRun } from "../../src/core/review.js";
import type { Terminal } from "../../src/core/terminal.js";
import { makeCtx, renderWithCtx, cleanupInk, tick } from "./helpers.js";

afterEach(cleanupInk);

/** Two changed files with distinct diffs, served from a fake git. */
function twoFileRunner(): Review {
  const run: GitRun = async (args) => {
    if (args[0] === "rev-parse") return "/repo\n";
    if (args[0] === "status") return " M src/a.ts\0 M src/b.ts\0";
    if (args[0] === "diff" && args.includes("src/a.ts")) return ["diff --git a/src/a.ts b/src/a.ts", "@@ -1 +1,2 @@", "+alpha", "-old"].join("\n");
    if (args[0] === "diff" && args.includes("src/b.ts")) return ["diff --git a/src/b.ts b/src/b.ts", "@@ -5 +5,2 @@", "+beta"].join("\n");
    return "";
  };
  return new Review("/repo", run);
}

const settle = async () => {
  await tick();
  await tick();
};

describe("ReviewOverlay", () => {
  it("lists changed files and shows the selected file's diff", async () => {
    const ctx = makeCtx();
    const { lastFrame } = renderWithCtx(<ReviewOverlay onClose={() => {}} runner={twoFileRunner()} />, ctx);
    await settle();
    const frame = lastFrame()!;
    expect(frame).toContain("REVIEW");
    expect(frame).toContain("a.ts");
    expect(frame).toContain("alpha"); // first file's diff is shown by default
  });

  it("j moves the selection to the next file's diff", async () => {
    const ctx = makeCtx();
    const { stdin, lastFrame } = renderWithCtx(<ReviewOverlay onClose={() => {}} runner={twoFileRunner()} />, ctx);
    await settle();
    stdin.write("j");
    await tick();
    expect(lastFrame()).toContain("beta");
  });

  it("e opens the selected file in $EDITOR at the first hunk and closes", async () => {
    const ctx = makeCtx();
    const spy = vi.spyOn(ctx.manager, "openInEditor").mockReturnValue({} as Terminal);
    const onClose = vi.fn();
    const { stdin } = renderWithCtx(<ReviewOverlay onClose={onClose} runner={twoFileRunner()} />, ctx);
    await settle();
    stdin.write("e");
    await tick();
    expect(spy).toHaveBeenCalledWith("/repo/src/a.ts", 1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("s stages the selected file (records the add argv) and reloads", async () => {
    const calls: string[][] = [];
    const run: GitRun = async (args) => {
      calls.push(args);
      if (args[0] === "rev-parse") return "/repo\n";
      if (args[0] === "status") return " M src/a.ts\0";
      if (args[0] === "diff") return "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n+x";
      return "";
    };
    const ctx = makeCtx();
    const { stdin } = renderWithCtx(<ReviewOverlay onClose={() => {}} runner={new Review("/repo", run)} />, ctx);
    await settle();
    stdin.write("s");
    await settle();
    expect(calls.some((c) => c[0] === "add" && c.includes("src/a.ts"))).toBe(true);
  });

  it("shows 'working tree clean' for an empty changeset; esc closes", async () => {
    const run: GitRun = async (args) => (args[0] === "rev-parse" ? "/repo\n" : "");
    const ctx = makeCtx();
    const onClose = vi.fn();
    const { stdin, lastFrame } = renderWithCtx(<ReviewOverlay onClose={onClose} runner={new Review("/repo", run)} />, ctx);
    await settle();
    expect(lastFrame()).toContain("working tree clean");
    stdin.write("\x1b"); // esc
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
