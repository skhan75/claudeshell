import { AsyncQueue } from "./async-queue.js";
import { Transcript } from "./transcript.js";
import type {
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
    };
  };
}

export class Session {
  readonly id: string;
  readonly cwd: string;
  title: string;
  status: SessionStatus = "idle";
  transcript = new Transcript();
  pendingPermission: PermissionRequest | null = null;
  error: string | null = null;
  permissionMode = "default";

  private permissionBacklog: PermissionRequest[] = [];
  private interrupted = false;
  private queue: AsyncQueue<unknown> | null = null;
  private handle: QueryHandle | null = null;
  private queryFn: QueryFn;
  private claudeId?: string;
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
    this.interrupted = false;
    if (!this.titled) {
      this.title = text.length > 24 ? text.slice(0, 23) + "…" : text;
      this.titled = true;
    }
    this.transcript.addUser(text);
    this.status = "processing";
    if (!this.queue) this.start();
    this.queue!.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
    this.onChange();
  }

  private start(): void {
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
    this.handle = this.queryFn({ prompt: this.queue, options });
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for await (const msg of this.handle!) {
        this.consume(msg);
        this.onChange();
      }
      if (this.status !== "crashed") this.status = "idle";
    } catch (err) {
      this.status = "crashed";
      this.error = err instanceof Error ? err.message : String(err);
      this.transcript.addInfo(`✖ session crashed: ${this.error} — press r to resume`);
      this.queue = null;
      this.handle = null;
      // dialogs can never be answered on a dead stream
      this.drainPermissions("session crashed");
    }
    this.onChange();
  }

  private consume(msg: SdkMessage): void {
    this.transcript.apply(msg);
    if (msg.type === "system" && msg.subtype === "init" && msg.session_id) this.claudeId = msg.session_id;
    if (msg.type === "result") {
      this.status = "idle";
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

  /** Recover a crashed tab: next send() starts a fresh query resuming the same Claude session. */
  resume(): void {
    if (this.status !== "crashed") return;
    this.status = "idle";
    this.error = null;
    this.queue = null;
    this.handle = null;
    this.onChange();
  }

  dispose(): void {
    this.drainPermissions("session closed");
    this.queue?.end();
    this.queue = null;
    this.handle = null;
  }
}
