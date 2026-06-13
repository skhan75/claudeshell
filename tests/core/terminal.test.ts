import { describe, it, expect, vi } from "vitest";
import { Terminal } from "../../src/core/terminal.js";
import type { PtyLike, SpawnFn } from "../../src/core/terminal.js";

// ---------------------------------------------------------------------------
// Fake PTY helper — no real shell spawned
// ---------------------------------------------------------------------------

interface FakePty extends PtyLike {
  _dataHandlers: Array<(data: string) => void>;
  _exitHandlers: Array<(e: { exitCode: number }) => void>;
  _written: string[];
  _resizeCalls: Array<{ cols: number; rows: number }>;
  _killCount: number;
  /** Push data as if it arrived from the PTY process */
  pushData(data: string): void;
  /** Trigger an exit event */
  pushExit(exitCode: number): void;
}

function makeFakePty(): FakePty {
  const pty: FakePty = {
    _dataHandlers: [],
    _exitHandlers: [],
    _written: [],
    _resizeCalls: [],
    _killCount: 0,

    onData(cb) {
      this._dataHandlers.push(cb);
    },
    onExit(cb) {
      this._exitHandlers.push(cb);
    },
    write(data) {
      this._written.push(data);
    },
    resize(cols, rows) {
      this._resizeCalls.push({ cols, rows });
    },
    kill() {
      this._killCount++;
    },
    pushData(data) {
      for (const h of this._dataHandlers) h(data);
    },
    pushExit(exitCode) {
      for (const h of this._exitHandlers) h({ exitCode });
    },
  };
  return pty;
}

function makeSpawnFn(pty: FakePty): SpawnFn {
  return () => pty;
}

// Wait for xterm's async write to flush.
// xterm.write() is asynchronous — the callback fires after the buffer is updated.
// We wait for setTimeout(0) twice to ensure the microtask/macrotask queue drains.
function nextTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Terminal core", () => {
  it("feeding PTY data renders to the screen", async () => {
    const pty = makeFakePty();
    const term = new Terminal({
      id: "t1",
      cwd: "/tmp",
      spawnFn: makeSpawnFn(pty),
    });

    pty.pushData("hello\r\nworld");
    await nextTick();

    const { lines } = term.snapshot();
    expect(lines.some((l) => l.includes("hello"))).toBe(true);
    expect(lines.some((l) => l.includes("world"))).toBe(true);

    term.dispose();
  });

  it("write() forwards keystrokes to the PTY", () => {
    const pty = makeFakePty();
    const term = new Terminal({
      id: "t2",
      cwd: "/tmp",
      spawnFn: makeSpawnFn(pty),
    });

    term.write("ls -la\r");

    expect(pty._written).toContain("ls -la\r");

    term.dispose();
  });

  it("resize() updates snapshot row count and forwards to the PTY", async () => {
    const pty = makeFakePty();
    const term = new Terminal({
      id: "t3",
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      spawnFn: makeSpawnFn(pty),
    });

    term.resize(20, 10);
    await nextTick();

    expect(term.snapshot().lines.length).toBe(10);
    expect(pty._resizeCalls).toContainEqual({ cols: 20, rows: 10 });

    term.dispose();
  });

  it("onExit sets status 'exited' + exitCode; write() after exit is a no-op", () => {
    const pty = makeFakePty();
    const term = new Terminal({
      id: "t4",
      cwd: "/tmp",
      spawnFn: makeSpawnFn(pty),
    });

    pty.pushExit(42);

    expect(term.status).toBe("exited");
    expect(term.exitCode).toBe(42);

    // write after exit must not push to the fake PTY's written array
    const before = pty._written.length;
    term.write("should-be-ignored");
    expect(pty._written.length).toBe(before);

    term.dispose();
  });

  it("dispose() calls pty.kill() and sets status 'exited'", () => {
    const pty = makeFakePty();
    const term = new Terminal({
      id: "t5",
      cwd: "/tmp",
      spawnFn: makeSpawnFn(pty),
    });

    term.dispose();

    expect(pty._killCount).toBe(1);
    expect(term.status).toBe("exited");
  });

  it("title derives from the shell basename", () => {
    const pty = makeFakePty();
    const term = new Terminal({
      id: "t6",
      cwd: "/tmp",
      shell: "/bin/zsh",
      spawnFn: makeSpawnFn(pty),
    });

    expect(term.title).toBe("zsh");

    term.dispose();
  });

  it("onChange callback fires on data and exit", async () => {
    const pty = makeFakePty();
    let count = 0;
    const term = new Terminal({
      id: "t7",
      cwd: "/tmp",
      spawnFn: makeSpawnFn(pty),
      onChange: () => { count++; },
    });

    pty.pushData("ping");
    await nextTick();
    expect(count).toBeGreaterThanOrEqual(1);

    const before = count;
    pty.pushExit(0);
    expect(count).toBeGreaterThan(before);

    term.dispose();
  });
});
