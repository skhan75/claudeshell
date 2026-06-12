import { Session } from "./session.js";
import { loadState, saveState, type SavedState } from "./persistence.js";
import type { QueryFn } from "./types.js";

export interface ManagerOpts {
  cwd: string;
  statePath: string;
  queryFn?: QueryFn;
}

export class SessionManager {
  sessions: Session[] = [];
  activeIndex = 0;
  private counter = 0;
  private listeners = new Set<() => void>();

  constructor(private opts: ManagerOpts) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const l of this.listeners) l();
  }

  get active(): Session | undefined {
    return this.sessions[this.activeIndex];
  }

  create(init?: { resumeSessionId?: string; title?: string }): Session {
    const id = `s${++this.counter}`;
    const session = new Session({
      id,
      cwd: this.opts.cwd,
      queryFn: this.opts.queryFn,
      resumeSessionId: init?.resumeSessionId,
      title: init?.title,
      onChange: () => this.notify(),
    });
    this.sessions.push(session);
    this.activeIndex = this.sessions.length - 1;
    this.notify();
    return session;
  }

  activate(index: number): void {
    if (index >= 0 && index < this.sessions.length) {
      this.activeIndex = index;
      this.notify();
    }
  }

  close(id: string): void {
    const i = this.sessions.findIndex((s) => s.id === id);
    if (i === -1) return;
    this.sessions[i].dispose();
    this.sessions.splice(i, 1);
    if (this.sessions.length === 0) this.create();
    if (i < this.activeIndex) this.activeIndex--;
    this.activeIndex = Math.max(0, Math.min(this.activeIndex, this.sessions.length - 1));
    this.notify();
  }

  saveState(): void {
    const state: SavedState = {
      version: 1,
      active: this.activeIndex,
      counter: this.counter,
      sessions: this.sessions.map((s) => ({
        id: s.id, title: s.title, cwd: s.cwd, claudeSessionId: s.claudeSessionId,
      })),
    };
    saveState(this.opts.statePath, state);
  }

  restoreState(): void {
    const state = loadState(this.opts.statePath);
    if (state) {
      this.counter = state.counter;
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
          onChange: () => this.notify(),
        });
        this.sessions.push(session);
      }
      this.activeIndex = Math.min(state.active, Math.max(0, this.sessions.length - 1));
    }
    if (this.sessions.length === 0) this.create();
    this.notify();
  }

  dispose(): void {
    for (const s of this.sessions) s.dispose();
  }
}
