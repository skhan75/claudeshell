import { AsyncQueue } from "./async-queue.js";
import { Transcript } from "./transcript.js";
import type {
  PermissionRequest, PermissionResult, QueryFn, QueryHandle, SdkMessage, SessionStatus,
} from "./types.js";

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
    return {
      async *[Symbol.asyncIterator]() {
        const h = await handlePromise;
        for await (const m of h) yield m;
      },
      interrupt: async () => (await handlePromise).interrupt?.(),
      setPermissionMode: async (m: string) => (await handlePromise).setPermissionMode?.(m),
      setModel: async (m: string) => (await handlePromise).setModel?.(m),
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
    if (!this.titled) {
      this.title = text.length > 24 ? text.slice(0, 23) + "…" : text;
      this.titled = true;
    }
    this.transcript.addUser(text);
    this.status = "processing";
    if (!this.queue) this.start();
    this.queue!.push({ type: "user", message: { role: "user", content: text } });
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
      this.queue = null;
      this.handle = null;
      // a pending dialog can never be answered on a dead stream
      this.pendingPermission?.resolve({ behavior: "deny", message: "session crashed" });
    }
    this.onChange();
  }

  private consume(msg: SdkMessage): void {
    this.transcript.apply(msg);
    if (msg.type === "system" && msg.subtype === "init" && msg.session_id) this.claudeId = msg.session_id;
    if (msg.type === "result") this.status = "idle";
  }

  private requestPermission(
    toolName: string,
    input: Record<string, unknown>,
    suggestions: PermissionRequest["suggestions"]
  ): Promise<PermissionResult> {
    return new Promise((resolvePromise) => {
      this.status = toolName === "AskUserQuestion" ? "awaiting-input" : "awaiting-permission";
      this.pendingPermission = {
        toolName,
        input,
        suggestions,
        resolve: (r: PermissionResult) => {
          this.pendingPermission = null;
          if (this.status === "awaiting-permission" || this.status === "awaiting-input") {
            this.status = "processing";
          }
          resolvePromise(r);
          this.onChange();
        },
      };
      this.onChange();
    });
  }

  async interrupt(): Promise<void> {
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
    this.queue?.end();
    this.queue = null;
    this.handle = null;
  }
}
