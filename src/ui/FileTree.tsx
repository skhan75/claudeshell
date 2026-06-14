import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";
import { fileIcon } from "./format.js";
import { listProjectFilesCached } from "../core/files.js";

interface TreeRow {
  depth: number;
  name: string;
  path: string; // project-relative
  isDir: boolean;
}

interface DirNode {
  dirs: Map<string, DirNode>;
  files: Set<string>;
}

/** Fold a flat list of project-relative paths into a depth-first, dir-then-file tree. */
export function buildRows(files: string[]): TreeRow[] {
  const root: DirNode = { dirs: new Map(), files: new Set() };
  for (const f of files) {
    const parts = f.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts[i];
      let next = node.dirs.get(d);
      if (!next) {
        next = { dirs: new Map(), files: new Set() };
        node.dirs.set(d, next);
      }
      node = next;
    }
    node.files.add(parts[parts.length - 1]);
  }
  const rows: TreeRow[] = [];
  const walk = (node: DirNode, depth: number, prefix: string) => {
    for (const name of [...node.dirs.keys()].sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      rows.push({ depth, name, path, isDir: true });
      walk(node.dirs.get(name)!, depth + 1, path);
    }
    for (const name of [...node.files].sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      rows.push({ depth, name, path, isDir: false });
    }
  };
  walk(root, 0, "");
  return rows;
}

/** The ancestor directory paths of a project-relative path (excluding the leaf). */
function ancestorsOf(p: string): string[] {
  const parts = p.split("/");
  const out: string[] = [];
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    out.push(acc);
  }
  return out;
}

/**
 * Project file explorer for the left IDE rail. Folded by default (only top-level
 * entries show); the ancestor folders of the session's active file are pre-expanded
 * so the current file is revealed in context. When `focused` (Ctrl+E), it owns the
 * keyboard: ↑/↓ or j/k move the cursor, →/Enter/Space open a folder, ←/h close it
 * (or jump to the parent), g/G jump to ends, and Esc/i hand focus back to the input.
 * Activating a FILE row (Enter/→/l/Space) calls `onOpenFile` — the Option C editor
 * satellite hands it to `$EDITOR` rather than rendering it here.
 */
export function FileTree({
  cwd,
  width,
  height,
  activeFile,
  focused = false,
  onExit,
  onOpenFile,
}: {
  cwd: string;
  width: number;
  height: number;
  activeFile?: string;
  focused?: boolean;
  onExit?: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const allRows = buildRows(listProjectFilesCached(cwd));

  // Expansion state: seed with the active file's ancestors (folded otherwise), then
  // let the user open/close folders while the explorer is focused.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeFile ? ancestorsOf(activeFile) : []));
  const [sel, setSel] = useState(0);

  // Re-reveal a newly-active file's path without collapsing what the user opened.
  useEffect(() => {
    if (!activeFile) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const a of ancestorsOf(activeFile)) next.add(a);
      return next;
    });
  }, [activeFile]);

  const visible = allRows.filter((r) => ancestorsOf(r.path).every((a) => expanded.has(a)));
  const selIdx = visible.length ? Math.min(sel, visible.length - 1) : 0;

  useInput(
    (input, key) => {
      if (key.escape || (input === "i" && !key.ctrl && !key.meta)) {
        onExit?.();
        return;
      }
      if (input === "j" || key.downArrow) {
        setSel((s) => Math.min(visible.length - 1, s + 1));
      } else if (input === "k" || key.upArrow) {
        setSel((s) => Math.max(0, s - 1));
      } else if (input === "g") {
        setSel(0);
      } else if (input === "G") {
        setSel(visible.length - 1);
      } else if (key.return || input === " " || input === "l" || key.rightArrow) {
        const row = visible[selIdx];
        if (row?.isDir) setExpanded((prev) => new Set(prev).add(row.path));
        else if (row) onOpenFile?.(row.path);
      } else if (input === "h" || key.leftArrow) {
        const row = visible[selIdx];
        if (row?.isDir && expanded.has(row.path)) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(row.path);
            return next;
          });
        } else if (row) {
          // Jump the cursor to the parent folder row.
          const parent = ancestorsOf(row.path).slice(-1)[0];
          const idx = visible.findIndex((r) => r.path === parent);
          if (idx >= 0) setSel(idx);
        }
      }
    },
    { isActive: focused }
  );

  // Window the rows around the cursor so the selection stays on screen.
  const cap = Math.max(1, height);
  const start = Math.max(0, Math.min(selIdx - Math.floor(cap / 2), Math.max(0, visible.length - cap)));
  const shown = visible.slice(start, start + cap);
  const hiddenBelow = visible.length - (start + shown.length);

  return (
    <Box flexDirection="column">
      {visible.length === 0 && <Text color={theme.dim}>(no files)</Text>}
      {shown.map((r, i) => {
        const idx = start + i;
        const cursor = focused && idx === selIdx;
        const active = !!activeFile && r.path === activeFile;
        const indent = "  ".repeat(r.depth);
        const icon = r.isDir ? (expanded.has(r.path) ? "▾" : "▸") : fileIcon(r.name);
        const used = 1 /* marker */ + indent.length + icon.length + 1 /* space */;
        const budget = Math.max(3, width - used);
        const name = r.name.length > budget ? r.name.slice(0, budget - 1) + "…" : r.name;
        const nameColor = r.isDir ? theme.fg : cursor || active ? theme.accent : theme.fg;
        return (
          <Text key={r.path} wrap="truncate" inverse={cursor}>
            <Text color={theme.accent}>{cursor ? "›" : active ? "▎" : " "}</Text>
            <Text>{indent}</Text>
            <Text color={r.isDir ? theme.purple : active ? theme.accent : theme.dim}>{icon} </Text>
            <Text color={nameColor} bold={r.isDir || active}>
              {name}
            </Text>
          </Text>
        );
      })}
      {hiddenBelow > 0 && <Text color={theme.dim}>{`  … +${hiddenBelow} more`}</Text>}
    </Box>
  );
}
