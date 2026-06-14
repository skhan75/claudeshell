import { Session } from "./session.js";
import { Terminal, type SpawnFn } from "./terminal.js";
import { loadState, saveState, type SavedState } from "./persistence.js";
import type { QueryFn } from "./types.js";

/** A tab is either a Claude session or a terminal PTY tab. */
export type Tab = Session | Terminal;

/** How `/compact` presents its result. */
export type CompactMode = "new-tab" | "replace" | "summary";

/** Prompt that asks Claude to condense the conversation for continuation. */
function summaryPrompt(focus: string): string {
  return [
    "Summarize our conversation so far into a compact briefing I can continue from.",
    "Capture the goal, key decisions, files/code changed, the current state, and open questions.",
    "Be concise but complete — this replaces the full history.",
    focus ? `Focus especially on: ${focus}.` : "",
  ].filter(Boolean).join(" ");
}

/** The text of the most recent non-empty assistant message (the generated summary). */
function lastAssistantText(s: Session): string | undefined {
  const blocks = s.transcript.blocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "assistant" && b.text.trim()) return b.text;
  }
  return undefined;
}

export interface ManagerOpts {
  cwd: string;
  statePath: string;
  queryFn?: QueryFn;
}

export class SessionManager {
  tabs: Tab[] = [];
  activeIndex = 0;
  private counter = 0;
  private listeners = new Set<() => void>();
  private pendingCompact: { sessionId: string; mode: CompactMode; turnsBefore: number } | null = null;

  constructor(private opts: ManagerOpts) {}

