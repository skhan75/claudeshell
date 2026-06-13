import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { projectSlug } from "./history-search.js";

const MAX_FILE_BYTES = 5_000_000;
const MAX_FILES_TO_STAT = 60;
const DEFAULT_LIMIT = 25;
const TITLE_MAX_LEN = 60;

export interface ProjectSession {
  sessionId: string;   // filename without .jsonl
  title: string;       // first user message text (trimmed/elided), or "(empty session)"
  file: string;        // the .jsonl filename
  mtimeMs: number;     // file mtime for recency sort
  messageCount: number; // number of user/assistant lines (cheap signal of session size)
}

interface JsonlLine {
  type?: string;
  message?: { content?: unknown };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: { type?: string; text?: string }) =>
        b?.type === "text" && typeof b.text === "string" ? b.text : ""
      )
      .join(" ");
  }
  return "";
}

function elide(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1) + "…";
}

export function listProjectSessions(
  cwd: string,
  opts?: { claudeDir?: string; limit?: number }
): ProjectSession[] {
  const claudeDir = opts?.claudeDir ?? join(homedir(), ".claude");
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const dir = join(claudeDir, "projects", projectSlug(cwd));

  if (!existsSync(dir)) return [];

  let allJsonl: string[];
  try {
    allJsonl = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }

  // Stat each file for mtime, sort newest-first, cap at MAX_FILES_TO_STAT
  const withMtime = allJsonl
    .map((file) => {
      try {
        return { file, mtimeMs: statSync(join(dir, file)).mtimeMs };
      } catch {
        return { file, mtimeMs: 0 };
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_FILES_TO_STAT);

  const sessions: ProjectSession[] = [];

  for (const { file, mtimeMs } of withMtime) {
    try {
      const stat = statSync(join(dir, file));
      if (stat.size > MAX_FILE_BYTES) continue;
    } catch {
      continue;
    }

    let raw: string;
    try {
      raw = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }

    let title: string | null = null;
    let messageCount = 0;

    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed = JSON.parse(line) as JsonlLine;
        const type = parsed.type;
        if (type === "user" || type === "assistant") {
          messageCount++;
          if (title === null && type === "user") {
            const text = textFromContent(parsed.message?.content);
            const trimmed = text.trim();
            if (trimmed.length > 0) {
              title = elide(trimmed, TITLE_MAX_LEN);
            }
          }
        }
      } catch {
        continue;
      }
    }

    sessions.push({
      sessionId: basename(file, ".jsonl"),
      title: title ?? "(empty session)",
      file,
      mtimeMs,
      messageCount,
    });
  }

  // Sort newest-first then slice to limit
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions.slice(0, limit);
}
