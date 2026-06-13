export type TranscriptBlock =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming: boolean }
  | { kind: "thinking"; text: string; streaming: boolean }
  | { kind: "tool"; name: string; detail: string; status: "running" | "done"; id?: string }
  | { kind: "info"; text: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  turns: number;
  /** input+cacheRead of the most recent assistant message — approximates current context-window occupancy. */
  contextTokens: number;
}

export interface SessionMeta {
  model?: string;
  slashCommands: string[];
  mcpServers: { name: string; status: string }[];
}

export type SessionStatus =
  | "idle"
  | "processing"
  | "awaiting-permission"
  | "awaiting-input"
  | "crashed";

export type PermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: "deny"; message: string };

export interface PermissionRequest {
  /** Stable per-request identity — UI keys dialogs on this. */
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  suggestions: Array<{ destination?: string } & Record<string, unknown>>;
  resolve: (r: PermissionResult) => void;
}

/** Narrow view of SDK messages — only the fields claudeshell consumes. */
export interface SdkMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  mcp_servers?: { name: string; status: string }[];
  slash_commands?: string[];
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    usage?: Record<string, number>;
  };
  total_cost_usd?: number;
  num_turns?: number;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string; thinking?: string };
  };
  estimated_tokens?: number;
}

export interface QueryHandle extends AsyncIterable<SdkMessage> {
  interrupt?(): Promise<void>;
  setPermissionMode?(mode: string): Promise<void>;
  setModel?(model: string): Promise<void>;
  close?(): void | Promise<void>;
}

export type QueryFn = (args: {
  prompt: AsyncIterable<unknown>;
  options: Record<string, unknown>;
}) => QueryHandle;

export interface HostStats {
  hostname: string;
  platform: string;
  memUsedPct: number;
  uptimeSec: number;
  branch: string | null;
}
