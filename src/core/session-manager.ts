import path from "node:path";
import { Session } from "./session.js";
import { Terminal, type SpawnFn } from "./terminal.js";
import { loadState, saveState, type SavedState } from "./persistence.js";
import { workerTitle, lastAssistantText } from "./fleet.js";
import type { BudgetCaps, QueryFn } from "./types.js";

/** Keep only finite, positive caps — a corrupt/zombie cap must never brick spawning. */
function sanitizeCaps(caps: BudgetCaps | undefined): BudgetCaps {
  const out: BudgetCaps = {};
  if (caps && typeof caps.softUsd === "number" && Number.isFinite(caps.softUsd) && caps.softUsd > 0) out.softUsd = caps.softUsd;
  if (caps && typeof caps.hardUsd === "number" && Number.isFinite(caps.hardUsd) && caps.hardUsd > 0) out.hardUsd = caps.hardUsd;
  return out;
}

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

export interface ManagerOpts {
  cwd: string;
  statePath: string;
  queryFn?: QueryFn;
  /** Initial cost-guard caps (from config); persisted caps win over these on restore. */
  budget?: BudgetCaps;
}

export class SessionManager {
  tabs: Tab[] = [];
  activeIndex = 0;
  private counter = 0;
  private listeners = new Set<() => void>();
  private pendingCompact: { sessionId: string; mode: CompactMode; turnsBefore: number } | null = null;
  private _budget: BudgetCaps = {};

  constructor(private opts: ManagerOpts) {
    this._budget = sanitizeCaps(opts.budget);
  }

  /** Current cost-guard caps (USD). The single source of truth — not in the store. */
  get budget(): Readonly<BudgetCaps> {
    return this._budget;
  }

  /** Set/clear caps. `setBudget({})` clears both. Persists on next saveState (exit). */
  setBudget(caps: BudgetCaps): void {
    this._budget = sanitizeCaps(caps);
    this.notify();
  }

  /** Total spend across ALL Claude tabs (terminals have no cost) — the fleet bill. */
  totalCostUsd(): number {
    return this.tabs.reduce((sum, t) => sum + (t.kind === "claude" ? t.transcript.usage.costUsd : 0), 0);
  }

  /** Where total spend sits relative to the caps. hardUsd takes precedence over softUsd. */
  budgetLevel(): "ok" | "warn" | "over" {
    const c = this._budget;
    const total = this.totalCostUsd();
    if (c.hardUsd != null && total >= c.hardUsd) return "over";
    if (c.softUsd != null && total >= c.softUsd) return "warn";
    return "ok";
  }

  /**
   * The single cost-guard enforcement seam. A `spawn` over the hard cap is BLOCKED
   * (the multiplicative spender); a single `send` is ALWAYS advisory — we never silently
   * drop a user's prompt (a hard send-stop, if ever wanted, is a UI-layer veto, not here).
   */
  guardSpend(kind: "send" | "spawn"): { allowed: boolean; level: "ok" | "warn" | "over"; reason?: string } {
    const level = this.budgetLevel();
    if (kind === "spawn" && level === "over") {
      return {
        allowed: false,
        level,
        reason: `over hard cap ($${this.totalCostUsd().toFixed(2)} ≥ $${this._budget.hardUsd}) — raise it in /budget to spawn more agents`,
      };
    }
    return { allowed: true, level };
  }

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

  create(init?: { resumeSessionId?: string; title?: string; group?: string; permissionMode?: string; forkSession?: boolean }): Session {
    const id = `s${++this.counter}`;
    const session = new Session({
      id,
      cwd: this.opts.cwd,
      queryFn: this.opts.queryFn,
      resumeSessionId: init?.resumeSessionId,
      title: init?.title,
      group: init?.group,
      permissionMode: init?.permissionMode,
      forkSession: init?.forkSession,
      onChange: () => this.onSessionChange(session),
    });
    this.tabs.push(session);
    this.activeIndex = this.tabs.length - 1;
    this.notify();
    // Warm the new tab eagerly so init data (model/slash/MCP) is ready.
    this.active?.ensureStarted();
    return session;
  }