  /** Per-session change handler: drives any pending /compact, then notifies the UI. */
  private onSessionChange(s: Session): void {
    this.maybeFinishCompact(s);
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const l of this.listeners) l();
  }

  /**
   * The active tab ONLY when it is a Claude session; otherwise undefined.
   * This keeps every Claude UI component working unchanged — when a terminal
   * tab is active those components see `undefined` and render null.
   */
  get active(): Session | undefined {
    const tab = this.tabs[this.activeIndex];
    return tab?.kind === "claude" ? tab : undefined;
  }

  /** The active tab of either kind. App + TabBar use this. */
  get activeTab(): Tab | undefined {
    return this.tabs[this.activeIndex];
  }

  create(init?: { resumeSessionId?: string; title?: string }): Session {
    const id = `s${++this.counter}`;
    const session = new Session({
      id,
      cwd: this.opts.cwd,
      queryFn: this.opts.queryFn,
      resumeSessionId: init?.resumeSessionId,
      title: init?.title,
      onChange: () => this.onSessionChange(session),
    });
    this.tabs.push(session);
    this.activeIndex = this.tabs.length - 1;
    this.notify();
    // Warm the new tab eagerly so init data (model/slash/MCP) is ready.
    this.active?.ensureStarted();
    return session;
  }

  createTerminal(init?: { spawnFn?: SpawnFn; cols?: number; rows?: number; cwd?: string }): Terminal {
    const id = `s${++this.counter}`;
    const terminal = new Terminal({
      id,
      cwd: init?.cwd ?? this.opts.cwd,
      cols: init?.cols,
      rows: init?.rows,
      spawnFn: init?.spawnFn,
      onChange: () => this.notify(),
    });
    this.tabs.push(terminal);
    this.activeIndex = this.tabs.length - 1;
    this.notify();
    return terminal;
  }

  activate(index: number): void {
    if (index >= 0 && index < this.tabs.length) {
      this.activeIndex = index;
      this.notify();
      // Warm a Claude tab the first time it is viewed (idempotent for started tabs).
      this.active?.ensureStarted();
    }
  }

  /**
   * Move the active tab by `delta` (e.g. +1 next, -1 previous), wrapping around
   * both ends. The fast keyboard tab-cycle (Ctrl+→ / Ctrl+←) routes here. No-op
   * when there are fewer than two tabs.
   */
  /**
   * Start a /compact: ask Claude to summarize the active conversation, then (when that
   * turn finishes) present the result by `mode` — open it in a new tab, replace this
   * conversation's context in place, or just leave the summary inline. The SDK has no
   * native compaction, so this is a faithful emulation: summarize → reseed a fresh
   * (non-resumed) context with the summary, reclaiming the context window.
   */
  requestCompact(mode: CompactMode, focus = ""): void {
    const s = this.active;
    if (!s || s.status === "crashed") return;
    this.pendingCompact = { sessionId: s.id, mode, turnsBefore: s.transcript.usage.turns };
    s.send(summaryPrompt(focus));
  }

  /** When the summary turn for a pending /compact completes, apply the chosen mode. */
  private maybeFinishCompact(s: Session): void {
    const pc = this.pendingCompact;
    if (!pc || pc.sessionId !== s.id) return;
    if (s.status !== "idle" || s.transcript.usage.turns <= pc.turnsBefore) return;
    this.pendingCompact = null;
    const summary = lastAssistantText(s);
    if (!summary) return;
    const mode = pc.mode;
    // Defer the reseed out of this notify cycle to avoid re-entrant tab mutation.
    queueMicrotask(() => this.applyCompact(s, mode, summary));
  }

  private applyCompact(s: Session, mode: CompactMode, summary: string): void {
    if (mode === "summary") return; // already in the transcript
    const seed =
      "Here is a compacted summary of our prior conversation (the context was condensed to save space):\n\n" +
      summary +
      "\n\nLet's continue from here.";
    if (mode === "new-tab") {
      const fresh = this.create();
      fresh.send(seed);
    } else {
      s.reset();
      s.send(seed);
    }
  }

  cycleActive(delta: number): void {
    const n = this.tabs.length;
    if (n < 2) return;
    this.activate((((this.activeIndex + delta) % n) + n) % n);
  }

  close(id: string): void {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    this.tabs[i].dispose();
    this.tabs.splice(i, 1);
    if (this.tabs.length === 0) this.create();
    if (i < this.activeIndex) this.activeIndex--;
    this.activeIndex = Math.max(0, Math.min(this.activeIndex, this.tabs.length - 1));
    this.notify();
  }

  saveState(): void {
    const state: SavedState = {
      version: 1,
      active: this.activeIndex,
      counter: this.counter,
      // Persist ONLY claude tabs — terminals are ephemeral PTYs.
      sessions: this.tabs
        .filter((t): t is Session => t.kind === "claude")
        .map((s) => ({
          id: s.id, title: s.title, cwd: s.cwd, claudeSessionId: s.claudeSessionId,
        })),
    };
    saveState(this.opts.statePath, state);
  }

  restoreState(): void {
    const state = loadState(this.opts.statePath);
    if (state) {
      for (const saved of state.sessions) {
        if (typeof saved.id !== "string" || typeof saved.title !== "string" || typeof saved.cwd !== "string") {
          continue; // malformed entry — never produce a zombie tab
        }
        const session = new Session({
          id: saved.id,
          cwd: saved.cwd,
          queryFn: this.opts.queryFn,
          resumeSessionId: saved.claudeSessionId,
          title: saved.title,
          onChange: () => this.onSessionChange(session),
        });
        this.tabs.push(session);
      }
      // Validate counter: must be a non-negative integer; fall back to tab
      // count so the next create() id is always beyond any restored id.
      this.counter =
        Number.isInteger(state.counter) && state.counter >= 0
          ? state.counter
          : this.tabs.length;
      // Validate active: must be a non-negative integer within bounds; clamp
      // to [0, tabs.length-1] so manager.activeTab is never undefined.
      this.activeIndex = Number.isInteger(state.active)
        ? Math.max(0, Math.min(state.active, Math.max(0, this.tabs.length - 1)))
        : 0;
    }
    if (this.tabs.length === 0) this.create();
    this.notify();
    // Warm only the active restored tab; the rest warm on activation.
    this.active?.ensureStarted();
  }

  dispose(): void {
    for (const t of this.tabs) t.dispose();
  }
}
