import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "../../src/core/session-manager.js";
import { loadState } from "../../src/core/persistence.js";
import type { QueryFn } from "../../src/core/types.js";

const noopQuery: QueryFn = ({ prompt }) => {
  async function* gen() {
    for await (const _ of prompt) return;
  }
  return gen();
};

function tmpState(): string {
  return join(mkdtempSync(join(tmpdir(), "cs-state-")), "state.json");
}

describe("SessionManager", () => {
  it("creates, activates, and closes sessions", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const a = m.create();
    const b = m.create();
    expect(m.sessions).toHaveLength(2);
    expect(m.active?.id).toBe(b.id);
    m.activate(0);
    expect(m.active?.id).toBe(a.id);
    m.close(a.id);
    expect(m.sessions).toHaveLength(1);
    expect(m.active?.id).toBe(b.id);
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
    expect(m2.sessions).toHaveLength(1);
    expect(m2.sessions[0].title).toBe("jwt work");
    expect(m2.sessions[0].claudeSessionId).toBe("claude-abc");
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
    expect(m.sessions.length).toBe(1);
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
    expect(m.sessions).toHaveLength(1);
    expect(m.sessions[0].title).toBe("good");
  });
});
