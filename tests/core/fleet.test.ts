import { describe, it, expect } from "vitest";
import { Transcript } from "../../src/core/transcript.js";
import {
  workerTitle,
  currentActivity,
  elapsedMs,
  fmtElapsed,
  projectFleet,
  lastAssistantText,
  WORKER_GLYPH,
} from "../../src/core/fleet.js";
import type { Session } from "../../src/core/session.js";
import type { Tab } from "../../src/core/session-manager.js";

/** A minimal session-like object for the pure projection helpers (they only read
 *  transcript/status/turnStartedAt/group/title/kind/id). */
function fakeSession(over: Partial<Session> & { transcript?: Transcript } = {}): Session {
  return {
    kind: "claude",
    id: over.id ?? "s1",
    title: over.title ?? "session",
    status: over.status ?? "idle",
    turnStartedAt: over.turnStartedAt ?? null,
    queuedCount: over.queuedCount ?? 0,
    group: over.group,
    error: over.error ?? null,
    transcript: over.transcript ?? new Transcript(),
  } as unknown as Session;
}

describe("workerTitle", () => {
  it("formats worker / labelled titles", () => {
    expect(workerTitle(2, 3)).toBe("▶ worker 2/3");
    expect(workerTitle(1, 4, "swarm")).toBe("▶ swarm 1/4");
  });
});

describe("currentActivity", () => {
  it("reports the last RUNNING tool with its detail", () => {
    const t = new Transcript();
    t.blocks.push({ kind: "tool", name: "Read", detail: "a.ts", status: "done" });
    t.blocks.push({ kind: "tool", name: "Bash", detail: "npm test", status: "running" });
    expect(currentActivity(fakeSession({ transcript: t, status: "processing" }))).toBe("Bash npm test");
  });

  it("falls back to the streaming assistant tail when no tool is running", () => {
    const t = new Transcript();
    t.blocks.push({ kind: "assistant", text: "thinking   about\nit", streaming: true });
    expect(currentActivity(fakeSession({ transcript: t, status: "processing" }))).toBe("thinking about it");
  });

  it("falls back to a status word last", () => {
    expect(currentActivity(fakeSession({ status: "idle" }))).toBe("idle");
    expect(currentActivity(fakeSession({ status: "processing" }))).toBe("working…");
    expect(currentActivity(fakeSession({ status: "awaiting-permission" }))).toBe("awaiting permission");
  });
});

describe("elapsedMs / fmtElapsed", () => {
  it("computes elapsed, returns 0 for no turn, never negative", () => {
    expect(elapsedMs(fakeSession({ turnStartedAt: 1000 }), 5200)).toBe(4200);
    expect(elapsedMs(fakeSession({ turnStartedAt: null }), 5000)).toBe(0);
    expect(elapsedMs(fakeSession({ turnStartedAt: 9000 }), 5000)).toBe(0);
  });

  it("formats the turn clock", () => {
    expect(fmtElapsed(0)).toBe("—");
    expect(fmtElapsed(4200)).toBe("4s");
    expect(fmtElapsed(95000)).toBe("1m35s");
  });
});

describe("lastAssistantText", () => {
  it("returns the most recent non-empty assistant text", () => {
    const t = new Transcript();
    t.blocks.push({ kind: "assistant", text: "first", streaming: false });
    t.blocks.push({ kind: "tool", name: "X", detail: "", status: "done" });
    t.blocks.push({ kind: "assistant", text: "   ", streaming: false });
    expect(lastAssistantText(fakeSession({ transcript: t }))).toBe("first");
  });

  it("returns undefined when there is no assistant text", () => {
    expect(lastAssistantText(fakeSession())).toBeUndefined();
  });
});

describe("projectFleet", () => {
  it("excludes terminals, preserves original indices, and marks workers + active", () => {
    const a = fakeSession({ id: "s1", title: "main" });
    const term = { kind: "terminal", id: "t1", title: "sh" } as unknown as Tab;
    const b = fakeSession({ id: "s2", title: `${WORKER_GLYPH} worker 1/1` });
    const c = fakeSession({ id: "s3", title: "plain", group: "swarm" });
    const rows = projectFleet([a, term, b, c], 3);
    expect(rows.map((r) => r.id)).toEqual(["s1", "s2", "s3"]);
    expect(rows.map((r) => r.index)).toEqual([0, 2, 3]); // original tab indices, terminal skipped
    expect(rows[0].isWorker).toBe(false);
    expect(rows[1].isWorker).toBe(true); // ▶ title prefix
    expect(rows[2].isWorker).toBe(true); // structural group tag
    expect(rows[2].active).toBe(true); // activeIndex 3 → s3
    expect(rows[0].active).toBe(false);
  });

  it("returns [] when there are no claude tabs", () => {
    const term = { kind: "terminal", id: "t1", title: "sh" } as unknown as Tab;
    expect(projectFleet([term], 0)).toEqual([]);
  });
});
