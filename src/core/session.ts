import { AsyncQueue } from "./async-queue.js";
import { Transcript } from "./transcript.js";
import type {
  AccountInfo, McpServerStatus, ModelInfo,
  PermissionRequest, PermissionResult, QueryFn, QueryHandle, SdkMessage, SessionStatus,
} from "./types.js";

let permissionSeq = 0;

export interface SessionOpts {
  id: string;
  cwd: string;
  queryFn?: QueryFn;
  resumeSessionId?: string;
  title?: string;
  onChange?: () => void;
}

async function defaultQueryFn(args: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  return query(args as never) as unknown as QueryHandle;
}

/** Wraps defaultQueryFn's dynamic import behind the sync QueryFn shape. */
function lazyQuery(): QueryFn {
  return ({ prompt, options }) => {
    const handlePromise = defaultQueryFn({ prompt, options });
    // Avoid unhandledRejection before a consumer attaches; pump() will observe the
    // same rejection through the iterator and crash the tab cleanly.
    handlePromise.catch(() => {});
    return {
      async *[Symbol.asyncIterator]() {
        const h = await handlePromise;
        for await (const m of h) yield m;
      },
      interrupt: async () => {
        try {
          await (await handlePromise).interrupt?.();
        } catch {
          // best effort — a dead handle has nothing to interrupt
        }
      },
      setPermissionMode: async (m: string) => {
        try {
          await (await handlePromise).setPermissionMode?.(m);
        } catch {
          // best effort
        }
      },
      setModel: async (m: string) => {
        try {
          await (await handlePromise).setModel?.(m);
        } catch {
          // best effort
        }
      },
      close: async () => {
        try {
          await (await handlePromise).close?.();
        } catch {
          // best effort
        }
      },
      supportedModels: async () => {
        try {
          return (await (await handlePromise).supportedModels?.()) ?? [];
        } catch {
          return [];
        }
      },
      supportedCommands: async () => {
        try {
          return (await (await handlePromise).supportedCommands?.()) ?? [];
        } catch {
          return [];
        }
      },
      mcpServerStatus: async () => {
        try {
          return (await (await handlePromise).mcpServerStatus?.()) ?? [];
        } catch {
          return [];
        }
      },
      reconnectMcpServer: async (name: string) => {
        try {
          await (await handlePromise).reconnectMcpServer?.(name);
        } catch {
          // best effort
        }
      },
      toggleMcpServer: async (name: string, enabled: boolean) => {
        try {
          await (await handlePromise).toggleMcpServer?.(name, enabled);
        } catch {
          // best effort
        }
      },
      accountInfo: async () => {
        try {
          return await (await handlePromise).accountInfo?.();
        } catch {
          return undefined;
        }
      },
    };
  };
}

export class Session {
  readonly kind = "claude" as const;
  readonly id: string;
  readonly cwd: string;
  title: string;
  status: SessionStatus = "idle";
  turnStartedAt: number | null = null;
  /** Messages submitted while a turn was already running, waiting their turn. */
  queuedCount = 0;
  /** Live SDK capability data, pulled once the session initializes (best-effort). */
  availableModels: ModelInfo[] = [];
  account: AccountInfo | null = null;
  mcpStatus: McpServerStatus[] = [];
  private capabilitiesFetched = false;
  transcript = new Transcript();
  pendingPermission: PermissionRequest | null = null;
  error: string | null = null;
  permissionMode = "default";

  private permissionBacklog: PermissionRequest[] = [];
  private interrupted = false;
  private started = false;
  private queue: AsyncQueue<unknown> | null = null;
  private handle: QueryHandle | null = null;
  private queryFn: QueryFn;
  private claudeId?: string;
  private model?: string;
  private onChange: () => void;
  private titled: boolean;

  constructor(opts: SessionOpts) {
    this.id = opts.id;
    this.cwd = opts.cwd;
    this.title = opts.title ?? "new session";
    this.titled = opts.title !== undefined;
    this.queryFn = opts.queryFn ?? lazyQuery();
    this.claudeId = opts.resumeSessionId;
    this.onChange = opts.onChange ?? (() => {});
  }

  get claudeSessionId(): string | undefined {
    return this.claudeId;
  }

