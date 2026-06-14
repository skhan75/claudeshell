import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

/** One injectable seam that touches git — takes args so review can issue several commands.
 *  Tests pass a fake that returns canned output; production shells out to git. */
export type GitRun = (args: string[], cwd: string) => Promise<string>;

const realGitRun: GitRun = async (args, cwd) => {
  const { stdout } = await pExecFile("git", args, { cwd, timeout: 5000, maxBuffer: 1 << 24 });
  return stdout;
};

export interface ReviewHunk {
  header: string;
  /** NEW-file start line (the +c in `@@ -a,b +c,d @@`) — where `e` jumps the editor. */
  startLine: number;
}

export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "conflicted";

export interface PorcelainEntry {
  path: string;
  oldPath?: string;
  status: FileStatus;
  staged: boolean;
  unstaged: boolean;
}

export interface ReviewFile extends PorcelainEntry {
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: ReviewHunk[];
  diff: string;
}

export interface ReviewResult {
  files: ReviewFile[];
  raw: string;
  /** Absolute repo top-level — the overlay joins file paths to this before openInEditor. */
  repoRoot: string;
}

function statusFrom(x: string, y: string): FileStatus {
  if (x === "?" && y === "?") return "untracked";
  if (x === "U" || y === "U") return "conflicted";
  if (x === "R" || y === "R") return "renamed";
  if (x === "C" || y === "C") return "copied";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

/**
 * Parse `git status --porcelain=v1 -z` output. NUL-delimited (never quoted, even for paths
 * with spaces/unicode). Each record is `XY <path>`; rename/copy records append the original
 * path as the NEXT NUL field, in new\0old order.
 */
export function parsePorcelain(z: string): PorcelainEntry[] {
  const tokens = z.split("\0").filter((t) => t.length > 0);
  const out: PorcelainEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.length < 3) continue;
    const x = tok[0];
    const y = tok[1];
    const path = tok.slice(3); // skip "XY "
    let oldPath: string | undefined;
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      oldPath = tokens[++i]; // rename/copy: original path is the following token
    }
    const untracked = x === "?" && y === "?";
    out.push({
      path,
      oldPath,
      status: statusFrom(x, y),
      staged: !untracked && x !== " " && x !== "?",
      unstaged: untracked || (y !== " " && y !== "?"),
    });
  }
  return out;
}

/** Extract hunk headers + NEW-file start lines from a unified diff. */
export function parseDiffHunks(diff: string): ReviewHunk[] {
  const hunks: ReviewHunk[] = [];
  for (const line of diff.split("\n")) {
    if (!line.startsWith("@@")) continue;
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) hunks.push({ header: line, startLine: Number(m[1]) });
  }
  return hunks;
}

/** +/- counts and binary flag from a unified diff (avoids a separate numstat call/parse). */
export function diffStats(diff: string): { additions: number; deletions: number; binary: boolean } {
  if (/^Binary files /m.test(diff) || /^GIT binary patch/m.test(diff)) {
    return { additions: 0, deletions: 0, binary: true };
  }
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions, binary: false };
}

/**
 * Headless git-review model. `collect()` reads the working-tree-vs-HEAD changeset; per-file
 * `git diff HEAD -- <path>` (paths as args) sidesteps all path-quoting AND the staged/unstaged
 * double-count. Never throws — a non-repo / git failure yields an empty result.
 */
export class Review {
  constructor(
    private cwd: string,
    private run: GitRun = realGitRun,
  ) {}

  async collect(): Promise<ReviewResult> {
    let repoRoot = this.cwd;
    try {
      repoRoot = (await this.run(["rev-parse", "--show-toplevel"], this.cwd)).trim() || this.cwd;
    } catch {
      return { files: [], raw: "", repoRoot: this.cwd };
    }
    try {
      const entries = parsePorcelain(await this.run(["status", "--porcelain=v1", "-z"], this.cwd));
      const files: ReviewFile[] = [];
      const rawParts: string[] = [];
      for (const e of entries) {
        let diff = "";
        if (e.status !== "untracked") {
          const args = ["diff", "HEAD", "--", e.path];
          if (e.oldPath) args.push(e.oldPath); // include both sides of a rename
          diff = await this.run(args, this.cwd).catch(() => "");
        }
        rawParts.push(diff);
        const stats = diffStats(diff);
        files.push({ ...e, ...stats, hunks: parseDiffHunks(diff), diff });
      }
      return { files, raw: rawParts.join("\n"), repoRoot };
    } catch {
      return { files: [], raw: "", repoRoot };
    }
  }

  /** Stage a file. `--` separates the path so a leading-dash filename can't inject a flag. */
  async stage(path: string): Promise<void> {
    await this.run(["add", "--", path], this.cwd);
  }

  /** Unstage a file (reverse of stage). */
  async unstage(path: string): Promise<void> {
    await this.run(["restore", "--staged", "--", path], this.cwd);
  }
}
