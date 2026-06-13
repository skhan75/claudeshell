import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const MAX_FILE_BYTES = 5_000_000;
const MAX_FILES = 40;

export interface HistoryHit {
  file: string;
  text: string;
}

/** Claude Code stores project transcripts under ~/.claude/projects/<slug>/, slug = cwd with [/.] → "-". */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

interface JsonlLine {
  type?: string;
  message?: { content?: unknown };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: { type?: string; text?: string }) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
      .join(" ");
  }
  return "";
}

export function searchHistory(
  cwd: string,
  query: string,
  opts: { claudeDir?: string; limit?: number } = {}
): HistoryHit[] {
  const claudeDir = opts.claudeDir ?? join(homedir(), ".claude");
  const limit = opts.limit ?? 20;
  const dir = join(claudeDir, "projects", projectSlug(cwd));
  if (!existsSync(dir) || query.trim() === "") return [];
  const q = query.toLowerCase();
  const hits: HistoryHit[] = [];

  const allJsonl = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  const sortedJsonl = allJsonl
    .map((file) => {
      try {
        return { file, mtimeMs: statSync(join(dir, file)).mtimeMs };
      } catch {
        return { file, mtimeMs: 0 };
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_FILES)
    .map((e) => e.file);

  for (const file of sortedJsonl) {
    let raw: string;
    try {
      if (statSync(join(dir, file)).size > MAX_FILE_BYTES) continue;
      raw = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (hits.length >= limit) return hits;
      if (line.trim() === "") continue;
      try {
        const parsed = JSON.parse(line) as JsonlLine;
        if (parsed.type !== "user" && parsed.type !== "assistant") continue;
        const text = textFromContent(parsed.message?.content);
        if (text.toLowerCase().includes(q)) {
          hits.push({ file, text: text.length > 120 ? text.slice(0, 117) + "…" : text });
        }
      } catch {
        continue;
      }
    }
  }
  return hits;
}
