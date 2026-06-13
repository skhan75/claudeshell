import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** Per-project state file — cwd slug mirrors Claude Code's project naming. */
export function statePathFor(cwd: string): string {
  return join(homedir(), ".claudeshell", "state", cwd.replace(/[/.]/g, "-") + ".json");
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
}

export function loadState(path: string): SavedState | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SavedState;
    if (raw.version !== 1 || !Array.isArray(raw.sessions)) throw new Error("bad schema");
    return raw;
  } catch {
    renameSync(path, path + ".bak");
    return null;
  }
}

export function saveState(path: string, state: SavedState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}
