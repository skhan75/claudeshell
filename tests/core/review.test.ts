import { describe, it, expect } from "vitest";
import { Review, parsePorcelain, parseDiffHunks, diffStats, type GitRun } from "../../src/core/review.js";

describe("parsePorcelain", () => {
  it("reads XY columns, paths-with-spaces, and untracked", () => {
    const z = " M src/a.ts\0M  src/staged.ts\0?? new file.txt\0";
    const e = parsePorcelain(z);
    expect(e).toHaveLength(3);
    expect(e[0]).toMatchObject({ path: "src/a.ts", status: "modified", staged: false, unstaged: true });
    expect(e[1]).toMatchObject({ path: "src/staged.ts", status: "modified", staged: true, unstaged: false });
    expect(e[2]).toMatchObject({ path: "new file.txt", status: "untracked", staged: false, unstaged: true });
  });

  it("handles rename records in new\\0old order (staged + unstaged variants)", () => {
    const staged = parsePorcelain("R  new.ts\0old.ts\0");
    expect(staged[0]).toMatchObject({ path: "new.ts", oldPath: "old.ts", status: "renamed", staged: true, unstaged: false });
    const unstaged = parsePorcelain(" R new.ts\0old.ts\0");
    expect(unstaged[0]).toMatchObject({ path: "new.ts", oldPath: "old.ts", status: "renamed", staged: false, unstaged: true });
  });

  it("maps added / deleted / copied / conflicted status codes", () => {
    expect(parsePorcelain("A  added.ts\0")[0]).toMatchObject({ status: "added", staged: true, unstaged: false });
    expect(parsePorcelain(" D del.ts\0")[0]).toMatchObject({ status: "deleted", staged: false, unstaged: true });
    expect(parsePorcelain("C  copy.ts\0src.ts\0")[0]).toMatchObject({ status: "copied", oldPath: "src.ts", staged: true });
    expect(parsePorcelain("UU conflict.ts\0")[0]).toMatchObject({ status: "conflicted", staged: true, unstaged: true });
  });
});

describe("parseDiffHunks", () => {
  it("extracts headers + NEW-file start lines (counted and single-line forms)", () => {
    const diff = ["diff --git a/x b/x", "@@ -1,3 +1,4 @@ func()", "+added", "@@ -10 +20 @@", "-removed"].join("\n");
    const h = parseDiffHunks(diff);
    expect(h).toHaveLength(2);
    expect(h[0]).toEqual({ header: "@@ -1,3 +1,4 @@ func()", startLine: 1 });
    expect(h[1].startLine).toBe(20);
  });
});

describe("diffStats", () => {
  it("counts +/- lines (ignoring +++/---) and flags binary", () => {
    const diff = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1 +1,2 @@", "+one", "+two", "-old"].join("\n");
    expect(diffStats(diff)).toEqual({ additions: 2, deletions: 1, binary: false });
    expect(diffStats("Binary files a/logo.png and b/logo.png differ").binary).toBe(true);
    expect(diffStats("GIT binary patch\nliteral 12\n...").binary).toBe(true);
  });
});

function cannedRun(): GitRun {
  return async (args) => {
    if (args[0] === "rev-parse") return "/repo\n";
    if (args[0] === "status") return " M a.ts\0?? new.txt\0";
    if (args[0] === "diff" && args.includes("a.ts")) return ["diff --git a/a.ts b/a.ts", "@@ -1 +1,2 @@", "+x", "-y"].join("\n");
    return "";
  };
}

describe("Review.collect", () => {
  it("merges status + per-file diff into ReviewFile[] with counts, hunks, and repoRoot", async () => {
    const res = await new Review("/repo", cannedRun()).collect();
    expect(res.repoRoot).toBe("/repo");
    expect(res.files.map((f) => f.path)).toEqual(["a.ts", "new.txt"]);
    expect(res.files[0]).toMatchObject({ additions: 1, deletions: 1 });
    expect(res.files[0].hunks).toHaveLength(1);
    expect(res.files[1]).toMatchObject({ status: "untracked", diff: "" }); // untracked → no diff fetched
  });

  it("never throws on a non-repo (rev-parse rejects) → empty result", async () => {
    const run: GitRun = async (args) => {
      if (args[0] === "rev-parse") throw new Error("not a git repository");
      return "";
    };
    expect(await new Review("/x", run).collect()).toEqual({ files: [], raw: "", repoRoot: "/x" });
  });

  it("stage/unstage issue safe `--`-separated argv (a dash filename can't inject a flag)", async () => {
    const calls: string[][] = [];
    const run: GitRun = async (args) => {
      calls.push(args);
      return "";
    };
    const r = new Review("/repo", run);
    await r.stage("-weird.ts");
    await r.unstage("-weird.ts");
    expect(calls[0]).toEqual(["add", "--", "-weird.ts"]);
    expect(calls[1]).toEqual(["restore", "--staged", "--", "-weird.ts"]);
  });
});
