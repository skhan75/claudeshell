import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "../../src/core/session-manager.js";
import { loadState, statePathFor } from "../../src/core/persistence.js";
import type { QueryFn } from "../../src/core/types.js";
import type { SpawnFn } from "../../src/core/terminal.js";

const noopQuery: QueryFn = ({ prompt }) => {
  async function* gen() {
    for await (const _ of prompt) return;
  }
  return gen();
};

// Duck-typed fake PTY so no real shell spawns (node-pty never loads in tests).
const fakeSpawn: SpawnFn = () => ({
  onData() {},
  onExit() {},
  write() {},
  resize() {},
  kill() {},
});

function tmpState(): string {
  return join(mkdtempSync(join(tmpdir(), "cs-state-")), "state.json");
}

describe("SessionManager", () => {
  it("creates, activates, and closes sessions", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const a = m.create();
    const b = m.create();
    expect(m.tabs).toHaveLength(2);
    expect(m.active?.id).toBe(b.id);
    m.activate(0);
    expect(m.active?.id).toBe(a.id);
    m.close(a.id);
    expect(m.tabs).toHaveLength(1);
    expect(m.active?.id).toBe(b.id);
  });

  it("cycleActive moves to the next/previous tab and wraps around both ends", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const a = m.create();
    const b = m.create();
    const c = m.create(); // c active (index 2)
    expect(m.active?.id).toBe(c.id);

    m.cycleActive(1); // wrap forward 2 -> 0
    expect(m.active?.id).toBe(a.id);
    m.cycleActive(1); // 0 -> 1
    expect(m.active?.id).toBe(b.id);
    m.cycleActive(-1); // 1 -> 0
    expect(m.active?.id).toBe(a.id);
    m.cycleActive(-1); // wrap backward 0 -> 2
    expect(m.active?.id).toBe(c.id);
  });

  it("cycleActive is a no-op with a single tab and never throws on zero tabs", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const only = m.create();
    m.cycleActive(1);
    expect(m.active?.id).toBe(only.id);
    m.cycleActive(-1);
    expect(m.active?.id).toBe(only.id);
  });

  it("notifies subscribers on changes", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    let ticks = 0;
    m.subscribe(() => ticks++);
    m.create();
    expect(ticks).toBeGreaterThan(0);
  });

  it("persists and restores tab state", () => {
    const statePath = tmpState();
    const m1 = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery });
    const s = m1.create();
    s.title = "jwt work";
    (s as unknown as { claudeId?: string })["claudeId"] = "claude-abc";
    m1.saveState();

    const m2 = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery });
    m2.restoreState();
    expect(m2.tabs).toHaveLength(1);
    expect(m2.tabs[0].title).toBe("jwt work");
    expect((m2.tabs[0] as { claudeSessionId?: string }).claudeSessionId).toBe("claude-abc");
  });

  it("backs up corrupt state instead of crashing", () => {
    const statePath = tmpState();
    writeFileSync(statePath, "{corrupt");
    expect(loadState(statePath)).toBeNull();
    expect(existsSync(statePath + ".bak")).toBe(true);
  });

  it("always keeps at least one session after restore", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    m.restoreState();
    expect(m.tabs.length).toBe(1);
  });

  it("keeps the active tab focused when closing a tab before it", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const a = m.create();
    const b = m.create();
    m.create(); // c
    m.activate(1); // b active
    m.close(a.id);
    expect(m.active?.id).toBe(b.id);
  });

  it("statePathFor scopes state files per project cwd", () => {
    const a = statePathFor("/projects/alpha");
    const b = statePathFor("/projects/beta");
    expect(a).not.toBe(b);
    // The slug portion is still present; the hash suffix now follows it.
    expect(a).toContain("-projects-alpha-");
    expect(a.endsWith(".json")).toBe(true);
    expect(a).toContain(join(".claudeshell", "state"));
  });

  it("clamps activeIndex when closing the last tab while it is active", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    m.create();
    const b = m.create();
    const c = m.create();
    m.activate(2); // c active
    m.close(c.id);
    expect(m.active?.id).toBe(b.id);
  });

  it("skips malformed session entries on restore", () => {
    const statePath = tmpState();
    writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        active: 0,
        counter: 3,
        sessions: [{ id: "s1", title: "good", cwd: "/tmp" }, { title: "no id or cwd" }],
      })
    );
    const m = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery });
    m.restoreState();
    expect(m.tabs).toHaveLength(1);
    expect(m.tabs[0].title).toBe("good");
  });

  // --- Terminal tab type ---

  it("createTerminal adds a terminal tab, makes it active, and active (claude getter) is undefined", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const claude = m.create();
    const term = m.createTerminal({ spawnFn: fakeSpawn });
    expect(m.tabs).toHaveLength(2);
    // The terminal is now the active tab...
    expect(m.activeTab?.kind).toBe("terminal");
    expect(m.activeTab?.id).toBe(term.id);
    // ...but the Claude getter returns undefined while a terminal is active.
    expect(m.active).toBeUndefined();
    // Switching back to the claude tab makes active defined again.
    m.activate(0);
    expect(m.activeTab?.kind).toBe("claude");
    expect(m.active?.id).toBe(claude.id);
  });

  it("saveState persists only claude tabs (terminals are not restored)", () => {
    const statePath = tmpState();
    const m1 = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery });
    const claude = m1.create();
    claude.title = "real work";
    m1.createTerminal({ spawnFn: fakeSpawn });
    expect(m1.tabs).toHaveLength(2);
    m1.saveState();

    const m2 = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery });
    m2.restoreState();
    // Only the claude tab comes back; the terminal was never persisted.
    expect(m2.tabs).toHaveLength(1);
    expect(m2.tabs[0].kind).toBe("claude");
    expect(m2.tabs[0].title).toBe("real work");
  });

  it("close() removes a terminal tab and disposes it", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    m.create();
    const term = m.createTerminal({ spawnFn: fakeSpawn });
    let killed = false;
    const spy = m.createTerminal({
      spawnFn: () => ({
        onData() {},
        onExit() {},
        write() {},
        resize() {},
        kill() { killed = true; },
      }),
    });
    expect(m.tabs).toHaveLength(3);
    m.close(spy.id);
    expect(killed).toBe(true);
    expect(m.tabs).toHaveLength(2);
    expect(m.tabs.some((t) => t.id === spy.id)).toBe(false);
    // The other terminal is unaffected.
    expect(m.tabs.some((t) => t.id === term.id)).toBe(true);
  });

  // --- Eager warmup: tabs connect their query before the first prompt ---

  it("create() eagerly warms the active session (query opens once, no prompt sent)", () => {
    const queryFn = vi.fn<QueryFn>(({ prompt }) => {
      async function* gen() {
        for await (const _ of prompt) return;
      }
      return gen();
    });
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn });
    m.create();
    // The new tab's query was opened eagerly (no send() needed).
    expect(queryFn).toHaveBeenCalledOnce();
    // Warmup is not a turn — the freshly created session stays idle.
    expect(m.active?.status).toBe("idle");
  });

  it("activate() warms a not-yet-viewed tab the first time it becomes active", () => {
    const queryFn = vi.fn<QueryFn>(({ prompt }) => {
      async function* gen() {
        for await (const _ of prompt) return;
      }
      return gen();
    });
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn });
    m.create(); // a — warmed (call 1)
    m.create(); // b — warmed (call 2), now active
    expect(queryFn).toHaveBeenCalledTimes(2);
    // Re-activating an already-warmed tab does not reopen its query.
    m.activate(0);
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  // --- Pinning regression tests for review fixes ---

  // FIX 1: loadState rename-in-catch must never throw even if rename fails.
  it("[fix1] loadState returns null and never throws when the rename of a corrupt file fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-fix1-"));
    const statePath = join(dir, "state.json");
    // Write a corrupt state file.
    writeFileSync(statePath, "{corrupt");
    // Pre-create a *directory* at the .bak path so renameSync(path, path+'.bak')
    // fails with EISDIR / EEXIST — this is the reliable cross-platform trick.
    mkdirSync(statePath + ".bak");
    // loadState must return null and must NOT throw.
    expect(() => loadState(statePath)).not.toThrow();
    expect(loadState(statePath)).toBeNull();
  });

  // FIX 2: saveState must write atomically; no .tmp.* file may remain after the call.
  it("[fix2] saveState leaves no .tmp.* file after a successful round-trip", async () => {
    const statePath = tmpState();
    const state = { version: 1 as const, active: 0, counter: 1, sessions: [] };
    const { saveState } = await import("../../src/core/persistence.js");
    saveState(statePath, state);
    const dir = join(statePath, "..");
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp."));
    expect(leftovers).toHaveLength(0);
    // Round-trip: the saved file must load back correctly.
    expect(loadState(statePath)).toMatchObject({ version: 1, sessions: [] });
  });

  // FIX 3: statePathFor must be injective — '/a/b' and '/a.b' produce different paths.
  it("[fix3] statePathFor produces distinct paths for cwds whose slugs collide", () => {
    const p1 = statePathFor("/a/b");
    const p2 = statePathFor("/a.b");
    expect(p1).not.toBe(p2);
    expect(p1.endsWith(".json")).toBe(true);
    expect(p2.endsWith(".json")).toBe(true);
    expect(p1).toContain(join(".claudeshell", "state"));
    // Stability: same input → same path.
    expect(statePathFor("/a/b")).toBe(p1);
  });

  // FIX 4: restoreState must clamp active and coerce counter for bad persisted values.
  it("[fix4] restoreState coerces invalid active/counter values (active:-1, counter:'x')", () => {
    const statePath = tmpState();
    writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        active: -1,
        counter: "x",
        sessions: [{ id: "s1", title: "alpha", cwd: "/tmp" }],
      })
    );
    const m = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery });
    m.restoreState();
    // active must be clamped to 0 — never negative, never out of range.
    expect(m.activeIndex).toBe(0);
    // manager.active must be defined (not undefined).
    expect(m.active).toBeDefined();
    expect(m.active?.title).toBe("alpha");
    // counter must be a finite non-negative integer (falls back to sessions.length = 1).
    const m2 = m as unknown as { counter: number };
    expect(Number.isInteger(m2.counter)).toBe(true);
    expect(m2.counter).toBeGreaterThanOrEqual(0);
  });
});
