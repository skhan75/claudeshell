import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    let raw: string;
    try {
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