  send(text: string): void {
    if (this.status === "crashed") return;
    // Sending while a turn is already running queues the message (Claude's streaming
    // input processes it after the current turn); track the backlog for the UI.
    const wasProcessing = this.status === "processing";
    this.interrupted = false;
    if (!this.titled) {
      this.title = text.length > 24 ? text.slice(0, 23) + "…" : text;
      this.titled = true;
    }
    // Open the query if it isn't already (eager warmup may have done this).
    this.ensureStarted();
    this.transcript.addUser(text);
    if (wasProcessing) this.queuedCount++;
    this.status = "processing";
    this.turnStartedAt = Date.now();
    this.queue!.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
    this.onChange();
  }

  /**
   * Open the SDK query eagerly so the system `init` message (model, slash
   * commands, MCP servers) arrives before the first prompt. Opening the query
   * is NOT a turn: status stays whatever it was (idle on a fresh tab), no
   * prompt is pushed, so there is no model call, no tokens, no cost. Idempotent.
   */
  ensureStarted(): void {
    if (!this.started && this.status !== "crashed") this.start();
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.queue = new AsyncQueue<unknown>();
    const options: Record<string, unknown> = {
      cwd: this.cwd,
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      permissionMode: this.permissionMode,
      canUseTool: (toolName: string, input: Record<string, unknown>, o?: { suggestions?: unknown[] }) =>
        this.requestPermission(toolName, input, (o?.suggestions ?? []) as PermissionRequest["suggestions"]),
    };
    if (this.claudeId) options.resume = this.claudeId;
    if (this.model) options.model = this.model;
    this.handle = this.queryFn({ prompt: this.queue, options });
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for await (const msg of this.handle!) {
        this.consume(msg);
        this.onChange();
      }
      if (this.status !== "crashed") {
        this.status = "idle";
        this.turnStartedAt = null;
      }
    } catch (err) {
      this.status = "crashed";
      this.turnStartedAt = null;
      this.queuedCount = 0;
      // Drop capability data from the dead connection; re-pull after a resume.
      this.capabilitiesFetched = false;
      this.availableModels = [];
      this.account = null;
      this.mcpStatus = [];
      this.error = err instanceof Error ? err.message : String(err);
      this.transcript.addInfo(`✖ session crashed: ${this.error} — press r to resume`);
      // Allow a later ensureStarted()/resume() to reconnect.
      this.started = false;
      this.queue = null;
      this.handle = null;
      // dialogs can never be answered on a dead stream
      this.drainPermissions("session crashed");
    }
    this.onChange();
  }

  private consume(msg: SdkMessage): void {
    this.transcript.apply(msg);
    if (msg.type === "system" && msg.subtype === "init") {
      if (msg.session_id) this.claudeId = msg.session_id;
      // The query is now initialized — pull the SDK's live model/account/MCP data.
      this.fetchCapabilities();
    }
    if (msg.type === "result") {
      // A turn finished; the next queued message (if any) begins processing.
      if (this.queuedCount > 0) this.queuedCount--;
      this.status = this.queuedCount > 0 ? "processing" : "idle";
      this.turnStartedAt = this.queuedCount > 0 ? Date.now() : null;
      this.interrupted = false;
    }
  }

  /** Deny and clear every pending/queued permission request. */
  private drainPermissions(message: string): void {
    const all = [this.pendingPermission, ...this.permissionBacklog]
      .filter((p): p is PermissionRequest => p !== null);
    this.pendingPermission = null;
    this.permissionBacklog = [];
    for (const p of all) p.resolve({ behavior: "deny", message });
  }

  private requestPermission(
    toolName: string,
    input: Record<string, unknown>,
    suggestions: PermissionRequest["suggestions"]
  ): Promise<PermissionResult> {
    return new Promise((resolvePromise) => {
      if (this.interrupted) {
        resolvePromise({ behavior: "deny", message: "session interrupted" });
        return;
      }
      let settled = false;
      const request: PermissionRequest = {
        id: `perm-${++permissionSeq}`,
        toolName,
        input,
        suggestions,
        resolve: (r: PermissionResult) => {
          if (settled) return;
          settled = true;
          if (this.pendingPermission === request) {
            this.pendingPermission = this.permissionBacklog.shift() ?? null;
          } else {
            this.permissionBacklog = this.permissionBacklog.filter((q) => q !== request);
          }
          if (this.pendingPermission) {
            this.status =
              this.pendingPermission.toolName === "AskUserQuestion" ? "awaiting-input" : "awaiting-permission";
          } else if (this.status === "awaiting-permission" || this.status === "awaiting-input") {
            this.status = "processing";
          }
          resolvePromise(r);
          this.onChange();
        },
      };
      if (this.pendingPermission) {
        this.permissionBacklog.push(request);
      } else {
        this.pendingPermission = request;
        this.status = toolName === "AskUserQuestion" ? "awaiting-input" : "awaiting-permission";
      }
      this.onChange();
    });
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
    this.queuedCount = 0; // interrupting drops anything still queued
    this.drainPermissions("session interrupted");
    await this.handle?.interrupt?.();
    this.status = "idle";
    this.onChange();
  }

  async setPermissionMode(mode: string): Promise<void> {
    this.permissionMode = mode;
    await this.handle?.setPermissionMode?.(mode);
    this.onChange();
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    await this.handle?.setModel?.(model);
    this.transcript.meta.model = model;
    this.onChange();
  }

  /** Pull the SDK's live capability data once the session has initialized
   *  (supportedModels / accountInfo / mcpServerStatus). Best-effort — fakes/older
   *  SDKs simply leave the defaults. */
  private fetchCapabilities(): void {
    if (this.capabilitiesFetched || !this.handle) return;
    this.capabilitiesFetched = true;
    const h = this.handle;
    // Guard every callback on `this.handle === h`: if the session crashed, was
    // disposed, or resumed onto a new handle before these resolve, the stale result
    // from the dead connection is dropped (no UI write, no onChange on a gone tab).
    void h.supportedModels?.()
      .then((m) => { if (this.handle === h && m && m.length) { this.availableModels = m; this.onChange(); } })
      .catch(() => {});
    void h.accountInfo?.()
      .then((a) => { if (this.handle === h && a) { this.account = a; this.onChange(); } })
      .catch(() => {});
    void this.refreshMcpStatus();
  }

  private async refreshMcpStatus(): Promise<void> {
    const h = this.handle;
    if (!h) return;
    try {
      const s = await h.mcpServerStatus?.();
      if (this.handle === h && s) { this.mcpStatus = s; this.onChange(); }
    } catch {
      // best effort
    }
  }

  /** Reconnect a configured MCP server (SDK control request). */
  async reconnectMcp(name: string): Promise<void> {
    await this.handle?.reconnectMcpServer?.(name);
    await this.refreshMcpStatus();
  }

  /** Enable/disable a configured MCP server (SDK control request). */
  async toggleMcp(name: string, enabled: boolean): Promise<void> {
    await this.handle?.toggleMcpServer?.(name, enabled);
    await this.refreshMcpStatus();
  }

  /**
   * Clear the conversation (like the CLI's /clear): drop the transcript + context and
   * start a fresh Claude session with NO resume, so the context window resets. Keeps
   * the tab and its title; warms a new query eagerly.
   */
  reset(): void {
    void this.handle?.close?.();
    this.drainPermissions("conversation cleared");
    this.queue?.end();
    this.queue = null;
    this.handle = null;
    this.started = false;
    this.transcript = new Transcript();
    this.status = "idle";
    this.turnStartedAt = null;
    this.queuedCount = 0;
    this.capabilitiesFetched = false;
    this.availableModels = [];
    this.account = null;
    this.mcpStatus = [];
    this.claudeId = undefined; // fresh Claude session — do not resume the old context
    this.error = null;
    this.onChange();
    this.ensureStarted();
  }

  /** Recover a crashed tab: next send() starts a fresh query resuming the same Claude session. */
  resume(): void {
    if (this.status !== "crashed") return;
    this.status = "idle";
    this.error = null;
    this.started = false;
    this.queue = null;
    this.handle = null;
    this.onChange();
  }

  dispose(): void {
    void this.handle?.close?.();
    this.drainPermissions("session closed");
    this.queue?.end();
    this.queue = null;
    this.handle = null;
  }
}
