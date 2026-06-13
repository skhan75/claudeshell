import React from "react";
import { Box, Text } from "ink";
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
 * Read-only project file explorer for the left IDE rail. Folded by default — only
 * top-level entries show — and the ancestor folders of the session's active file are
 * auto-expanded so the current file is revealed in context. Folders are tagged
 * ▾ (open) / ▸ (closed); files get their type icon. Truncates to the available height
 * with a "… +N more" footer.
 */
export function FileTree({
  cwd,
  width,
  height,
  activeFile,
}: {
  cwd: string;
  width: number;
  height: number;
  activeFile?: string;
}) {
  const rows = buildRows(listProjectFilesCached(cwd));

  // Folded by default; auto-expand the ancestor folders of the active file.
  const expanded = new Set<string>(activeFile ? ancestorsOf(activeFile) : []);
  const visible = rows.filter((r) => ancestorsOf(r.path).every((a) => expanded.has(a)));

  const cap = Math.max(1, height);
  const shown = visible.slice(0, cap);
  const overflow = visible.length - shown.length;

  return (
    <Box flexDirection="column">
      {visible.length === 0 && <Text color={theme.dim}>(no files)</Text>}
      {shown.map((r) => {
        const active = !!activeFile && r.path === activeFile;
        const indent = "  ".repeat(r.depth);
        const icon = r.isDir ? (expanded.has(r.path) ? "▾" : "▸") : fileIcon(r.name);
        const used = 1 /* marker */ + indent.length + icon.length + 1 /* space */;
        const budget = Math.max(3, width - used);
        const name = r.name.length > budget ? r.name.slice(0, budget - 1) + "…" : r.name;
        return (
          <Text key={r.path} wrap="truncate">
            <Text color={theme.accent}>{active ? "▎" : " "}</Text>
            <Text>{indent}</Text>
            <Text color={r.isDir ? theme.purple : active ? theme.accent : theme.dim}>{icon} </Text>
            <Text color={r.isDir ? theme.fg : active ? theme.accent : theme.fg} bold={r.isDir || active}>
              {name}
            </Text>
          </Text>
        );
      })}
      {overflow > 0 && <Text color={theme.dim}>{`  … +${overflow} more`}</Text>}
    </Box>
  );
}
