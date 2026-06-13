import { createRequire } from "node:module";
import path from "node:path";
import pkg from "@xterm/headless";

const { Terminal: XTerm } = pkg;
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Injectable PTY interface (keeps node-pty out of tests)
// ---------------------------------------------------------------------------

export interface PtyLike {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type SpawnFn = (opts: {
  cwd: string;
  cols: number;
  rows: number;
  shell: string;
  env: NodeJS.ProcessEnv;
}) => PtyLike;

// ---------------------------------------------------------------------------
// Default spawn — lazily requires node-pty so importing this module never
// throws on platforms where the native addon can't load.
// ---------------------------------------------------------------------------

const defaultSpawn: SpawnFn = ({ cwd, cols, rows, shell, env }) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawn } = require("node-pty") as typeof import("node-pty");
  return spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env,
  }) as unknown as PtyLike;
};

// ---------------------------------------------------------------------------
// Terminal class
// ---------------------------------------------------------------------------

export interface TerminalOpts {
  id: string;
  cwd: string;
  shell?: string;
  cols?: number;
  rows?: number;
  env?: NodeJS.ProcessEnv;
  onChange?: () => void;
  spawnFn?: SpawnFn;
}

export class Terminal {
  readonly kind = "terminal" as const;
  readonly id: string;
  cwd: string;
  title: string;
  status: "running" | "exited" = "running";
  exitCode: number | null = null;

  private readonly xterm: InstanceType<typeof XTerm>;
  private readonly pty: PtyLike;
  private readonly onChange: () => void;
  private _cols: number;
  private _rows: number;

  constructor(opts: TerminalOpts) {
    const {
      id,
      cwd,
      shell = process.env.SHELL ?? "/bin/bash",
      cols = 80,
      rows = 24,
      env = process.env,
      onChange = () => {},
      spawnFn = defaultSpawn,
    } = opts;

    this.id = id;
    this.cwd = cwd;
    this.onChange = onChange;
    this._cols = cols;
    this._rows = rows;

    // Derive title from the shell basename, falling back to "terminal".
    const base = path.basename(shell);
    this.title = base || "terminal";

    // Create the headless xterm terminal (screen buffer).
    this.xterm = new XTerm({ cols, rows, allowProposedApi: true });

    // Spawn the PTY process.
    this.pty = spawnFn({ cwd, cols, rows, shell, env });

    // Wire PTY data → xterm screen buffer.
    // Use the write callback so onChange fires only after the buffer is flushed.
    this.pty.onData((data) => {
      this.xterm.write(data, () => { this.onChange(); });
    });

    // Wire PTY exit.
    this.pty.onExit((e) => {
      this.status = "exited";
      this.exitCode = e.exitCode;
      this.onChange();
    });
  }

  /** Forward a keystroke / input to the PTY. No-op if the process has exited. */
  write(data: string): void {
    if (this.status === "exited") return;
    this.pty.write(data);
  }

  /** Resize both the PTY and the xterm screen buffer. No-op if exited. */
  resize(cols: number, rows: number): void {
    if (this.status === "exited") return;
    this._cols = cols;
    this._rows = rows;
    this.pty.resize(cols, rows);
    this.xterm.resize(cols, rows);
  }

  /**
   * Return a snapshot of the current xterm screen.
   * Each element of `lines` corresponds to one visible row (0-based).
   */
  snapshot(): { lines: string[]; cursorX: number; cursorY: number } {
    const buf = this.xterm.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < this._rows; i++) {
      lines.push(buf.getLine(i)?.translateToString(true) ?? "");
    }
    return {
      lines,
      cursorX: buf.cursorX,
      cursorY: buf.cursorY,
    };
  }

  /** Kill the PTY and dispose the xterm buffer. */
  dispose(): void {
    try {
      this.pty.kill();
    } catch {
      // best-effort — process may already be gone
    }
    this.xterm.dispose();
    this.status = "exited";
  }
}