  /**
   * Spawn a fleet of `n` worker agents on the same `task` — the single choke-point for
   * all multi-agent creation (`/parallel`, and `/swarm` via {@link swarm}). Each worker
   * is its own background Session that pumps independently. The caller's active tab is
   * preserved (the UI opens the Fleet dashboard instead of yanking focus into a worker).
   * Returns the created sessions.
   */
  spawnWorkers(task: string, n: number, opts?: { group?: string; label?: string; permissionMode?: string }): Session[] {
    if (!task.trim()) return [];
    // Cost-guard: a fleet is the big multiplicative spender — block it over the hard cap.
    const guard = this.guardSpend("spawn");
    if (!guard.allowed) {
      this.active?.transcript.addInfo(`◆ fleet not spawned — ${guard.reason}`);
      this.notify();
      return [];
    }
    const count = Math.max(1, Math.floor(n) || 1);
    const callerIndex = this.activeIndex;
    const label = opts?.label ?? "worker";
    const workers: Session[] = [];
    // First pass: create all tabs (create() warms each — workers SHOULD start).
    for (let i = 1; i <= count; i++) {
      workers.push(this.create({ title: workerTitle(i, count, label), group: opts?.group, permissionMode: opts?.permissionMode }));
    }
    // Second pass: hand each worker its task.
    for (const w of workers) w.send(task);
    // Restore focus to where the user was; a single notify settles the UI.
    this.activeIndex = Math.min(callerIndex, this.tabs.length - 1);
    this.notify();
    return workers;
  }

  /**
   * `/swarm` — spawn `n` agents on the SAME task as a competing group (tagged
   * `group: "swarm"` so the fleet dashboard's compare view can pick them out).
   * A thin framing over {@link spawnWorkers}; inherits its cost-guard + focus behavior.
   */
  swarm(task: string, n: number, opts?: { group?: string; permissionMode?: string }): Session[] {
    return this.spawnWorkers(task, n, { group: opts?.group ?? "swarm", label: "swarm", permissionMode: opts?.permissionMode });
  }

  /**
   * Fork a session into a new tab that RESUMES the same Claude context — a branch point
   * for exploring a divergent path. Returns null (no tab created) when the parent has no
   * resumable context yet (`claudeSessionId` is only set after the SDK init) or is mid-turn
   * (concurrent resume of one session id is unsafe) — the UI surfaces a hint in that case.
   */
  fork(s: Session, opts?: { group?: string }): Session | null {
    const rid = s.claudeSessionId;
    if (!rid) return null;
    // Fork from a settled point — never mid-turn. forkSession branches to a fresh
    // server-side id, so the parent and fork never share one live session id.
    if (s.status === "processing" || s.status === "awaiting-permission" || s.status === "awaiting-input") return null;
    const base = s.title.replace(/^⑂ /, ""); // don't stack ⑂ prefixes on re-forks
    return this.create({ resumeSessionId: rid, forkSession: true, title: `⑂ ${base}`, group: opts?.group });
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

  /**
   * Option C "editor satellite": open `file` in the user's own `$EDITOR`
   * (`VISUAL ?? EDITOR ?? "vi"`) as a dedicated terminal tab, optionally jumping to
   * `line`. claudeshell never rebuilds the editor — it hands the file to the editor
   * the user already lives in, then disposes the tab automatically when they quit it,
   * returning focus to the tab they came from.
   */
  openInEditor(file: string, line?: number, spawnFn?: SpawnFn): Terminal {
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    const args = line && line > 0 ? [`+${line}`, file] : [file];
    const id = `s${++this.counter}`;
    const term = new Terminal({
      id,
      cwd: this.opts.cwd,
      shell: editor,
      args,
      title: `✎ ${path.basename(file)}`,
      spawnFn,
      onChange: () => {
        const t = this.tabs.find((x) => x.id === id);
        // Auto-close the satellite when the editor process exits; otherwise it is a
        // normal screen update — re-render.
        if (t && t.kind === "terminal" && t.status === "exited") this.close(id);
        else this.notify();
      },
    });
    this.tabs.push(term);
    this.activeIndex = this.tabs.length - 1;
    this.notify();
    return term;
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
      budget: this._budget,
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
      // Persisted caps (the user's most recent /budget) win over the config seed.
      // Sanitize so a corrupt state.json can't install a negative/NaN poison cap.
      if (state.budget !== undefined) this._budget = sanitizeCaps(state.budget);
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
