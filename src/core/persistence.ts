import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { BudgetCaps } from "./types.js";

/** Per-project state file — cwd slug mirrors Claude Code's project naming.
 *  A short SHA-1 hash suffix makes the slug injective (avoids collisions like
 *  '/a/b' vs '/a.b' which both map to '-a-b' without the hash). */
export function statePathFor(cwd: string): string {
  const slug = cwd.replace(/[/.]/g, "-");
  const hash = createHash("sha1").update(cwd).digest("hex").slice(0, 8);
  return join(homedir(), ".claudeshell", "state", `${slug}-${hash}.json`);
}

export interface SavedSession {
  id: string;
  title: string;
  cwd: string;
  claudeSessionId?: string;
}

export interface SavedState {
  version: 1;
  active: number;
  counter: number;
  sessions: SavedSession[];
  /** Last-set cost-guard caps (the user's most recent /budget wins over config on restore). */
  budget?: BudgetCaps;
}

export function loadState(path: string): SavedState | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SavedState;
    if (raw.version !== 1 || !Array.isArray(raw.sessions)) throw new Error("bad schema");
    return raw;
  } catch {
    // Best-effort backup — if rename fails (read-only dir, existing .bak, etc.)
    // swallow the error so startup never crashes.
    try { renameSync(path, path + ".bak"); } catch { /* best effort */ }
    return null;
  }
}

export function saveState(path: string, state: SavedState): void {
  mkdirSync(dirname(path), { recursive: true });
  // Atomic write: write to a temp sibling then rename so a kill mid-write
  // never leaves a truncated state file.
  const tmp = path + ".tmp." + process.pid;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}
