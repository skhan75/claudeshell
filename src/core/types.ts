export type TranscriptBlock =
  | { kind: "user"; text: string; ts?: number }
  | { kind: "assistant"; text: string; streaming: boolean; ts?: number }
  | { kind: "thinking"; text: string; streaming: boolean; ts?: number }
  | {
      kind: "tool";
      name: string;
      detail: string;
      status: "running" | "done";
      id?: string;
      /** Full tool input (file_path, old/new strings, content, command, …) for rich rendering. */
      input?: Record<string, unknown>;
      /** Captured tool_result text (command output, file content) once the tool completes. */
      result?: string;
      /** Whether the tool_result reported success (false → the tool errored). */
      ok?: boolean;
    }
  | { kind: "info"; text: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  /** Cost of the most recent turn (delta of cumulative total across two results) — "current inference cost". */
  lastTurnCostUsd: number;
  turns: number;
  /** input+cacheRead of the most recent assistant message — approximates current context-window occupancy. */
  contextTokens: number;
}

export interface SessionMeta {
  model?: string;
  slashCommands: string[];
  mcpServers: { name: string; status: string }[];
}

/**
 * The non-null overlay panels the app can show. Defined ONCE here so the store's
 * `Overlay` union (src/store.ts) and the slash router's overlay actions
 * (src/core/slash-commands.ts) reference the same type and can never drift —
 * a mismatch becomes a compile error, not a blank screen at runtime.
 */
export type AppOverlay =
  | "help"
  | "sessions"
  | "buffers"
  | "models"
  | "compact"
  | "fleet"
  | "budget"
  | "review";

/** Cost-guard caps (USD). Both optional — an empty object means "no budget set".
 *  Shared by Config.budget, ManagerOpts.budget, SavedState.budget, and the UI. */
export interface BudgetCaps {
  /** Warn (amber meter) once total spend crosses this. */
  softUsd?: number;
  /** Block NEW fleet spawns once total spend crosses this. */
  hardUsd?: number;
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

/** Narrow view of SDK messages — only the fields openshell consumes. */
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

/** A model the SDK reports as available (from query().supportedModels()). */
export interface ModelInfo {
  value: string;
  displayName: string;
  description?: string;
}

/** A slash command the SDK reports (from query().supportedCommands()). */
export interface SlashCommandInfo {
  name: string;
  description?: string;
  argumentHint?: string;
}

/** Live MCP server status (from query().mcpServerStatus()). */
export interface McpServerStatus {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled" | string;
}

/** Account / auth info (from query().accountInfo()). */
export interface AccountInfo {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  apiProvider?: string;
}

export interface QueryHandle extends AsyncIterable<SdkMessage> {
  interrupt?(): Promise<void>;
  setPermissionMode?(mode: string): Promise<void>;
  setModel?(model: string): Promise<void>;
  close?(): void | Promise<void>;
  // Richer control surface (streaming mode). All optional so test fakes/older SDKs
  // simply don't provide them and the Session falls back gracefully.
  supportedModels?(): Promise<ModelInfo[]>;
  supportedCommands?(): Promise<SlashCommandInfo[]>;
  mcpServerStatus?(): Promise<McpServerStatus[]>;
  reconnectMcpServer?(name: string): Promise<void>;
  toggleMcpServer?(name: string, enabled: boolean): Promise<void>;
  accountInfo?(): Promise<AccountInfo | undefined>;
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
