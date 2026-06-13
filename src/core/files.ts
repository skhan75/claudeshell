import { readdirSync, Dirent } from "node:fs";
import { join, relative } from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", ".superpowers"]);

export function listProjectFiles(cwd: string, maxDepth = 2, max = 500): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || out.length >= max) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of entries) {
      if (SKIP.has(dirent.name) || out.length >= max) continue;
      if (dirent.isDirectory()) {
        walk(join(dir, dirent.name), depth + 1);
      } else if (dirent.isFile()) {
        out.push(relative(cwd, join(dir, dirent.name)));
      }
    }
  };
  walk(cwd, 0);
  return out;
}

const cache = new Map<string, { at: number; files: string[] }>();
const CACHE_TTL_MS = 5_000;

export function listProjectFilesCached(cwd: string, maxDepth = 2, max = 500): string[] {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.files;
  const files = listProjectFiles(cwd, maxDepth, max);
  cache.set(cwd, { at: Date.now(), files });
  return files;
}
