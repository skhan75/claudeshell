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
  // A query that, for each prompt, replies with a one-line summary then a result.
  const summarizeQuery: QueryFn = ({ prompt }) => {
    async function* gen() {
      for await (const _ of prompt) {
        yield { type: "assistant", message: { content: [{ type: "text", text: "COMPACT SUMMARY: the gist" }] } };
        yield { type: "result", subtype: "success", num_turns: 1 };
      }
    }
    return gen();
  };

  it("requestCompact('new-tab') summarizes the active session and opens a fresh seeded tab", async () => {
    const mgr = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: summarizeQuery });
    mgr.create();
    const first = mgr.active!;
    first.transcript.addUser("did a bunch of work");
    expect(mgr.tabs.length).toBe(1);
    mgr.requestCompact("new-tab", "");
    await vi.waitFor(() => expect(mgr.tabs.length).toBe(2));
    expect(mgr.active!.id).not.toBe(first.id); // the new compacted tab is active
    expect(mgr.tabs.some((t) => t.id === first.id)).toBe(true); // original preserved
  });

  it("requestCompact('replace') condenses in place: resets the context, opens no tab", async () => {
    const mgr = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: summarizeQuery });
    const s = mgr.create();
    s.transcript.addUser("did a bunch of work SENTINEL");
    mgr.requestCompact("replace", "");
    await vi.waitFor(() => {
      expect(
        s.transcript.blocks.some((b) => b.kind === "user" && b.text.includes("compacted summary of our prior conversation"))
      ).toBe(true);
    });
    // The verbose history was reset (not appended to), and no new tab was opened.
    expect(s.transcript.blocks.some((b) => b.kind === "user" && b.text.includes("SENTINEL"))).toBe(false);
    expect(mgr.tabs.length).toBe(1);
  });

  it("requestCompact('summary') summarizes in place without opening a tab", async () => {
    const mgr = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: summarizeQuery });
    const s = mgr.create();
    s.transcript.addUser("work");
    mgr.requestCompact("summary", "");
    await vi.waitFor(() =>
      expect(s.transcript.blocks.some((b) => b.kind === "assistant" && b.text.includes("COMPACT SUMMARY"))).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 5)); // let any (absent) reseed microtask run
    expect(mgr.tabs.length).toBe(1);
  });

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

  // --- Editor satellite: open files in $EDITOR (Option C) ---

  it("openInEditor opens $EDITOR at a line as an auto-closing terminal tab", () => {
    const prevEditor = process.env.EDITOR;
    const prevVisual = process.env.VISUAL;
    delete process.env.VISUAL;
    process.env.EDITOR = "nvim";
    try {
      const m = new SessionManager({ cwd: "/proj", statePath: tmpState(), queryFn: noopQuery });
      const claude = m.create();
      let exitCb: ((e: { exitCode: number }) => void) | undefined;
      let captured: { shell: string; args: string[]; cwd: string } | undefined;
      const spawnFn: SpawnFn = (opts) => {
        captured = { shell: opts.shell, args: opts.args, cwd: opts.cwd };
        return {
          onData() {},
          onExit(cb) { exitCb = cb; },
          write() {},
          resize() {},
          kill() {},
        };
      };
      const term = m.openInEditor("src/core/session.ts", 42, spawnFn);
      // It became the active terminal tab.
      expect(m.tabs).toHaveLength(2);
      expect(m.activeTab?.id).toBe(term.id);
      expect(term.kind).toBe("terminal");
      // Spawned the editor at the line, in the project cwd.
      expect(captured?.shell).toBe("nvim");
      expect(captured?.args).toEqual(["+42", "src/core/session.ts"]);
      expect(captured?.cwd).toBe("/proj");
      // Title is the editor marker + basename.
      expect(term.title).toBe("✎ session.ts");
      // Quitting the editor auto-closes the tab and returns to the Claude tab.
      exitCb?.({ exitCode: 0 });
      expect(m.tabs).toHaveLength(1);
      expect(m.activeTab?.id).toBe(claude.id);
    } finally {
      if (prevEditor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = prevEditor;
      if (prevVisual !== undefined) process.env.VISUAL = prevVisual;
    }
  });

  it("openInEditor without a line opens the file directly and prefers $VISUAL", () => {
    const prevEditor = process.env.EDITOR;
    const prevVisual = process.env.VISUAL;
    process.env.EDITOR = "vi";
    process.env.VISUAL = "code -w";
    try {
      const m = new SessionManager({ cwd: "/proj", statePath: tmpState(), queryFn: noopQuery });
      m.create();
      let captured: { shell: string; args: string[] } | undefined;
      const spawnFn: SpawnFn = (opts) => {
        captured = { shell: opts.shell, args: opts.args };
        return { onData() {}, onExit() {}, write() {}, resize() {}, kill() {} };
      };
      const term = m.openInEditor("README.md", undefined, spawnFn);
      expect(captured?.shell).toBe("code -w");
      expect(captured?.args).toEqual(["README.md"]);
      expect(term.title).toBe("✎ README.md");
    } finally {
      if (prevEditor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = prevEditor;
      if (prevVisual === undefined) delete process.env.VISUAL;
      else process.env.VISUAL = prevVisual;
    }
  });

  // --- Fleet: spawnWorkers (Option C Phase 2) ---

  it("spawnWorkers creates n worker tabs, sends each the task, and returns them", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    m.create(); // the caller's tab
    const workers = m.spawnWorkers("do X", 3, {});
    expect(workers).toHaveLength(3);
    expect(workers.map((w) => w.title)).toEqual(["▶ worker 1/3", "▶ worker 2/3", "▶ worker 3/3"]);
    for (const w of workers) {
      expect(w.transcript.blocks.some((b) => b.kind === "user" && b.text === "do X")).toBe(true);
    }
    // 1 caller + 3 workers
    expect(m.tabs.filter((t) => t.kind === "claude")).toHaveLength(4);
  });

  it("spawnWorkers honors label + group", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    m.create();
    const workers = m.spawnWorkers("go", 2, { group: "swarm", label: "swarm" });
    expect(workers.map((w) => w.title)).toEqual(["▶ swarm 1/2", "▶ swarm 2/2"]);
    expect(workers.every((w) => w.group === "swarm")).toBe(true);
  });

  it("spawnWorkers clamps n<1 to a single worker", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    m.create();
    expect(m.spawnWorkers("x", 0, {})).toHaveLength(1);
    expect(m.spawnWorkers("x", -5, {})[0].title).toBe("▶ worker 1/1");
  });

  it("swarm(task, n) spawns n same-task agents tagged group 'swarm'", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    m.create();
    const ws = m.swarm("refactor the parser", 3);
    expect(ws).toHaveLength(3);
    expect(ws.every((w) => w.group === "swarm")).toBe(true);
    expect(ws.map((w) => w.title)).toEqual(["▶ swarm 1/3", "▶ swarm 2/3", "▶ swarm 3/3"]);
    for (const w of ws) {
      expect(w.transcript.blocks.some((b) => b.kind === "user" && b.text === "refactor the parser")).toBe(true);
    }
  });

  it("swarm/spawnWorkers ignore an empty / whitespace task", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    m.create();
    expect(m.swarm("   ", 3)).toEqual([]);
    expect(m.spawnWorkers("", 2, {})).toEqual([]);
  });

  it("spawnWorkers restores the caller's active tab even from a non-zero, non-last index", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    m.create(); // index 0
    const caller = m.create(); // index 1 (middle: a wrong restore to 0 or last would fail)
    m.create(); // index 2
    m.activate(1);
    m.spawnWorkers("go", 3, {}); // workers appended at 3,4,5
    expect(m.activeIndex).toBe(1);
    expect(m.active?.id).toBe(caller.id);
  });

  it("defaultPermissionMode seeds new + restored sessions (autonomous bypass)", () => {
    const statePath = tmpState();
    const m = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery, defaultPermissionMode: "bypassPermissions" });
    expect(m.create().permissionMode).toBe("bypassPermissions");
    // An explicit per-session override (e.g. a fleet worker) still wins.
    expect(m.create({ permissionMode: "plan" }).permissionMode).toBe("plan");
    // Restored sessions also adopt the default.
    m.saveState();
    const m2 = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery, defaultPermissionMode: "bypassPermissions" });
    m2.restoreState();
    expect(m2.tabs.every((t) => t.kind !== "claude" || t.permissionMode === "bypassPermissions")).toBe(true);
  });

  it("spawnWorkers threads permissionMode to each worker", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    m.create();
    const ws = m.spawnWorkers("go", 2, { permissionMode: "acceptEdits" });
    expect(ws.every((w) => w.permissionMode === "acceptEdits")).toBe(true);
  });

  it("spawnWorkers fires subscribers and workers pump in the background while another tab is active", async () => {
    const q: QueryFn = ({ prompt }) => {
      async function* gen() {
        for await (const _ of prompt) {
          yield { type: "result", subtype: "success", num_turns: 1 };
        }
      }
      return gen();
    };
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: q });
    const main = m.create();
    let ticks = 0;
    m.subscribe(() => ticks++);
    const workers = m.spawnWorkers("go", 3, {});
    expect(ticks).toBeGreaterThan(0);
    expect(m.active?.id).toBe(main.id); // caller stays active
    await vi.waitFor(() => {
      for (const w of workers) expect(w.status).toBe("idle"); // all reached idle in the background
    });
  });

  // --- Cost-guard / budgets (Option C Phase 3) ---

  it("totalCostUsd sums claude tabs and ignores terminals", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const a = m.create();
    a.transcript.usage.costUsd = 1.25;
    const b = m.create();
    b.transcript.usage.costUsd = 0.75;
    m.createTerminal({ spawnFn: fakeSpawn });
    expect(m.totalCostUsd()).toBeCloseTo(2.0, 10);
  });

  it("budgetLevel reflects caps; hard takes precedence over soft", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const a = m.create();
    a.transcript.usage.costUsd = 3;
    expect(m.budgetLevel()).toBe("ok"); // no caps
    m.setBudget({ softUsd: 2, hardUsd: 5 });
    expect(m.budgetLevel()).toBe("warn"); // 3 in [2,5)
    a.transcript.usage.costUsd = 6;
    expect(m.budgetLevel()).toBe("over"); // 6 >= 5
  });

  it("setBudget updates caps + fires notify; {} clears; non-positive caps rejected", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    let ticks = 0;
    m.subscribe(() => ticks++);
    m.setBudget({ softUsd: 1, hardUsd: 2 });
    expect(m.budget).toEqual({ softUsd: 1, hardUsd: 2 });
    expect(ticks).toBeGreaterThan(0);
    m.setBudget({ softUsd: -1, hardUsd: 0 });
    expect(m.budget).toEqual({});
  });

  it("guardSpend blocks spawn over hard cap; send is always advisory", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const a = m.create();
    a.transcript.usage.costUsd = 10;
    m.setBudget({ hardUsd: 5 });
    expect(m.guardSpend("spawn").allowed).toBe(false);
    expect(m.guardSpend("spawn").reason).toContain("hard cap");
    expect(m.guardSpend("send").allowed).toBe(true); // never gate a single user prompt
    a.transcript.usage.costUsd = 1;
    expect(m.guardSpend("spawn").allowed).toBe(true);
  });

  it("spawnWorkers is blocked over the hard cap (no new tabs, info appended)", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const a = m.create();
    a.transcript.usage.costUsd = 10;
    m.setBudget({ hardUsd: 5 });
    const before = m.tabs.length;
    expect(m.spawnWorkers("go", 3, {})).toEqual([]);
    expect(m.tabs.length).toBe(before);
    expect(a.transcript.blocks.some((b) => b.kind === "info" && b.text.includes("hard cap"))).toBe(true);
  });

  it("persists + restores caps; a poison persisted cap is dropped; persisted wins over config", () => {
    const statePath = tmpState();
    const m1 = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery });
    m1.create();
    m1.setBudget({ softUsd: 2, hardUsd: 9 });
    m1.saveState();

    const m2 = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery, budget: { hardUsd: 99 } });
    m2.restoreState();
    expect(m2.budget).toEqual({ softUsd: 2, hardUsd: 9 }); // persisted wins over config seed

    writeFileSync(
      statePath,
      JSON.stringify({ version: 1, active: 0, counter: 1, sessions: [{ id: "s1", title: "x", cwd: "/tmp" }], budget: { softUsd: -3, hardUsd: 0 } })
    );
    const m3 = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery });
    m3.restoreState();
    expect(m3.budget).toEqual({}); // poison cap rejected
  });

  it("config budget seeds the caps when there is no persisted state", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery, budget: { hardUsd: 42 } });
    m.restoreState();
    expect(m.budget).toEqual({ hardUsd: 42 });
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
