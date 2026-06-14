import type { Session } from "./session.js";
import type { Tab } from "./session-manager.js";
import type { SessionStatus } from "./types.js";

/** Title glyphs — the single source for worker/fork titling AND the display-only
 *  isWorker hint. Never re-typed inline elsewhere. */
export const WORKER_GLYPH = "▶";
export const FORK_GLYPH = "⑂";

/** Title for worker i of n, e.g. "▶ worker 2/3" or "▶ swarm 1/4". */
export function workerTitle(i: number, n: number, label = "worker"): string {
  return `${WORKER_GLYPH} ${label} ${i}/${n}`;
}

/** The text of the most recent non-empty assistant block. Shared by /compact's
 *  summary extraction (SessionManager) and the swarm compare view (Phase 5). */
export function lastAssistantText(s: Session): string | undefined {
  const blocks = s.transcript.blocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "assistant" && b.text.trim()) return b.text;
  }
  return undefined;
}

/**
 * A one-line "what is this agent doing right now" string: the last RUNNING tool
 * (name + detail), else the streaming assistant tail, else a status word. Pure over
 * the transcript + status so the dashboard has zero logic to test through Ink.
 */
export function currentActivity(s: Session): string {
  const blocks = s.transcript.blocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "tool" && b.status === "running") return b.detail ? `${b.name} ${b.detail}` : b.name;
  }
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "assistant" && b.streaming && b.text.trim()) return b.text.replace(/\s+/g, " ").trim().slice(0, 60);
  }
  switch (s.status) {
    case "awaiting-permission":
      return "awaiting permission";
    case "awaiting-input":
      return "awaiting input";
    case "processing":
      return "working…";
    case "crashed":
      return s.error ?? "crashed";
    default:
      return "idle";
  }
}

/** Elapsed ms of the in-flight turn; 0 when no turn is running, never negative. */
export function elapsedMs(s: Session, now = Date.now()): number {
  return s.turnStartedAt == null ? 0 : Math.max(0, now - s.turnStartedAt);
}

/** Format ms as a short turn clock: 0 → "—", 4200 → "4s", 95000 → "1m35s". */
export function fmtElapsed(ms: number): string {
  if (ms <= 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s`;
}

/** A renderable row for one agent in the fleet dashboard. */
export interface FleetRow {
  id: string;
  /** Original index into manager.tabs — activate/interrupt MUST use this, not the row
   *  position, so actions hit the right tab when terminals are interleaved. */
  index: number;
  title: string;
  isWorker: boolean;
  group?: string;
  status: SessionStatus;
  activity: string;
  elapsedMs: number;
  costUsd: number;
  contextTokens: number;
  queued: number;
  active: boolean;
}

/** Project ALL claude tabs (terminals excluded) into renderable fleet rows,
 *  preserving each tab's original .index for correct activate/interrupt mapping. */
export function projectFleet(tabs: readonly Tab[], activeIndex: number, now = Date.now()): FleetRow[] {
  const rows: FleetRow[] = [];
  tabs.forEach((t, index) => {
    if (t.kind !== "claude") return;
    rows.push({
      id: t.id,
      index,
      title: t.title,
      isWorker: t.group != null || t.title.startsWith(WORKER_GLYPH),
      group: t.group,
      status: t.status,
      activity: currentActivity(t),
      elapsedMs: elapsedMs(t, now),
      costUsd: t.transcript.usage.costUsd,
      contextTokens: t.transcript.usage.contextTokens,
      queued: t.queuedCount,
      active: index === activeIndex,
    });
  });
  return rows;
}
