import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileTree, buildRows } from "../../src/ui/FileTree.js";
import { renderWithCtx, cleanupInk, tick } from "./helpers.js";

afterEach(cleanupInk);

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "cs-tree-"));
  mkdirSync(join(dir, "src", "core"), { recursive: true });
  writeFileSync(join(dir, "src", "core", "types.ts"), "x");
  writeFileSync(join(dir, "src", "App.tsx"), "x");
  writeFileSync(join(dir, "README.md"), "x");
  return dir;
}

describe("buildRows", () => {
  it("folds flat paths into a dir-first, then-files tree", () => {
    const rows = buildRows(["src/core/types.ts", "src/App.tsx", "README.md"]);
    const dirPaths = rows.filter((r) => r.isDir).map((r) => r.path);
    expect(dirPaths).toContain("src");
    expect(dirPaths).toContain("src/core");
    // The directory comes before its children; the root file is present.
    expect(rows.findIndex((r) => r.path === "src")).toBeLessThan(rows.findIndex((r) => r.path === "src/App.tsx"));
    expect(rows.some((r) => !r.isDir && r.path === "README.md")).toBe(true);
  });
});

describe("FileTree", () => {
  it("is folded by default — nested files stay hidden until their folder opens", () => {
    const cwd = project();
    const frame = renderWithCtx(<FileTree cwd={cwd} width={28} height={20} />).lastFrame()!;
    // Top-level entries show (src folder + root file); the nested file does not.
    expect(frame).toContain("src");
    expect(frame).toContain("README.md");
    expect(frame).not.toContain("types.ts");
    // Collapsed folders carry the ▸ marker.
    expect(frame).toContain("▸");
  });

  it("auto-expands the active file's folders so it is revealed", () => {
    const cwd = project();
    const frame = renderWithCtx(
      <FileTree cwd={cwd} width={28} height={20} activeFile="src/core/types.ts" />,
    ).lastFrame()!;
    expect(frame).toContain("types.ts");
    expect(frame).toContain("▾"); // an opened folder
  });

  it("expands and collapses a folder via the keyboard when focused", async () => {
    const cwd = project();
    const { stdin, lastFrame } = renderWithCtx(<FileTree cwd={cwd} width={28} height={20} focused />);
    await tick();
    expect(lastFrame()).not.toContain("App.tsx"); // src is folded
    stdin.write("\x1b[C"); // → expands the selected (top) folder, src
    await tick();
    expect(lastFrame()).toContain("App.tsx");
    stdin.write("\x1b[D"); // ← collapses it again
    await tick();
    expect(lastFrame()).not.toContain("App.tsx");
  });

  it("fires onOpenFile when a FILE row is activated (editor satellite)", async () => {
    const cwd = project();
    const opened: string[] = [];
    const { stdin } = renderWithCtx(
      <FileTree cwd={cwd} width={28} height={20} focused onOpenFile={(p) => opened.push(p)} />,
    );
    await tick();
    // Folded view: row 0 is the `src` folder, row 1 is README.md (a file).
    stdin.write("j"); // move cursor to README.md
    await tick();
    stdin.write("\r"); // Enter activates it
    await tick();
    expect(opened).toEqual(["README.md"]);
  });

  it("does not fire onOpenFile when a FOLDER row is activated (it expands instead)", async () => {
    const cwd = project();
    const opened: string[] = [];
    const { stdin, lastFrame } = renderWithCtx(
      <FileTree cwd={cwd} width={28} height={20} focused onOpenFile={(p) => opened.push(p)} />,
    );
    await tick();
    stdin.write("\r"); // Enter on the selected `src` folder
    await tick();
    expect(opened).toEqual([]); // folders expand, they don't open in the editor
    expect(lastFrame()).toContain("App.tsx"); // src expanded
  });
});
