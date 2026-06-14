import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { join } from "node:path";
import { Box, Text, useInput, useStdout } from "ink";
import { useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { Panel } from "./chrome.js";
import { Review, type ReviewResult, type ReviewFile } from "../core/review.js";

/** Single-char status glyph + color for a changed file. */
function statusGlyph(f: ReviewFile): { ch: string; color: string } {
  switch (f.status) {
    case "added":
      return { ch: "A", color: theme.good };
    case "deleted":
      return { ch: "D", color: theme.bad };
    case "renamed":
      return { ch: "R", color: theme.accent };
    case "copied":
      return { ch: "C", color: theme.accent };
    case "untracked":
      return { ch: "?", color: theme.warn };
    case "conflicted":
      return { ch: "!", color: theme.bad };
    default:
      return { ch: "M", color: theme.warn };
  }
}

function diffLineColor(line: string): string {
  if (line.startsWith("@@")) return theme.accent;
  if (line.startsWith("+") && !line.startsWith("+++")) return theme.good;
  if (line.startsWith("-") && !line.startsWith("---")) return theme.bad;
  if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---")) {
    return theme.purple;
  }
  return theme.dim;
}

/**
 * The `/review` surface: a two-pane changed-files reviewer. Left = changed files (status
 * glyph, +adds/-dels, staged dot); right = the selected file's color-coded, scrollable diff.
 * `e` opens the file in `$EDITOR` at its first hunk (reuses the Phase-1 editor satellite),
 * `s`/`u` stage/unstage, `r` refreshes. Data comes from an injectable Review runner so UI
 * tests never shell out to git.
 */
export function ReviewOverlay({ onClose, runner }: { onClose: () => void; runner?: Review }) {
  const { manager } = useAppCtx();
  const { stdout } = useStdout();
  const [res, setRes] = useState<ReviewResult | null>(null);
  const [sel, setSel] = useState(0);
  const [scroll, setScroll] = useState(0);

  const cwd = manager.activeTab?.cwd ?? process.cwd();
  const review = useMemo(() => runner ?? new Review(cwd), [runner, cwd]);
  // Monotonic request id: only the latest collect() wins, so rapid s/u/r can't render a
  // stale changeset, and a resolve after unmount simply never matches the final seq.
  const seqRef = useRef(0);
  const reload = useCallback(() => {
    const seq = ++seqRef.current;
    void review.collect().then((r) => {
      if (seq === seqRef.current) setRes(r);
    });
  }, [review]);
  useEffect(() => reload(), [reload]);

  const files = res?.files ?? [];
  const selIdx = files.length ? Math.min(sel, files.length - 1) : 0;
  const cur: ReviewFile | undefined = files[selIdx];

  const diffHeight = Math.max(4, (stdout?.rows ?? 24) - 8);

  // Keep the file selection in range when the changeset shrinks on refresh.
  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, files.length - 1)));
  }, [files.length]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (input === "j" || key.downArrow) {
      setSel(Math.min(selIdx + 1, files.length - 1));
      setScroll(0);
      return;
    }
    if (input === "k" || key.upArrow) {
      setSel(Math.max(0, selIdx - 1));
      setScroll(0);
      return;
    }
    if (key.ctrl && input === "d") {
      setScroll((s) => s + 10);
      return;
    }
    if (key.ctrl && input === "u") {
      setScroll((s) => Math.max(0, s - 10));
      return;
    }
    if (input === "e" && cur && res) {
      // Resolve to an absolute path (repo-toplevel-relative) before the editor satellite.
      manager.openInEditor(join(res.repoRoot, cur.path), cur.hunks[0]?.startLine);
      onClose();
      return;
    }
    if (input === "s" && cur) {
      void review.stage(cur.path).then(reload);
      return;
    }
    if (input === "u" && cur) {
      void review.unstage(cur.path).then(reload);
      return;
    }
    if (input === "r") reload();
  }, { isActive: !manager.active?.pendingPermission });

  const diffLines = cur ? cur.diff.split("\n") : [];
  const shown = diffLines.slice(scroll, scroll + diffHeight);

  // Window the changed-files list around the selection so long changesets don't clip silently.
  const listCap = Math.max(3, diffHeight);
  const listStart = Math.max(0, Math.min(selIdx - Math.floor(listCap / 2), Math.max(0, files.length - listCap)));
  const shownFiles = files.slice(listStart, listStart + listCap);
  const filesBelow = files.length - (listStart + shownFiles.length);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Panel accent flexDirection="column">
        <Text bold color={theme.accent}>
          REVIEW · {files.length} changed file{files.length === 1 ? "" : "s"}
        </Text>
        {res === null ? (
          <Box marginTop={1}>
            <Text color={theme.dim}>collecting diff…</Text>
          </Box>
        ) : files.length === 0 ? (
          <Box marginTop={1}>
            <Text color={theme.good}>✓ working tree clean</Text>
          </Box>
        ) : (
          <Box flexDirection="row" marginTop={1}>
            {/* LEFT: changed files (windowed around the selection) */}
            <Box flexDirection="column" width={38}>
              {shownFiles.map((f, i) => {
                const idx = listStart + i;
                const g = statusGlyph(f);
                const selected = idx === selIdx;
                const counts = `+${f.additions} -${f.deletions}`;
                const name = f.path.length > 22 ? "…" + f.path.slice(-21) : f.path;
                return (
                  <Text key={f.path} inverse={selected} wrap="truncate">
                    <Text color={theme.accent}>{selected ? "› " : "  "}</Text>
                    <Text color={g.color}>{g.ch} </Text>
                    <Text color={f.staged ? theme.good : theme.dim}>{f.staged ? "●" : "○"} </Text>
                    <Text color={selected ? theme.accent : theme.fg}>{name} </Text>
                    <Text color={theme.dim}>{counts}</Text>
                  </Text>
                );
              })}
              {filesBelow > 0 && <Text color={theme.dim}>{`  … +${filesBelow} more`}</Text>}
            </Box>
            {/* RIGHT: diff of the selected file */}
            <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
              {cur?.binary ? (
                <Text color={theme.dim}>(binary file — no diff)</Text>
              ) : !cur || cur.diff.trim() === "" ? (
                <Text color={theme.dim}>(no diff — new/untracked)</Text>
              ) : (
                shown.map((ln, i) => (
                  <Text key={scroll + i} color={diffLineColor(ln)} wrap="truncate">
                    {ln === "" ? " " : ln}
                  </Text>
                ))
              )}
              {diffLines.length > scroll + diffHeight && <Text color={theme.dim}>{`  … +${diffLines.length - scroll - diffHeight} more (^D)`}</Text>}
            </Box>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.dim}>j/k file · ^D/^U scroll · e edit · s stage · u unstage · r refresh · esc</Text>
        </Box>
      </Panel>
    </Box>
  );
}
