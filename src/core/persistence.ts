import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
