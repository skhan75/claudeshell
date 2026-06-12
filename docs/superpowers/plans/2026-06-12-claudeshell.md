# claudeshell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build claudeshell v1 — a terminal TUI wrapping Claude Code with multi-session tabs, sidebar/zen layouts, command palette, pills, and full permission-dialog parity, per `docs/superpowers/specs/2026-06-12-claudeshell-design.md`.

**Architecture:** Headless core (SessionManager → Session wrapping Agent SDK `query()` in streaming-input mode; transcript reducer; config/persistence/host-monitor) publishes change events into a zustand store; Ink/React UI renders from it. Each session tab owns one Claude Code subprocess via the SDK. Permission prompts flow through the SDK `canUseTool` callback into modal dialogs.

**Tech Stack:** TypeScript (ESM, NodeNext), Ink 5 + React 18, `@anthropic-ai/claude-agent-sdk`, zustand, smol-toml, Vitest + ink-testing-library.

**Verified SDK facts used throughout (do not re-derive):**
- `query({ prompt: AsyncIterable, options })` returns an async iterable with `interrupt()`, `setPermissionMode()`, `setModel()`.
- Options: `cwd`, `model`, `permissionMode`, `resume`, `forkSession`, `includePartialMessages`, `settingSources`, `systemPrompt: {type:'preset', preset:'claude_code'}`, `maxTurns`, `abortController`.
- Daily-driver parity REQUIRES `settingSources: ["user","project","local"]` and the `claude_code` system-prompt preset (SDK defaults load neither CLAUDE.md nor user settings).
- With `includePartialMessages: true`, streaming arrives as `{type:"partial_assistant", message}` where `message` is the **accumulated** partial message (replace, don't append).
- `canUseTool(toolName, input, {suggestions})` → `{behavior:"allow", updatedInput, updatedPermissions?}` or `{behavior:"deny", message}`. "Always allow" = echo `suggestions` (prefer `destination==="localSettings"`) back via `updatedPermissions`.
- `AskUserQuestion` arrives through `canUseTool`; answer with `{behavior:"allow", updatedInput: { questions: input.questions, answers: { [questionText]: selectedLabel } }}` (multi-select: labels joined with ", ").
- Result message: `{type:"result", total_cost_usd, usage, num_turns, duration_ms, session_id}`. Assistant messages carry `message.usage` and `message.model`. System init message: `{type:"system", subtype:"init", session_id, model, mcp_servers, slash_commands}` (consume defensively with optional chaining).

**Conventions:** ESM with NodeNext — every relative import MUST end in `.js` (even from `.tsx` files). Run all commands from the repo root `/Users/samiahmadkhan/workspace/claudeshell`.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/cli.tsx`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "claudeshell",
  "version": "0.1.0",
  "description": "A visual terminal shell for Claude Code — tabs, telemetry, pills, fast navigation",
  "license": "MIT",
  "type": "module",
  "bin": { "claudeshell": "dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.tsx",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install ink@^5 react@^18 zustand@^5 smol-toml@^1 @anthropic-ai/claude-agent-sdk
npm install -D typescript@^5 vitest@^3 ink-testing-library@^4 tsx @types/react@^18 @types/node
```
Expected: clean install, lockfile created.

- [ ] **Step 3: Write tsconfig.json and vitest.config.ts**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"] },
  esbuild: { jsx: "automatic" },
});
```

- [ ] **Step 4: Write a hello-world entry to prove Ink renders**

`src/cli.tsx`:
```tsx
#!/usr/bin/env node
import React from "react";
import { render, Text } from "ink";

render(<Text color="cyan">claudeshell scaffold OK</Text>);
```

Run: `npx tsx src/cli.tsx`
Expected: prints `claudeshell scaffold OK` in cyan and exits (Ctrl+C if it stays open).

- [ ] **Step 5: Verify build works**

Run: `npm run build && node dist/cli.js`
Expected: same output from the compiled binary.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/cli.tsx
git commit -m "chore: scaffold claudeshell (ink + tsc + vitest)"
```

---

### Task 2: Core types + AsyncQueue

**Files:**
- Create: `src/core/types.ts`, `src/core/async-queue.ts`
- Test: `tests/core/async-queue.test.ts`

- [ ] **Step 1: Write the shared core types (no test — pure declarations)**

`src/core/types.ts`:
```ts
export type TranscriptBlock =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; streaming: boolean }
  | { kind: "tool"; name: string; detail: string; status: "running" | "done" }
  | { kind: "info"; text: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  turns: number;
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
}

export interface QueryHandle extends AsyncIterable<SdkMessage> {
  interrupt?(): Promise<void>;
  setPermissionMode?(mode: string): Promise<void>;
  setModel?(model: string): Promise<void>;
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
```

- [ ] **Step 2: Write the failing AsyncQueue test**

`tests/core/async-queue.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { AsyncQueue } from "../../src/core/async-queue.js";

describe("AsyncQueue", () => {
  it("delivers pushed items to an async iterator, including items pushed before iteration", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    const seen: number[] = [];
    const consumer = (async () => {
      for await (const n of q) seen.push(n);
    })();
    q.push(2);
    q.end();
    await consumer;
    expect(seen).toEqual([1, 2]);
  });

  it("resolves waiting consumers when an item arrives later", async () => {
    const q = new AsyncQueue<string>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.push("hello");
    expect((await pending).value).toBe("hello");
    q.end();
    expect((await it.next()).done).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/core/async-queue.test.ts`
Expected: FAIL — cannot find module `src/core/async-queue.js`.

- [ ] **Step 4: Implement AsyncQueue**

`src/core/async-queue.ts`:
```ts
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private done = false;

  push(item: T): void {
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.items.length > 0) {
          return Promise.resolve({ value: this.items.shift() as T, done: false });
        }
        if (this.done) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((res) => this.waiters.push(res));
      },
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/core/async-queue.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/async-queue.ts tests/core/async-queue.test.ts
git commit -m "feat(core): shared types and AsyncQueue for streaming input"
```

---

### Task 3: Fuzzy matcher

**Files:**
- Create: `src/core/fuzzy.ts`
- Test: `tests/core/fuzzy.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/core/fuzzy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fuzzyFilter } from "../../src/core/fuzzy.js";

describe("fuzzyFilter", () => {
  const items = ["fix tests", "toggle layout", "new session", "switch model"];

  it("matches subsequences and ranks tighter matches first", () => {
    const out = fuzzyFilter(items, "ts", (s) => s);
    expect(out).toContain("fix tests");
    expect(out).not.toContain("switch model".length === 0 ? "" : "no-match-placeholder");
  });

  it("empty query returns all items in original order", () => {
    expect(fuzzyFilter(items, "", (s) => s)).toEqual(items);
  });

  it("non-matching query returns empty", () => {
    expect(fuzzyFilter(items, "zzz", (s) => s)).toEqual([]);
  });

  it("prefers prefix matches", () => {
    const out = fuzzyFilter(["abc", "xaxbxc"], "abc", (s) => s);
    expect(out[0]).toBe("abc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/fuzzy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/fuzzy.ts`:
```ts
/** Score a case-insensitive subsequence match. Higher is better; null = no match. */
export function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (q.length === 0) return 0;
  let score = 0;
  let ti = 0;
  let lastMatch = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    score += found === lastMatch + 1 ? 3 : 1; // consecutive bonus
    if (found === 0) score += 2; // prefix bonus
    lastMatch = found;
    ti = found + 1;
  }
  return score;
}

export function fuzzyFilter<T>(items: T[], query: string, key: (item: T) => string): T[] {
  if (query === "") return [...items];
  return items
    .map((item) => ({ item, score: fuzzyScore(key(item), query) }))
    .filter((e): e is { item: T; score: number } => e.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((e) => e.item);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/fuzzy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/fuzzy.ts tests/core/fuzzy.test.ts
git commit -m "feat(core): fuzzy subsequence matcher for palette/autocomplete"
```

---

### Task 4: ConfigLoader

**Files:**
- Create: `src/core/config.ts`
- Test: `tests/core/config.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/core/config.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, DEFAULT_PILLS, DEFAULT_KEYS } from "../../src/core/config.js";

let globalDir: string;
let projectDir: string;

beforeEach(() => {
  globalDir = mkdtempSync(join(tmpdir(), "cs-global-"));
  projectDir = mkdtempSync(join(tmpdir(), "cs-proj-"));
});
afterEach(() => {
  rmSync(globalDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when no config files exist", () => {
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.layout).toBe("sidebar");
    expect(cfg.pills).toEqual(DEFAULT_PILLS);
    expect(cfg.keys).toEqual(DEFAULT_KEYS);
  });

  it("global config overrides defaults; project overrides global", () => {
    writeFileSync(
      join(globalDir, "config.toml"),
      `[layout]\ndefault = "zen"\n\n[[pills]]\nlabel = "deploy"\nprompt = "Deploy to staging"\n`
    );
    writeFileSync(
      join(projectDir, ".claudeshell.toml"),
      `[layout]\ndefault = "sidebar"\n\n[[pills]]\nlabel = "deploy"\nprompt = "Deploy with make deploy"\n`
    );
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.layout).toBe("sidebar");
    const deploy = cfg.pills.find((p) => p.label === "deploy");
    expect(deploy?.prompt).toBe("Deploy with make deploy");
  });

  it("merges [keys] over defaults", () => {
    writeFileSync(join(globalDir, "config.toml"), `[keys]\npalette = "ctrl+p"\n`);
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.keys.palette).toBe("ctrl+p");
    expect(cfg.keys.layoutToggle).toBe("ctrl+o");
  });

  it("survives malformed TOML by falling back to defaults for that file", () => {
    writeFileSync(join(globalDir, "config.toml"), `not [valid toml`);
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.layout).toBe("sidebar");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/config.ts`:
```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "smol-toml";

export interface Pill {
  label: string;
  prompt?: string;
  slash?: string;
}

export interface Config {
  layout: "sidebar" | "zen";
  pills: Pill[];
  keys: Record<string, string>;
}

export const DEFAULT_PILLS: Pill[] = [
  { label: "fix tests", prompt: "Run the test suite and fix any failures" },
  { label: "explain", prompt: "Explain what the recent changes in this repo do" },
  { label: "commit", slash: "/commit" },
  { label: "review", slash: "/review" },
];

export const DEFAULT_KEYS: Record<string, string> = {
  palette: "ctrl+k",
  layoutToggle: "ctrl+o",
  newSession: "alt+t",
  closeSession: "alt+w",
  focusToggle: "esc",
};

interface RawConfig {
  layout?: { default?: string };
  pills?: Pill[];
  keys?: Record<string, string>;
}

function readToml(path: string): RawConfig {
  if (!existsSync(path)) return {};
  try {
    return parse(readFileSync(path, "utf8")) as RawConfig;
  } catch {
    return {}; // malformed file → ignore, never crash the shell
  }
}

function mergePills(base: Pill[], extra: Pill[] | undefined): Pill[] {
  if (!extra) return base;
  const out = [...base];
  for (const pill of extra) {
    const i = out.findIndex((p) => p.label === pill.label);
    if (i >= 0) out[i] = pill;
    else out.push(pill);
  }
  return out;
}

export function loadConfig(opts: { globalDir?: string; cwd?: string } = {}): Config {
  const globalDir = opts.globalDir ?? join(homedir(), ".claudeshell");
  const cwd = opts.cwd ?? process.cwd();
  const g = readToml(join(globalDir, "config.toml"));
  const p = readToml(join(cwd, ".claudeshell.toml"));

  const layoutRaw = p.layout?.default ?? g.layout?.default ?? "sidebar";
  return {
    layout: layoutRaw === "zen" ? "zen" : "sidebar",
    pills: mergePills(mergePills(DEFAULT_PILLS, g.pills), p.pills),
    keys: { ...DEFAULT_KEYS, ...g.keys, ...p.keys },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/core/config.test.ts
git commit -m "feat(core): TOML config loader with global+project merge"
```

---

### Task 5: Transcript reducer + usage tracking

**Files:**
- Create: `src/core/transcript.ts`
- Test: `tests/core/transcript.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/core/transcript.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Transcript } from "../../src/core/transcript.js";

describe("Transcript", () => {
  it("captures init metadata", () => {
    const t = new Transcript();
    t.apply({
      type: "system", subtype: "init", session_id: "sess-1", model: "claude-opus-4-8",
      mcp_servers: [{ name: "vibedrift", status: "connected" }],
      slash_commands: ["/commit", "/review"],
    });
    expect(t.meta.model).toBe("claude-opus-4-8");
    expect(t.meta.mcpServers[0].name).toBe("vibedrift");
    expect(t.meta.slashCommands).toContain("/commit");
  });

  it("replaces streaming text on partial_assistant, finalizes on assistant", () => {
    const t = new Transcript();
    t.addUser("hello");
    t.apply({ type: "partial_assistant", message: { content: [{ type: "text", text: "Hel" }] } });
    t.apply({ type: "partial_assistant", message: { content: [{ type: "text", text: "Hello there" }] } });
    let last = t.blocks[t.blocks.length - 1];
    expect(last).toMatchObject({ kind: "assistant", text: "Hello there", streaming: true });

    t.apply({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello there!" }],
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 },
        model: "claude-opus-4-8",
      },
    });
    last = t.blocks[t.blocks.length - 1];
    expect(last).toMatchObject({ kind: "assistant", text: "Hello there!", streaming: false });
    expect(t.usage.inputTokens).toBe(100);
    expect(t.usage.outputTokens).toBe(20);
    expect(t.usage.cacheReadTokens).toBe(50);
    expect(t.blocks.filter((b) => b.kind === "assistant")).toHaveLength(1);
  });

  it("creates tool blocks, harvests context files, and marks tools done on tool_result", () => {
    const t = new Transcript();
    t.apply({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/p/auth.go" } }] },
    });
    expect(t.blocks[t.blocks.length - 1]).toMatchObject({ kind: "tool", name: "Edit", status: "running" });
    expect([...t.contextFiles]).toContain("/p/auth.go");

    t.apply({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x" }] } });
    expect(t.blocks[t.blocks.length - 1]).toMatchObject({ kind: "tool", status: "done" });
  });

  it("updates cost and turns from result messages", () => {
    const t = new Transcript();
    t.apply({ type: "result", subtype: "success", total_cost_usd: 0.42, num_turns: 3 });
    expect(t.usage.costUsd).toBeCloseTo(0.42);
    expect(t.usage.turns).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/transcript.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/transcript.ts`:
```ts
import type { SdkMessage, SessionMeta, TranscriptBlock, Usage } from "./types.js";

const FILE_TOOLS = new Set(["Read", "Edit", "Write", "NotebookEdit"]);

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function contentBlocks(msg: SdkMessage): ContentBlock[] {
  const c = msg.message?.content;
  return Array.isArray(c) ? (c as ContentBlock[]) : [];
}

function textOf(blocks: ContentBlock[]): string {
  return blocks.filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text).join("");
}

function summarize(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  if (typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return input.file_path;
  const s = JSON.stringify(input);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

export class Transcript {
  blocks: TranscriptBlock[] = [];
  usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, turns: 0 };
  meta: SessionMeta = { slashCommands: [], mcpServers: [] };
  contextFiles = new Set<string>();

  addUser(text: string): void {
    this.blocks.push({ kind: "user", text });
  }

  addInfo(text: string): void {
    this.blocks.push({ kind: "info", text });
  }

  apply(msg: SdkMessage): void {
    if (msg.type === "system" && msg.subtype === "init") {
      this.meta.model = msg.model ?? this.meta.model;
      this.meta.mcpServers = msg.mcp_servers ?? this.meta.mcpServers;
      this.meta.slashCommands = msg.slash_commands ?? this.meta.slashCommands;
      return;
    }

    if (msg.type === "partial_assistant") {
      const text = textOf(contentBlocks(msg));
      if (text === "") return;
      const last = this.blocks[this.blocks.length - 1];
      if (last?.kind === "assistant" && last.streaming) last.text = text;
      else this.blocks.push({ kind: "assistant", text, streaming: true });
      return;
    }

    if (msg.type === "assistant") {
      const blocks = contentBlocks(msg);
      const text = textOf(blocks);
      if (text !== "") {
        const last = this.blocks[this.blocks.length - 1];
        if (last?.kind === "assistant" && last.streaming) {
          last.text = text;
          last.streaming = false;
        } else {
          this.blocks.push({ kind: "assistant", text, streaming: false });
        }
      }
      for (const b of blocks) {
        if (b.type === "tool_use" && typeof b.name === "string") {
          this.blocks.push({ kind: "tool", name: b.name, detail: summarize(b.name, b.input), status: "running" });
          const fp = b.input?.file_path;
          if (FILE_TOOLS.has(b.name) && typeof fp === "string") this.contextFiles.add(fp);
        }
      }
      const u = msg.message?.usage;
      if (u) {
        this.usage.inputTokens += u.input_tokens ?? 0;
        this.usage.outputTokens += u.output_tokens ?? 0;
        this.usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      }
      this.meta.model = msg.message?.model ?? this.meta.model;
      return;
    }

    if (msg.type === "user") {
      const hasToolResult = contentBlocks(msg).some((b) => b.type === "tool_result");
      if (hasToolResult) {
        for (let i = this.blocks.length - 1; i >= 0; i--) {
          const b = this.blocks[i];
          if (b.kind === "tool" && b.status === "running") {
            b.status = "done";
            break;
          }
        }
      }
      return;
    }

    if (msg.type === "result") {
      if (typeof msg.total_cost_usd === "number") this.usage.costUsd = msg.total_cost_usd;
      if (typeof msg.num_turns === "number") this.usage.turns = msg.num_turns;
      if (msg.subtype && msg.subtype !== "success") this.addInfo(`result: ${msg.subtype}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/transcript.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/transcript.ts tests/core/transcript.test.ts
git commit -m "feat(core): transcript reducer with streaming, tools, usage, context files"
```

---

### Task 6: Session

**Files:**
- Create: `src/core/session.ts`
- Test: `tests/core/session.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/core/session.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { Session } from "../../src/core/session.js";
import type { PermissionResult, QueryFn, SdkMessage } from "../../src/core/types.js";

/** Fake query: consumes one prompt item, then replays `script`. */
function scriptedQuery(script: SdkMessage[], capture?: { options?: Record<string, unknown> }): QueryFn {
  return ({ prompt, options }) => {
    if (capture) capture.options = options;
    async function* gen() {
      for await (const _first of prompt) {
        for (const m of script) yield m;
        return;
      }
    }
    return Object.assign(gen(), { interrupt: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}) });
  };
}

describe("Session", () => {
  it("send() streams messages through transcript and lands on idle", async () => {
    const s = new Session({
      id: "s1", cwd: "/tmp",
      queryFn: scriptedQuery([
        { type: "system", subtype: "init", session_id: "claude-sess-9", model: "claude-opus-4-8" },
        { type: "assistant", message: { content: [{ type: "text", text: "hi!" }], usage: { input_tokens: 5, output_tokens: 2 } } },
        { type: "result", subtype: "success", total_cost_usd: 0.01, num_turns: 1 },
      ]),
    });
    s.send("hello");
    expect(s.status).toBe("processing");
    expect(s.title).toBe("hello");
    await vi.waitFor(() => expect(s.status).toBe("idle"));
    expect(s.claudeSessionId).toBe("claude-sess-9");
    expect(s.transcript.blocks.some((b) => b.kind === "assistant" && b.text === "hi!")).toBe(true);
    expect(s.transcript.usage.costUsd).toBeCloseTo(0.01);
  });

  it("passes daily-driver options to the SDK (settingSources, claude_code preset, partials)", async () => {
    const capture: { options?: Record<string, unknown> } = {};
    const s = new Session({ id: "s1", cwd: "/repo", queryFn: scriptedQuery([{ type: "result", subtype: "success" }], capture) });
    s.send("x");
    await vi.waitFor(() => expect(s.status).toBe("idle"));
    expect(capture.options?.cwd).toBe("/repo");
    expect(capture.options?.includePartialMessages).toBe(true);
    expect(capture.options?.settingSources).toEqual(["user", "project", "local"]);
    expect(capture.options?.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
  });

  it("routes canUseTool into a pending permission request and resumes on resolve", async () => {
    const queryFn: QueryFn = ({ prompt, options }) => {
      async function* gen() {
        for await (const _ of prompt) {
          const canUseTool = options.canUseTool as (
            t: string, i: Record<string, unknown>, o: { suggestions?: unknown[] }
          ) => Promise<PermissionResult>;
          const result = await canUseTool("Bash", { command: "rm -rf /tmp/x" }, { suggestions: [{ destination: "localSettings" }] });
          yield (result.behavior === "allow"
            ? { type: "assistant", message: { content: [{ type: "text", text: "done" }] } }
            : { type: "assistant", message: { content: [{ type: "text", text: "denied" }] } }) as SdkMessage;
          yield { type: "result", subtype: "success" } as SdkMessage;
          return;
        }
      }
      return gen();
    };
    const s = new Session({ id: "s1", cwd: "/tmp", queryFn });
    s.send("delete temp");
    await vi.waitFor(() => expect(s.status).toBe("awaiting-permission"));
    expect(s.pendingPermission?.toolName).toBe("Bash");
    s.pendingPermission!.resolve({ behavior: "allow", updatedInput: s.pendingPermission!.input });
    await vi.waitFor(() => expect(s.status).toBe("idle"));
    expect(s.transcript.blocks.some((b) => b.kind === "assistant" && b.text === "done")).toBe(true);
  });

  it("marks AskUserQuestion as awaiting-input", async () => {
    const queryFn: QueryFn = ({ prompt, options }) => {
      async function* gen() {
        for await (const _ of prompt) {
          const canUseTool = options.canUseTool as (t: string, i: Record<string, unknown>, o: object) => Promise<PermissionResult>;
          await canUseTool("AskUserQuestion", { questions: [] }, {});
          yield { type: "result", subtype: "success" } as SdkMessage;
          return;
        }
      }
      return gen();
    };
    const s = new Session({ id: "s1", cwd: "/tmp", queryFn });
    s.send("build it");
    await vi.waitFor(() => expect(s.status).toBe("awaiting-input"));
    s.pendingPermission!.resolve({ behavior: "allow", updatedInput: {} });
    await vi.waitFor(() => expect(s.status).toBe("idle"));
  });

  it("crashes the tab (not the process) on stream error, and resume() re-arms with the claude session id", async () => {
    let call = 0;
    const captures: Array<Record<string, unknown>> = [];
    const queryFn: QueryFn = ({ prompt, options }) => {
      captures.push(options);
      const thisCall = ++call;
      async function* gen(): AsyncGenerator<SdkMessage> {
        for await (const _ of prompt) {
          if (thisCall === 1) {
            yield { type: "system", subtype: "init", session_id: "claude-sess-1" };
            throw new Error("subprocess exited");
          }
          yield { type: "result", subtype: "success" };
          return;
        }
      }
      return gen();
    };
    const s = new Session({ id: "s1", cwd: "/tmp", queryFn });
    s.send("boom");
    await vi.waitFor(() => expect(s.status).toBe("crashed"));
    expect(s.error).toContain("subprocess exited");

    s.resume();
    expect(s.status).toBe("idle");
    s.send("again");
    await vi.waitFor(() => expect(s.status).toBe("idle"));
    expect(captures[1].resume).toBe("claude-sess-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/session.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/session.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/session.ts tests/core/session.test.ts
git commit -m "feat(core): Session wrapping SDK query with permissions, crash recovery, resume"
```

---

### Task 7: Persistence + SessionManager

**Files:**
- Create: `src/core/persistence.ts`, `src/core/session-manager.ts`
- Test: `tests/core/session-manager.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/core/session-manager.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "../../src/core/session-manager.js";
import { loadState } from "../../src/core/persistence.js";
import type { QueryFn } from "../../src/core/types.js";

const noopQuery: QueryFn = ({ prompt }) => {
  async function* gen() {
    for await (const _ of prompt) return;
  }
  return gen();
};

function tmpState(): string {
  return join(mkdtempSync(join(tmpdir(), "cs-state-")), "state.json");
}

describe("SessionManager", () => {
  it("creates, activates, and closes sessions", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const a = m.create();
    const b = m.create();
    expect(m.sessions).toHaveLength(2);
    expect(m.active?.id).toBe(b.id);
    m.activate(0);
    expect(m.active?.id).toBe(a.id);
    m.close(a.id);
    expect(m.sessions).toHaveLength(1);
    expect(m.active?.id).toBe(b.id);
  });

  it("notifies subscribers on changes", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    let ticks = 0;
    m.subscribe(() => ticks++);
    m.create();
    expect(ticks).toBeGreaterThan(0);
  });

  it("persists and restores tab state", () => {
    const statePath = tmpState();
    const m1 = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery });
    const s = m1.create();
    s.title = "jwt work";
    (s as unknown as { claudeId?: string })["claudeId"] = "claude-abc";
    m1.saveState();

    const m2 = new SessionManager({ cwd: "/tmp", statePath, queryFn: noopQuery });
    m2.restoreState();
    expect(m2.sessions).toHaveLength(1);
    expect(m2.sessions[0].title).toBe("jwt work");
    expect(m2.sessions[0].claudeSessionId).toBe("claude-abc");
  });

  it("backs up corrupt state instead of crashing", () => {
    const statePath = tmpState();
    writeFileSync(statePath, "{corrupt");
    expect(loadState(statePath)).toBeNull();
    expect(existsSync(statePath + ".bak")).toBe(true);
  });

  it("always keeps at least one session after restore", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    m.restoreState();
    expect(m.sessions.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/session-manager.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement persistence**

`src/core/persistence.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SavedSession {
  id: string;
  title: string;
  cwd: string;
  claudeSessionId?: string;
}

export interface SavedState {
  version: 1;
  active: number;
  counter: number;
  sessions: SavedSession[];
}

export function loadState(path: string): SavedState | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SavedState;
    if (raw.version !== 1 || !Array.isArray(raw.sessions)) throw new Error("bad schema");
    return raw;
  } catch {
    renameSync(path, path + ".bak");
    return null;
  }
}

export function saveState(path: string, state: SavedState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}
```

- [ ] **Step 4: Implement SessionManager**

`src/core/session-manager.ts`:
```ts
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
    this.activeIndex = Math.min(this.activeIndex, this.sessions.length - 1);
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/core/session-manager.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/persistence.ts src/core/session-manager.ts tests/core/session-manager.test.ts
git commit -m "feat(core): SessionManager with tab lifecycle and state persistence"
```

---

### Task 8: SystemMonitor + history search

**Files:**
- Create: `src/core/system-monitor.ts`, `src/core/history-search.ts`
- Test: `tests/core/system-monitor.test.ts`, `tests/core/history-search.test.ts`

- [ ] **Step 1: Write the failing SystemMonitor test**

`tests/core/system-monitor.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SystemMonitor } from "../../src/core/system-monitor.js";

describe("SystemMonitor", () => {
  it("reads host stats with an injected git exec", async () => {
    const mon = new SystemMonitor("/repo", async () => "feature/mcp\n");
    const stats = await mon.read();
    expect(stats.hostname.length).toBeGreaterThan(0);
    expect(stats.memUsedPct).toBeGreaterThanOrEqual(0);
    expect(stats.memUsedPct).toBeLessThanOrEqual(100);
    expect(stats.branch).toBe("feature/mcp");
  });

  it("returns null branch when git fails (not a repo)", async () => {
    const mon = new SystemMonitor("/repo", async () => {
      throw new Error("not a git repo");
    });
    const stats = await mon.read();
    expect(stats.branch).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing history-search test**

`tests/core/history-search.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectSlug, searchHistory } from "../../src/core/history-search.js";

describe("history search", () => {
  it("derives Claude Code's project slug from cwd", () => {
    expect(projectSlug("/Users/sami/workspace/claudeshell")).toBe("-Users-sami-workspace-claudeshell");
  });

  it("finds matching user/assistant text in project JSONL transcripts", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-hist-"));
    const projDir = join(root, "projects", "-repo");
    mkdirSync(projDir, { recursive: true });
    const lines = [
      JSON.stringify({ type: "user", message: { role: "user", content: "refactor the JWT validation" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "I fixed the issuer check" }] } }),
      "not json at all",
    ].join("\n");
    writeFileSync(join(projDir, "abc.jsonl"), lines);

    const hits = searchHistory("/repo", "jwt", { claudeDir: root, limit: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("JWT validation");
  });

  it("returns empty for a missing project dir", () => {
    expect(searchHistory("/nope", "x", { claudeDir: "/does/not/exist" })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify both fail**

Run: `npx vitest run tests/core/system-monitor.test.ts tests/core/history-search.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement SystemMonitor**

`src/core/system-monitor.ts`:
```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import type { HostStats } from "./types.js";

const pExecFile = promisify(execFile);

export type GitExec = (cwd: string) => Promise<string>;

const realGitExec: GitExec = async (cwd) => {
  const { stdout } = await pExecFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return stdout;
};

export class SystemMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private cwd: string, private gitExec: GitExec = realGitExec) {}

  async read(): Promise<HostStats> {
    let branch: string | null = null;
    try {
      branch = (await this.gitExec(this.cwd)).trim() || null;
    } catch {
      branch = null;
    }
    return {
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      memUsedPct: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
      uptimeSec: Math.round(os.uptime()),
      branch,
    };
  }

  start(intervalMs: number, cb: (stats: HostStats) => void): void {
    const tick = () => void this.read().then(cb).catch(() => {});
    tick();
    this.timer = setInterval(tick, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
```

- [ ] **Step 5: Implement history search**

`src/core/history-search.ts`:
```ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface HistoryHit {
  file: string;
  text: string;
}

/** Claude Code stores project transcripts under ~/.claude/projects/<slug>/, slug = cwd with [/.] → "-". */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

interface JsonlLine {
  type?: string;
  message?: { content?: unknown };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: { type?: string; text?: string }) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
      .join(" ");
  }
  return "";
}

export function searchHistory(
  cwd: string,
  query: string,
  opts: { claudeDir?: string; limit?: number } = {}
): HistoryHit[] {
  const claudeDir = opts.claudeDir ?? join(homedir(), ".claude");
  const limit = opts.limit ?? 20;
  const dir = join(claudeDir, "projects", projectSlug(cwd));
  if (!existsSync(dir) || query.trim() === "") return [];
  const q = query.toLowerCase();
  const hits: HistoryHit[] = [];

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    let raw: string;
    try {
      raw = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (hits.length >= limit) return hits;
      if (line.trim() === "") continue;
      try {
        const parsed = JSON.parse(line) as JsonlLine;
        if (parsed.type !== "user" && parsed.type !== "assistant") continue;
        const text = textFromContent(parsed.message?.content);
        if (text.toLowerCase().includes(q)) {
          hits.push({ file, text: text.length > 120 ? text.slice(0, 117) + "…" : text });
        }
      } catch {
        continue;
      }
    }
  }
  return hits;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/core/system-monitor.test.ts tests/core/history-search.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/core/system-monitor.ts src/core/history-search.ts tests/core/system-monitor.test.ts tests/core/history-search.test.ts
git commit -m "feat(core): host stats monitor and cross-session history search"
```

---

### Task 9: Store, theme, key matching, App shell + TabBar

**Files:**
- Create: `src/store.ts`, `src/ui/theme.ts`, `src/ui/keys.ts`, `src/ui/context.ts`, `src/ui/TabBar.tsx`, `src/ui/App.tsx`
- Create (stubs replaced in later tasks): `src/ui/ChatPane.tsx`, `src/ui/SidePanel.tsx`, `src/ui/TelemetryStrip.tsx`, `src/ui/InputBar.tsx`, `src/ui/PillBar.tsx`, `src/ui/CommandPalette.tsx`, `src/ui/dialogs.tsx`
- Test: `tests/ui/helpers.tsx`, `tests/ui/app.test.tsx`, `tests/ui/keys.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/ui/keys.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { matchKey } from "../../src/ui/keys.js";
import type { Key } from "ink";

const k = (partial: Partial<Key>): Key => partial as Key;

describe("matchKey", () => {
  it("matches ctrl, alt, and esc bindings", () => {
    expect(matchKey("ctrl+k", "k", k({ ctrl: true }))).toBe(true);
    expect(matchKey("alt+t", "t", k({ meta: true }))).toBe(true);
    expect(matchKey("esc", "", k({ escape: true }))).toBe(true);
  });
  it("rejects wrong modifiers", () => {
    expect(matchKey("ctrl+k", "k", k({}))).toBe(false);
    expect(matchKey("alt+t", "t", k({ ctrl: true }))).toBe(false);
  });
});
```

`tests/ui/helpers.tsx` (shared by all UI tests):
```tsx
import React from "react";
import { render } from "ink-testing-library";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppContext, type AppCtx } from "../../src/ui/context.js";
import { createAppStore } from "../../src/store.js";
import { SessionManager } from "../../src/core/session-manager.js";
import { loadConfig } from "../../src/core/config.js";
import type { QueryFn } from "../../src/core/types.js";

export const noopQuery: QueryFn = ({ prompt }) => {
  async function* gen() {
    for await (const _ of prompt) return;
  }
  return gen();
};

export function makeCtx(queryFn: QueryFn = noopQuery): AppCtx {
  const dir = mkdtempSync(join(tmpdir(), "cs-ui-"));
  const manager = new SessionManager({ cwd: dir, statePath: join(dir, "state.json"), queryFn });
  manager.create();
  const config = loadConfig({ globalDir: dir, cwd: dir });
  const store = createAppStore(config.layout);
  manager.subscribe(() => store.getState().bump());
  return { manager, config, store };
}

export function renderWithCtx(ui: React.ReactElement, ctx: AppCtx = makeCtx()) {
  const result = render(<AppContext.Provider value={ctx}>{ui}</AppContext.Provider>);
  return { ...result, ctx };
}
```

`tests/ui/app.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { App } from "../../src/ui/App.js";
import { renderWithCtx, makeCtx } from "./helpers.js";

describe("App shell", () => {
  it("renders tab bar with the active session", () => {
    const { lastFrame } = renderWithCtx(<App />);
    expect(lastFrame()).toContain("CLAUDESHELL");
    expect(lastFrame()).toContain("1:new session");
  });

  it("toggles layout with ctrl+o", () => {
    const ctx = makeCtx();
    const { stdin } = renderWithCtx(<App />, ctx);
    expect(ctx.store.getState().layout).toBe("sidebar");
    stdin.write("\u000f"); // ctrl+o
    expect(ctx.store.getState().layout).toBe("zen");
  });

  it("creates a new tab with alt+t and switches with alt+1", () => {
    const ctx = makeCtx();
    const { stdin, lastFrame } = renderWithCtx(<App />, ctx);
    stdin.write("\u001bt"); // alt+t
    expect(ctx.manager.sessions).toHaveLength(2);
    expect(lastFrame()).toContain("2:");
    stdin.write("\u001b1"); // alt+1
    expect(ctx.manager.activeIndex).toBe(0);
  });

  it("opens the palette with ctrl+k", () => {
    const ctx = makeCtx();
    const { stdin } = renderWithCtx(<App />, ctx);
    stdin.write("\u000b"); // ctrl+k
    expect(ctx.store.getState().paletteOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement store, theme, keys, context**

`src/store.ts`:
```ts
import { createStore, type StoreApi } from "zustand/vanilla";
import type { HostStats } from "./core/types.js";

export type Layout = "sidebar" | "zen";
export type Focus = "input" | "scroll" | "pills";

export interface AppState {
  version: number;
  layout: Layout;
  focus: Focus;
  paletteOpen: boolean;
  hostStats: HostStats | null;
  bump(): void;
  setLayout(l: Layout): void;
  toggleLayout(): void;
  setFocus(f: Focus): void;
  setPaletteOpen(open: boolean): void;
  setHostStats(h: HostStats): void;
}

export function createAppStore(initialLayout: Layout): StoreApi<AppState> {
  return createStore<AppState>((set) => ({
    version: 0,
    layout: initialLayout,
    focus: "input",
    paletteOpen: false,
    hostStats: null,
    bump: () => set((s) => ({ version: s.version + 1 })),
    setLayout: (layout) => set({ layout }),
    toggleLayout: () => set((s) => ({ layout: s.layout === "sidebar" ? "zen" : "sidebar" })),
    setFocus: (focus) => set({ focus }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setHostStats: (hostStats) => set({ hostStats }),
  }));
}
```

`src/ui/theme.ts`:
```ts
export const theme = {
  accent: "#4cc2ff",
  dim: "#6a7891",
  warn: "#ffcb6b",
  purple: "#c792ea",
  good: "#7ce38b",
  bad: "#f07178",
  fg: "#dbe6f5",
};
```

`src/ui/keys.ts`:
```ts
import type { Key } from "ink";

/** Match config bindings like "ctrl+k", "alt+t", "esc" against Ink useInput args. */
export function matchKey(binding: string, input: string, key: Key): boolean {
  const parts = binding.toLowerCase().split("+");
  const char = parts[parts.length - 1];
  if (char === "esc") return key.escape === true;
  const wantCtrl = parts.includes("ctrl");
  const wantAlt = parts.includes("alt");
  if ((key.ctrl ?? false) !== wantCtrl) return false;
  if ((key.meta ?? false) !== wantAlt) return false;
  return input.toLowerCase() === char;
}
```

`src/ui/context.ts`:
```ts
import { createContext, useContext } from "react";
import { useStore as useZustandStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { SessionManager } from "../core/session-manager.js";
import type { Config } from "../core/config.js";
import type { AppState } from "../store.js";

export interface AppCtx {
  manager: SessionManager;
  config: Config;
  store: StoreApi<AppState>;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useAppCtx(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext missing — wrap in <AppContext.Provider>");
  return ctx;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  const { store } = useAppCtx();
  return useZustandStore(store, selector);
}
```

- [ ] **Step 4: Implement TabBar and App; stub the not-yet-built components**

`src/ui/TabBar.tsx`:
```tsx
import React from "react";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";

const STATUS_GLYPH: Record<string, string> = {
  idle: "",
  processing: " ⚙",
  "awaiting-permission": " ⚠",
  "awaiting-input": " ?",
  crashed: " ✖",
};

export function TabBar() {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  return (
    <Box>
      <Text color={theme.accent} bold>
        ▌CLAUDESHELL{" "}
      </Text>
      {manager.sessions.map((s, i) => {
        const active = i === manager.activeIndex;
        return (
          <Text key={s.id} inverse={active} color={active ? theme.accent : theme.dim}>
            {` ${i + 1}:${s.title}${STATUS_GLYPH[s.status] ?? ""} `}
          </Text>
        );
      })}
    </Box>
  );
}
```

`src/ui/App.tsx`:
```tsx
import React, { useEffect } from "react";
import { Box, useInput } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { matchKey } from "./keys.js";
import { TabBar } from "./TabBar.js";
import { ChatPane } from "./ChatPane.js";
import { SidePanel } from "./SidePanel.js";
import { TelemetryStrip } from "./TelemetryStrip.js";
import { InputBar } from "./InputBar.js";
import { PillBar } from "./PillBar.js";
import { CommandPalette } from "./CommandPalette.js";
import { PermissionDialog, QuestionDialog } from "./dialogs.js";

export function App() {
  const { manager, config, store } = useAppCtx();
  useApp((s) => s.version);
  const layout = useApp((s) => s.layout);
  const paletteOpen = useApp((s) => s.paletteOpen);
  const session = manager.active;
  const pending = session?.pendingPermission ?? null;

  useEffect(() => manager.subscribe(() => store.getState().bump()), [manager, store]);

  useInput(
    (input, key) => {
      const st = store.getState();
      if (matchKey(config.keys.palette, input, key)) return st.setPaletteOpen(true);
      if (matchKey(config.keys.layoutToggle, input, key)) return st.toggleLayout();
      if (matchKey(config.keys.newSession, input, key)) {
        manager.create();
        return;
      }
      if (matchKey(config.keys.closeSession, input, key)) {
        if (session) manager.close(session.id);
        return;
      }
      if (matchKey(config.keys.focusToggle, input, key)) {
        st.setFocus(st.focus === "input" ? "scroll" : "input");
        return;
      }
      if ((key.meta ?? false) && /^[1-9]$/.test(input)) manager.activate(Number(input) - 1);
    },
    { isActive: !pending && !paletteOpen }
  );

  return (
    <Box flexDirection="column">
      <TabBar />
      {layout === "zen" && <TelemetryStrip />}
      <Box>
        <Box flexDirection="column" flexGrow={1}>
          <ChatPane />
          {pending ? (
            pending.toolName === "AskUserQuestion" ? (
              <QuestionDialog request={pending} />
            ) : (
              <PermissionDialog request={pending} />
            )
          ) : paletteOpen ? (
            <CommandPalette />
          ) : (
            <>
              <InputBar />
              <PillBar />
            </>
          )}
        </Box>
        {layout === "sidebar" && <SidePanel />}
      </Box>
    </Box>
  );
}
```

Stub files so the App compiles before Tasks 10–14 (each gets replaced by its real task):

`src/ui/ChatPane.tsx` (stub):
```tsx
import React from "react";
import { Text } from "ink";
export function ChatPane(_props: { height?: number }) {
  return <Text dimColor>chat</Text>;
}
```

`src/ui/SidePanel.tsx` (stub):
```tsx
import React from "react";
import { Box, Text } from "ink";
export function SidePanel() {
  return (
    <Box flexDirection="column" width={28}>
      <Text dimColor>SESSION</Text>
    </Box>
  );
}
```

`src/ui/TelemetryStrip.tsx` (stub):
```tsx
import React from "react";
import { Text } from "ink";
export function TelemetryStrip() {
  return <Text dimColor>telemetry</Text>;
}
```

`src/ui/InputBar.tsx` (stub):
```tsx
import React from "react";
import { Text } from "ink";
export function InputBar() {
  return <Text>❯ </Text>;
}
```

`src/ui/PillBar.tsx` (stub):
```tsx
import React from "react";
import { Text } from "ink";
export function PillBar() {
  return <Text dimColor>pills</Text>;
}
```

`src/ui/CommandPalette.tsx` (stub):
```tsx
import React from "react";
import { Text } from "ink";
export function CommandPalette() {
  return <Text dimColor>palette</Text>;
}
```

`src/ui/dialogs.tsx` (stub):
```tsx
import React from "react";
import { Text } from "ink";
import type { PermissionRequest } from "../core/types.js";
export function PermissionDialog(_props: { request: PermissionRequest }) {
  return <Text>permission?</Text>;
}
export function QuestionDialog(_props: { request: PermissionRequest }) {
  return <Text>question?</Text>;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/ui && npm run typecheck`
Expected: PASS (6 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/store.ts src/ui tests/ui
git commit -m "feat(ui): app shell, tab bar, layout toggle, global keybindings"
```

---

### Task 10: ChatPane — virtualized transcript, vim scroll, search

**Files:**
- Modify: `src/ui/ChatPane.tsx` (replace stub)
- Test: `tests/ui/chat-pane.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/ui/chat-pane.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { ChatPane } from "../../src/ui/ChatPane.js";
import { renderWithCtx, makeCtx } from "./helpers.js";

function seed(ctx: ReturnType<typeof makeCtx>) {
  const s = ctx.manager.active!;
  s.transcript.addUser("refactor the JWT validation");
  s.transcript.apply({
    type: "assistant",
    message: { content: [{ type: "text", text: "I see the issue in the issuer check." }] },
  });
  ctx.store.getState().bump();
  return s;
}

describe("ChatPane", () => {
  it("renders user and assistant blocks", () => {
    const ctx = makeCtx();
    seed(ctx);
    const { lastFrame } = renderWithCtx(<ChatPane height={10} />, ctx);
    expect(lastFrame()).toContain("❯ refactor the JWT validation");
    expect(lastFrame()).toContain("I see the issue");
  });

  it("shows only the latest window of a long transcript and scrolls with g/G", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    for (let i = 0; i < 30; i++) s.transcript.addInfo(`line-${i}`);
    ctx.store.getState().bump();
    ctx.store.getState().setFocus("scroll");
    const { lastFrame, stdin } = renderWithCtx(<ChatPane height={5} />, ctx);
    expect(lastFrame()).toContain("line-29");
    expect(lastFrame()).not.toContain("line-0 ");
    stdin.write("g"); // jump to top
    expect(lastFrame()).toContain("line-0");
    stdin.write("G"); // back to bottom
    expect(lastFrame()).toContain("line-29");
  });

  it("searches with / and jumps with n", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    for (let i = 0; i < 20; i++) s.transcript.addInfo(i === 3 ? "needle here" : `filler-${i}`);
    ctx.store.getState().bump();
    ctx.store.getState().setFocus("scroll");
    const { lastFrame, stdin } = renderWithCtx(<ChatPane height={5} />, ctx);
    stdin.write("/");
    stdin.write("needle");
    stdin.write("\r"); // confirm search
    stdin.write("n");  // jump to match
    expect(lastFrame()).toContain("needle here");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/chat-pane.test.tsx`
Expected: FAIL — stub renders "chat", assertions miss.

- [ ] **Step 3: Implement ChatPane**

Replace `src/ui/ChatPane.tsx` entirely:
```tsx
import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import type { TranscriptBlock } from "../core/types.js";

export interface Line {
  text: string;
  color?: string;
  dim?: boolean;
}

export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length <= width) {
      out.push(raw);
      continue;
    }
    let line = raw;
    while (line.length > width) {
      out.push(line.slice(0, width));
      line = line.slice(width);
    }
    out.push(line);
  }
  return out;
}

export function blockLines(b: TranscriptBlock, width: number): Line[] {
  switch (b.kind) {
    case "user":
      return wrapText("❯ " + b.text, width).map((t) => ({ text: t, color: theme.warn }));
    case "assistant":
      return wrapText(b.text + (b.streaming ? "▋" : ""), width).map((t) => ({
        text: t,
        color: t.startsWith("+") ? theme.good : t.startsWith("-") ? theme.bad : undefined,
      }));
    case "tool":
      return [{
        text: `⚙ ${b.name} ${b.detail} ${b.status === "running" ? "…" : "✓"}`.slice(0, width),
        color: theme.purple,
      }];
    case "info":
      return wrapText(b.text, width).map((t) => ({ text: t, dim: true }));
  }
}

export function ChatPane({ height: heightProp }: { height?: number }) {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const focus = useApp((s) => s.focus);
  const layout = useApp((s) => s.layout);
  const { stdout } = useStdout();
  const session = manager.active;

  const cols = stdout?.columns ?? 80;
  const width = Math.max(20, layout === "sidebar" ? cols - 32 : cols - 2);
  const height = heightProp ?? Math.max(6, (stdout?.rows ?? 24) - 8);

  const [offset, setOffset] = useState(0); // lines scrolled up from bottom
  const [search, setSearch] = useState({ active: false, query: "" });

  useEffect(() => {
    setOffset(0);
    setSearch({ active: false, query: "" });
  }, [session?.id]);

  const lines: Line[] = [];
  for (const b of session?.transcript.blocks ?? []) lines.push(...blockLines(b, width));
  const maxOffset = Math.max(0, lines.length - height);

  const jump = (dir: 1 | -1) => {
    const q = search.query.toLowerCase();
    if (!q) return;
    const matches = lines
      .map((l, i) => (l.text.toLowerCase().includes(q) ? i : -1))
      .filter((i) => i >= 0);
    if (matches.length === 0) return;
    const cur = Math.max(0, lines.length - height - offset);
    const next =
      dir === 1
        ? matches.find((i) => i > cur) ?? matches[0]
        : [...matches].reverse().find((i) => i < cur) ?? matches[matches.length - 1];
    setOffset(Math.max(0, Math.min(maxOffset, lines.length - height - next)));
  };

  useInput(
    (input, key) => {
      if (search.active) {
        if (key.return || key.escape) setSearch((s) => ({ ...s, active: false }));
        else if (key.backspace || key.delete) setSearch((s) => ({ ...s, query: s.query.slice(0, -1) }));
        else if (input && !key.ctrl && !key.meta) setSearch((s) => ({ ...s, query: s.query + input }));
        return;
      }
      if (input === "j") setOffset((o) => Math.max(0, o - 1));
      else if (input === "k") setOffset((o) => Math.min(maxOffset, o + 1));
      else if (input === "G") setOffset(0);
      else if (input === "g") setOffset(maxOffset);
      else if (key.ctrl && input === "d") setOffset((o) => Math.max(0, o - Math.floor(height / 2)));
      else if (key.ctrl && input === "u") setOffset((o) => Math.min(maxOffset, o + Math.floor(height / 2)));
      else if (input === "/") setSearch({ active: true, query: "" });
      else if (input === "n") jump(1);
      else if (input === "N") jump(-1);
    },
    { isActive: focus === "scroll" }
  );

  const start = Math.max(0, lines.length - height - offset);
  const visible = lines.slice(start, start + height);
  const q = search.query.toLowerCase();

  return (
    <Box flexDirection="column" height={height + (search.active || search.query ? 1 : 0)}>
      {visible.map((l, i) => (
        <Text
          key={start + i}
          color={l.color}
          dimColor={l.dim}
          inverse={q !== "" && l.text.toLowerCase().includes(q)}
        >
          {l.text || " "}
        </Text>
      ))}
      {(search.active || search.query !== "") && (
        <Text color={theme.accent}>/{search.query}{search.active ? "▋" : `  (n/N to jump)`}</Text>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/chat-pane.test.tsx && npx vitest run tests/ui/app.test.tsx`
Expected: PASS — and the App tests still pass with the real ChatPane.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ChatPane.tsx tests/ui/chat-pane.test.tsx
git commit -m "feat(ui): virtualized chat pane with vim scrolling and transcript search"
```

---

### Task 11: SidePanel + TelemetryStrip

**Files:**
- Modify: `src/ui/SidePanel.tsx`, `src/ui/TelemetryStrip.tsx` (replace stubs)
- Create: `src/ui/format.ts`
- Test: `tests/ui/panels.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/ui/panels.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { SidePanel } from "../../src/ui/SidePanel.js";
import { TelemetryStrip } from "../../src/ui/TelemetryStrip.js";
import { fmtK, fmtUptime, bar } from "../../src/ui/format.js";
import { renderWithCtx, makeCtx } from "./helpers.js";

function seed(ctx: ReturnType<typeof makeCtx>) {
  const s = ctx.manager.active!;
  s.transcript.apply({
    type: "system", subtype: "init", session_id: "x", model: "claude-opus-4-8",
    mcp_servers: [{ name: "vibedrift", status: "connected" }], slash_commands: ["/commit"],
  });
  s.transcript.apply({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/auth.go" } }],
      usage: { input_tokens: 36800, output_tokens: 842 },
    },
  });
  s.transcript.apply({ type: "result", subtype: "success", total_cost_usd: 0.42, num_turns: 12 });
  ctx.store.getState().setHostStats({
    hostname: "mbp-sami", platform: "darwin 25.2.0", memUsedPct: 14, uptimeSec: 90000, branch: "feature/mcp",
  });
  ctx.store.getState().bump();
}

describe("format helpers", () => {
  it("formats tokens, uptime, bars", () => {
    expect(fmtK(36800)).toBe("36.8k");
    expect(fmtK(842)).toBe("842");
    expect(fmtUptime(90000)).toBe("1d 1h");
    expect(bar(50, 10)).toBe("▓▓▓▓▓░░░░░");
  });
});

describe("SidePanel", () => {
  it("shows model, tokens, cost, mcp, context files, and host stats", () => {
    const ctx = makeCtx();
    seed(ctx);
    const frame = renderWithCtx(<SidePanel />, ctx).lastFrame()!;
    expect(frame).toContain("claude-opus-4-8");
    expect(frame).toContain("36.8k");
    expect(frame).toContain("$0.42");
    expect(frame).toContain("vibedrift");
    expect(frame).toContain("src/auth.go");
    expect(frame).toContain("mbp-sami");
    expect(frame).toContain("feature/mcp");
  });
});

describe("TelemetryStrip", () => {
  it("compresses the same telemetry into one line", () => {
    const ctx = makeCtx();
    seed(ctx);
    const frame = renderWithCtx(<TelemetryStrip />, ctx).lastFrame()!;
    expect(frame).toContain("claude-opus-4-8");
    expect(frame).toContain("$0.42");
    expect(frame).toContain("feature/mcp");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/panels.test.tsx`
Expected: FAIL — `format.js` not found; stubs miss assertions.

- [ ] **Step 3: Implement format helpers and panels**

`src/ui/format.ts`:
```ts
export function fmtK(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

export function bar(pct: number, width: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

/** Rough context meter denominator; refined later if model metadata exposes it. */
export const CONTEXT_WINDOW = 200_000;
```

Replace `src/ui/SidePanel.tsx`:
```tsx
import React from "react";
import { Box, Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { bar, fmtK, fmtUptime, CONTEXT_WINDOW } from "./format.js";

function Header({ label }: { label: string }) {
  return <Text color={theme.dim}>{label}</Text>;
}

export function SidePanel() {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const host = useApp((s) => s.hostStats);
  const s = manager.active;
  if (!s) return null;
  const u = s.transcript.usage;
  const meta = s.transcript.meta;
  const files = [...s.transcript.contextFiles].slice(-6);
  const ctxPct = Math.round(((u.inputTokens + u.cacheReadTokens) / CONTEXT_WINDOW) * 100);

  return (
    <Box flexDirection="column" width={30} paddingLeft={1}>
      <Header label="CONTEXT" />
      {files.length === 0 && <Text dimColor>(no files yet)</Text>}
      {files.map((f) => (
        <Text key={f} color={theme.fg}>{f.length > 27 ? "…" + f.slice(-26) : f}</Text>
      ))}
      <Text> </Text>
      <Header label="SESSION" />
      <Text color={theme.fg}>MODEL  {meta.model ?? "—"}</Text>
      <Text color={theme.fg}>TOKENS {fmtK(u.inputTokens)} in · {fmtK(u.outputTokens)} out</Text>
      <Text color={theme.accent}>{bar(ctxPct, 14)} <Text color={theme.dim}>{ctxPct}%</Text></Text>
      <Text color={theme.fg}>COST   ${u.costUsd.toFixed(2)} · {u.turns} turns</Text>
      <Text color={theme.fg}>MODE   {s.permissionMode}</Text>
      {meta.mcpServers.map((m) => (
        <Text key={m.name} color={theme.fg}>
          MCP    {m.name} <Text color={m.status === "connected" ? theme.good : theme.bad}>●</Text>
        </Text>
      ))}
      <Text> </Text>
      <Header label="HOST" />
      {host && (
        <>
          <Text color={theme.fg}>{host.hostname} · mem {host.memUsedPct}%</Text>
          {host.branch && <Text color={theme.purple}>⎇ {host.branch}</Text>}
          <Text dimColor>up {fmtUptime(host.uptimeSec)}</Text>
        </>
      )}
    </Box>
  );
}
```

Replace `src/ui/TelemetryStrip.tsx`:
```tsx
import React from "react";
import { Text } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { bar, fmtK, CONTEXT_WINDOW } from "./format.js";

export function TelemetryStrip() {
  const { manager } = useAppCtx();
  useApp((s) => s.version);
  const host = useApp((s) => s.hostStats);
  const s = manager.active;
  if (!s) return null;
  const u = s.transcript.usage;
  const meta = s.transcript.meta;
  const ctxPct = Math.round(((u.inputTokens + u.cacheReadTokens) / CONTEXT_WINDOW) * 100);
  const mcp = meta.mcpServers.map((m) => m.name).join(",");

  return (
    <Text color={theme.dim}>
      {" "}{meta.model ?? "—"} · {fmtK(u.inputTokens)}/{fmtK(u.outputTokens)}{" "}
      <Text color={theme.accent}>{bar(ctxPct, 5)}</Text> · ${u.costUsd.toFixed(2)}
      {mcp ? ` · ${mcp} ●` : ""}{host?.branch ? ` · ⎇ ${host.branch}` : ""}
      {host ? ` · mem ${host.memUsedPct}%` : ""}
    </Text>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/panels.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/format.ts src/ui/SidePanel.tsx src/ui/TelemetryStrip.tsx tests/ui/panels.test.tsx
git commit -m "feat(ui): sidebar telemetry panel and zen-mode strip"
```

---

### Task 12: InputBar (autocomplete) + PillBar

**Files:**
- Modify: `src/ui/InputBar.tsx`, `src/ui/PillBar.tsx` (replace stubs)
- Create: `src/core/files.ts`
- Test: `tests/ui/input.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/ui/input.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { InputBar } from "../../src/ui/InputBar.js";
import { PillBar } from "../../src/ui/PillBar.js";
import { renderWithCtx, makeCtx } from "./helpers.js";

describe("InputBar", () => {
  it("types and submits a prompt to the active session", () => {
    const ctx = makeCtx();
    const { stdin } = renderWithCtx(<InputBar />, ctx);
    stdin.write("hi claude");
    stdin.write("\r");
    const blocks = ctx.manager.active!.transcript.blocks;
    expect(blocks[0]).toMatchObject({ kind: "user", text: "hi claude" });
  });

  it("autocompletes slash commands with tab", () => {
    const ctx = makeCtx();
    ctx.manager.active!.transcript.apply({
      type: "system", subtype: "init", slash_commands: ["/commit", "/review"],
    });
    ctx.store.getState().bump();
    const { stdin, lastFrame } = renderWithCtx(<InputBar />, ctx);
    stdin.write("/com");
    expect(lastFrame()).toContain("/commit");
    stdin.write("\t");
    expect(lastFrame()).toContain("❯ /commit");
  });

  it("tab on empty input hands focus to pills", () => {
    const ctx = makeCtx();
    const { stdin } = renderWithCtx(<InputBar />, ctx);
    stdin.write("\t");
    expect(ctx.store.getState().focus).toBe("pills");
  });
});

describe("PillBar", () => {
  it("fires the selected pill into the session and returns focus to input", () => {
    const ctx = makeCtx();
    ctx.store.getState().setFocus("pills");
    const { stdin } = renderWithCtx(<PillBar />, ctx);
    stdin.write("\r"); // fire first default pill: "fix tests"
    const blocks = ctx.manager.active!.transcript.blocks;
    expect(blocks[0]).toMatchObject({ kind: "user" });
    expect((blocks[0] as { text: string }).text).toContain("test");
    expect(ctx.store.getState().focus).toBe("input");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/input.test.tsx`
Expected: FAIL — stubs don't handle input.

- [ ] **Step 3: Implement file listing helper**

`src/core/files.ts`:
```ts
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", ".superpowers"]);

export function listProjectFiles(cwd: string, maxDepth = 2, max = 500): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || out.length >= max) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e) || out.length >= max) continue;
      const full = join(dir, e);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(full, depth + 1);
      else out.push(relative(cwd, full));
    }
  };
  walk(cwd, 0);
  return out;
}
```

- [ ] **Step 4: Implement InputBar and PillBar**

Replace `src/ui/InputBar.tsx`:
```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";
import { fuzzyFilter } from "../core/fuzzy.js";
import { listProjectFiles } from "../core/files.js";

export function InputBar() {
  const { manager, store } = useAppCtx();
  useApp((s) => s.version);
  const focus = useApp((s) => s.focus);
  const [text, setText] = useState("");
  const session = manager.active;

  const slashCommands = (session?.transcript.meta.slashCommands ?? []).map((c) =>
    c.startsWith("/") ? c : "/" + c
  );
  const suggestions =
    text.startsWith("/") && !text.includes(" ")
      ? fuzzyFilter(slashCommands, text.slice(1), (c) => c).slice(0, 5)
      : [];

  useInput(
    (input, key) => {
      if (key.return) {
        const t = text.trim();
        if (t !== "") session?.send(t);
        setText("");
        return;
      }
      if (key.tab) {
        if (text === "") {
          store.getState().setFocus("pills");
          return;
        }
        if (suggestions.length > 0) {
          setText(suggestions[0] + " ");
          return;
        }
        const words = text.split(" ");
        const lastWord = words[words.length - 1];
        if (lastWord.startsWith("@") && session) {
          const matches = fuzzyFilter(listProjectFiles(session.cwd), lastWord.slice(1), (f) => f);
          if (matches.length > 0) {
            words[words.length - 1] = "@" + matches[0];
            setText(words.join(" ") + " ");
          }
        }
        return;
      }
      if (key.backspace || key.delete) {
        setText((t) => t.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) setText((t) => t + input);
    },
    { isActive: focus === "input" }
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.accent}>❯ </Text>
        <Text color={theme.fg}>{text}</Text>
        {focus === "input" && <Text color={theme.accent}>▋</Text>}
        {text === "" && <Text dimColor> Enter prompt — Tab: pills · /: commands · @: files</Text>}
      </Box>
      {suggestions.length > 0 && (
        <Text dimColor>  {suggestions.join("   ")}</Text>
      )}
    </Box>
  );
}
```

Replace `src/ui/PillBar.tsx`:
```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useApp, useAppCtx } from "./context.js";
import { theme } from "./theme.js";

export function PillBar() {
  const { manager, config, store } = useAppCtx();
  useApp((s) => s.version);
  const focus = useApp((s) => s.focus);
  const [sel, setSel] = useState(0);
  const session = manager.active;
  const focused = focus === "pills";

  useInput(
    (input, key) => {
      if (key.escape || key.tab) {
        store.getState().setFocus("input");
        return;
      }
      if (key.leftArrow) setSel((s) => Math.max(0, s - 1));
      else if (key.rightArrow) setSel((s) => Math.min(config.pills.length - 1, s + 1));
      else if (key.return) {
        const p = config.pills[sel];
        const payload = p.slash ?? p.prompt;
        if (payload) session?.send(payload);
        store.getState().setFocus("input");
      }
    },
    { isActive: focused }
  );

  return (
    <Box>
      {config.pills.map((p, i) => (
        <Text
          key={p.label}
          inverse={focused && i === sel}
          color={focused && i === sel ? theme.accent : theme.dim}
        >
          {" "}{p.label}{" "}
        </Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/ui/input.test.tsx && npm run typecheck`
Expected: PASS (4 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/files.ts src/ui/InputBar.tsx src/ui/PillBar.tsx tests/ui/input.test.tsx
git commit -m "feat(ui): input bar with slash/@file autocomplete and quick-action pills"
```

---

### Task 13: Permission + Question dialogs

**Files:**
- Modify: `src/ui/dialogs.tsx` (replace stub)
- Test: `tests/ui/dialogs.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/ui/dialogs.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { PermissionDialog, QuestionDialog } from "../../src/ui/dialogs.js";
import { renderWithCtx } from "./helpers.js";
import type { PermissionRequest, PermissionResult } from "../../src/core/types.js";

function makeRequest(over: Partial<PermissionRequest> = {}) {
  const resolved: PermissionResult[] = [];
  const request: PermissionRequest = {
    toolName: "Bash",
    input: { command: "rm -rf /tmp/x" },
    suggestions: [
      { destination: "session", kind: "a" },
      { destination: "localSettings", kind: "b" },
    ],
    resolve: (r) => resolved.push(r),
    ...over,
  };
  return { request, resolved };
}

describe("PermissionDialog", () => {
  it("y allows once with the original input", () => {
    const { request, resolved } = makeRequest();
    const { stdin, lastFrame } = renderWithCtx(<PermissionDialog request={request} />);
    expect(lastFrame()).toContain("Bash");
    expect(lastFrame()).toContain("rm -rf /tmp/x");
    stdin.write("y");
    expect(resolved[0]).toMatchObject({ behavior: "allow", updatedInput: { command: "rm -rf /tmp/x" } });
  });

  it("a allows and persists the localSettings suggestion", () => {
    const { request, resolved } = makeRequest();
    const { stdin } = renderWithCtx(<PermissionDialog request={request} />);
    stdin.write("a");
    const r = resolved[0] as Extract<PermissionResult, { behavior: "allow" }>;
    expect(r.updatedPermissions).toEqual([{ destination: "localSettings", kind: "b" }]);
  });

  it("n + typed reason denies with that message", () => {
    const { request, resolved } = makeRequest();
    const { stdin } = renderWithCtx(<PermissionDialog request={request} />);
    stdin.write("n");
    stdin.write("use trash instead");
    stdin.write("\r");
    expect(resolved[0]).toMatchObject({ behavior: "deny", message: "use trash instead" });
  });
});

describe("QuestionDialog", () => {
  it("answers a single-select question with the chosen label", () => {
    const { request, resolved } = makeRequest({
      toolName: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Which DB?",
            header: "DB",
            options: [{ label: "Postgres", description: "relational" }, { label: "SQLite", description: "embedded" }],
            multiSelect: false,
          },
        ],
      },
    });
    const { stdin, lastFrame } = renderWithCtx(<QuestionDialog request={request} />);
    expect(lastFrame()).toContain("Which DB?");
    stdin.write("j"); // move to SQLite
    stdin.write("\r");
    const r = resolved[0] as Extract<PermissionResult, { behavior: "allow" }>;
    expect((r.updatedInput.answers as Record<string, string>)["Which DB?"]).toBe("SQLite");
    expect(r.updatedInput.questions).toBeDefined();
  });

  it("joins multi-select answers with a comma", () => {
    const { request, resolved } = makeRequest({
      toolName: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Which sections?",
            header: "Sections",
            options: [{ label: "Intro" }, { label: "Body" }, { label: "Outro" }],
            multiSelect: true,
          },
        ],
      },
    });
    const { stdin } = renderWithCtx(<QuestionDialog request={request} />);
    stdin.write(" ");      // check Intro
    stdin.write("j");
    stdin.write(" ");      // check Body
    stdin.write("\r");
    const r = resolved[0] as Extract<PermissionResult, { behavior: "allow" }>;
    expect((r.updatedInput.answers as Record<string, string>)["Which sections?"]).toBe("Intro, Body");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/dialogs.test.tsx`
Expected: FAIL — stub doesn't handle keys.

- [ ] **Step 3: Implement dialogs**

Replace `src/ui/dialogs.tsx` entirely:
```tsx
import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";
import type { PermissionRequest } from "../core/types.js";

function inputPreview(input: Record<string, unknown>): string {
  if (typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return String(input.file_path);
  const s = JSON.stringify(input);
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

export function PermissionDialog({ request }: { request: PermissionRequest }) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");

  useInput((input, key) => {
    if (denying) {
      if (key.return) {
        request.resolve({ behavior: "deny", message: reason.trim() || "User denied this action" });
      } else if (key.escape) setDenying(false);
      else if (key.backspace || key.delete) setReason((r) => r.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setReason((r) => r + input);
      return;
    }
    if (input === "y") {
      request.resolve({ behavior: "allow", updatedInput: request.input });
    } else if (input === "a") {
      const persist = request.suggestions.filter((s) => s.destination === "localSettings");
      request.resolve({
        behavior: "allow",
        updatedInput: request.input,
        updatedPermissions: (persist.length > 0 ? persist : request.suggestions) as unknown[],
      });
    } else if (input === "n") {
      setDenying(true);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.warn} paddingX={1}>
      <Text color={theme.warn} bold>⚠ Permission: {request.toolName}</Text>
      <Text color={theme.fg}>{inputPreview(request.input)}</Text>
      {denying ? (
        <Text color={theme.bad}>
          reason: {reason}▋ <Text dimColor>(Enter to send · Esc to cancel)</Text>
        </Text>
      ) : (
        <Text dimColor>y allow once · a always allow · n deny</Text>
      )}
    </Box>
  );
}

interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

export function QuestionDialog({ request }: { request: PermissionRequest }) {
  const questions = (request.input.questions as Question[] | undefined) ?? [];
  const [qi, setQi] = useState(0);
  const [sel, setSel] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [free, setFree] = useState<string | null>(null);
  const q: Question | undefined = questions[qi];

  useEffect(() => {
    if (!q) request.resolve({ behavior: "allow", updatedInput: { questions, answers: {} } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (value: string) => {
    const next = { ...answers, [q!.question]: value };
    if (qi + 1 < questions.length) {
      setAnswers(next);
      setQi(qi + 1);
      setSel(0);
      setChecked(new Set());
      setFree(null);
    } else {
      request.resolve({
        behavior: "allow",
        updatedInput: { questions: request.input.questions, answers: next },
      });
    }
  };

  useInput((input, key) => {
    if (!q) return;
    if (free !== null) {
      if (key.return) submit(free.trim() || q.options[sel]?.label || "");
      else if (key.escape) setFree(null);
      else if (key.backspace || key.delete) setFree((f) => (f ?? "").slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setFree((f) => (f ?? "") + input);
      return;
    }
    if (key.upArrow || input === "k") setSel((s) => Math.max(0, s - 1));
    else if (key.downArrow || input === "j") setSel((s) => Math.min(q.options.length - 1, s + 1));
    else if (input === " " && q.multiSelect) {
      setChecked((c) => {
        const n = new Set(c);
        if (n.has(sel)) n.delete(sel);
        else n.add(sel);
        return n;
      });
    } else if (input === "o") setFree("");
    else if (key.return) {
      if (q.multiSelect && checked.size > 0) {
        submit([...checked].sort((a, b) => a - b).map((i) => q.options[i].label).join(", "));
      } else {
        submit(q.options[sel].label);
      }
    }
  });

  if (!q) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        ? {q.header ? `${q.header}: ` : ""}{q.question} <Text dimColor>({qi + 1}/{questions.length})</Text>
      </Text>
      {q.options.map((o, i) => (
        <Text key={o.label} color={i === sel ? theme.accent : theme.fg} inverse={i === sel}>
          {q.multiSelect ? (checked.has(i) ? "[x] " : "[ ] ") : i === sel ? "❯ " : "  "}
          {o.label}
          {o.description ? <Text dimColor> — {o.description}</Text> : null}
        </Text>
      ))}
      {free !== null ? (
        <Text color={theme.fg}>other: {free}▋</Text>
      ) : (
        <Text dimColor>↑↓/jk move{q.multiSelect ? " · space toggle" : ""} · Enter confirm · o other</Text>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/dialogs.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/dialogs.tsx tests/ui/dialogs.test.tsx
git commit -m "feat(ui): permission dialog (y/a/n + reason) and AskUserQuestion dialog"
```

---

### Task 14: Command palette

**Files:**
- Modify: `src/ui/CommandPalette.tsx` (replace stub)
- Test: `tests/ui/palette.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/ui/palette.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { CommandPalette, buildPaletteItems } from "../../src/ui/CommandPalette.js";
import { renderWithCtx, makeCtx } from "./helpers.js";

describe("buildPaletteItems", () => {
  it("includes sessions, actions, pills, and slash commands", () => {
    const ctx = makeCtx();
    ctx.manager.active!.transcript.apply({ type: "system", subtype: "init", slash_commands: ["/commit"] });
    const labels = buildPaletteItems(ctx).map((i) => i.label);
    expect(labels).toContain("switch: new session");
    expect(labels).toContain("action: new session");
    expect(labels).toContain("action: toggle layout");
    expect(labels).toContain("action: search history");
    expect(labels.some((l) => l.startsWith("mode:"))).toBe(true);
    expect(labels).toContain("pill: fix tests");
    expect(labels).toContain("slash: /commit");
  });
});

describe("CommandPalette", () => {
  it("filters with fuzzy typing and executes on Enter", () => {
    const ctx = makeCtx();
    ctx.store.getState().setPaletteOpen(true);
    const { stdin, lastFrame } = renderWithCtx(<CommandPalette />, ctx);
    stdin.write("toggle");
    expect(lastFrame()).toContain("action: toggle layout");
    stdin.write("\r");
    expect(ctx.store.getState().layout).toBe("zen");
    expect(ctx.store.getState().paletteOpen).toBe(false);
  });

  it("escape closes without executing", () => {
    const ctx = makeCtx();
    ctx.store.getState().setPaletteOpen(true);
    const { stdin } = renderWithCtx(<CommandPalette />, ctx);
    stdin.write("\u001b"); // esc
    expect(ctx.store.getState().paletteOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/palette.test.tsx`
Expected: FAIL — stub has no exports/behavior.

- [ ] **Step 3: Implement**

Replace `src/ui/CommandPalette.tsx` entirely:
```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useApp, useAppCtx, type AppCtx } from "./context.js";
import { theme } from "./theme.js";
import { fuzzyFilter } from "../core/fuzzy.js";
import { searchHistory, type HistoryHit } from "../core/history-search.js";

export interface PaletteItem {
  label: string;
  hint?: string;
  run: () => void;
  /** "history" switches the palette into history-search mode instead of closing. */
  mode?: "history";
}

export function buildPaletteItems(ctx: AppCtx): PaletteItem[] {
  const { manager, config, store } = ctx;
  const session = manager.active;
  const items: PaletteItem[] = [];

  manager.sessions.forEach((s, i) => {
    items.push({ label: `switch: ${s.title}`, hint: `alt+${i + 1}`, run: () => manager.activate(i) });
  });

  items.push({ label: "action: new session", run: () => void manager.create() });
  items.push({ label: "action: close session", run: () => session && manager.close(session.id) });
  items.push({ label: "action: toggle layout", run: () => store.getState().toggleLayout() });
  items.push({ label: "action: interrupt session", run: () => void session?.interrupt() });
  items.push({ label: "action: resume crashed session", run: () => session?.resume() });
  items.push({ label: "action: search history", mode: "history", run: () => {} });

  for (const mode of ["default", "plan", "acceptEdits", "bypassPermissions"]) {
    items.push({ label: `mode: ${mode}`, run: () => void session?.setPermissionMode(mode) });
  }

  for (const pill of config.pills) {
    items.push({
      label: `pill: ${pill.label}`,
      run: () => {
        const payload = pill.slash ?? pill.prompt;
        if (payload) session?.send(payload);
      },
    });
  }

  const slashCommands = (session?.transcript.meta.slashCommands ?? []).map((c) =>
    c.startsWith("/") ? c : "/" + c
  );
  for (const cmd of slashCommands) {
    items.push({ label: `slash: ${cmd}`, run: () => session?.send(cmd) });
  }

  return items;
}

export function CommandPalette() {
  const ctx = useAppCtx();
  const { manager, store } = ctx;
  useApp((s) => s.version);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [historyMode, setHistoryMode] = useState(false);

  const close = () => {
    store.getState().setPaletteOpen(false);
  };

  const items = historyMode ? [] : fuzzyFilter(buildPaletteItems(ctx), query, (i) => i.label).slice(0, 8);
  const hits: HistoryHit[] = historyMode && manager.active
    ? searchHistory(manager.active.cwd, query, { limit: 8 })
    : [];

  useInput((input, key) => {
    if (key.escape) {
      if (historyMode) {
        setHistoryMode(false);
        setQuery("");
        return;
      }
      close();
      return;
    }
    if (key.return) {
      if (historyMode) {
        const hit = hits[sel];
        if (hit) manager.active?.send(hit.text);
        close();
        return;
      }
      const item = items[sel];
      if (!item) return;
      if (item.mode === "history") {
        setHistoryMode(true);
        setQuery("");
        setSel(0);
        return;
      }
      item.run();
      close();
      return;
    }
    if (key.upArrow) setSel((s) => Math.max(0, s - 1));
    else if (key.downArrow) setSel((s) => s + 1);
    else if (key.backspace || key.delete) setQuery((q) => q.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setSel(0);
    }
  });

  const rows = historyMode ? hits.map((h) => h.text) : items.map((i) => i.label + (i.hint ? `  ${i.hint}` : ""));
  const clampedSel = Math.min(sel, Math.max(0, rows.length - 1));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent}>
        {historyMode ? "history ❯ " : "❯ "}{query}▋
      </Text>
      {rows.map((r, i) => (
        <Text key={i} inverse={i === clampedSel} color={i === clampedSel ? theme.accent : theme.fg}>
          {r.length > 70 ? r.slice(0, 67) + "…" : r}
        </Text>
      ))}
      {rows.length === 0 && <Text dimColor>{historyMode ? "type to search past sessions" : "no matches"}</Text>}
      <Text dimColor>{historyMode ? "Enter re-sends as prompt · Esc back" : "Enter run · Esc close"}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/palette.test.tsx && npx vitest run tests/ui`
Expected: PASS — palette tests and all prior UI tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/CommandPalette.tsx tests/ui/palette.test.tsx
git commit -m "feat(ui): ctrl+k command palette with fuzzy filter and history mode"
```

---

### Task 15: CLI entry — wiring, preflight, shutdown, crash UX, size guard

**Files:**
- Modify: `src/cli.tsx` (replace hello-world), `src/ui/App.tsx`, `src/core/session.ts`

- [ ] **Step 1: Add crash info line to Session (modify src/core/session.ts)**

In `pump()`, inside the `catch` block, after `this.error = ...`, add:

```ts
      this.transcript.addInfo(`✖ session crashed: ${this.error} — press r to resume`);
```

(The full catch block becomes:)
```ts
    } catch (err) {
      this.status = "crashed";
      this.error = err instanceof Error ? err.message : String(err);
      this.transcript.addInfo(`✖ session crashed: ${this.error} — press r to resume`);
      this.queue = null;
      this.handle = null;
      this.pendingPermission?.resolve({ behavior: "deny", message: "session crashed" });
    }
```

Run: `npx vitest run tests/core/session.test.ts`
Expected: still PASS.

- [ ] **Step 2: Add crash-resume key and terminal-size guard to App (modify src/ui/App.tsx)**

Inside the `useInput` callback in `App`, add as the FIRST line of the handler:

```ts
      if (session?.status === "crashed" && input === "r") {
        session.resume();
        return;
      }
```

And add a size guard plus resize re-render. Import `useStdout` from ink, then at the top of the `App` component body (after the hooks already there):

```tsx
  const { stdout } = useStdout();
  useEffect(() => {
    const onResize = () => store.getState().bump();
    stdout?.on("resize", onResize);
    return () => {
      stdout?.off("resize", onResize);
    };
  }, [stdout, store]);

  if ((stdout?.columns ?? 80) < 60 || (stdout?.rows ?? 24) < 14) {
    return <Text color="yellow">terminal too small for claudeshell — resize to at least 60×14</Text>;
  }
```

(`Text` joins the existing ink import.)

Run: `npx vitest run tests/ui`
Expected: still PASS (test terminals report large dimensions or undefined → defaults pass the guard).

- [ ] **Step 3: Replace src/cli.tsx with the real entry**

```tsx
#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import { App } from "./ui/App.js";
import { AppContext } from "./ui/context.js";
import { createAppStore } from "./store.js";
import { SessionManager } from "./core/session-manager.js";
import { SystemMonitor } from "./core/system-monitor.js";
import { loadConfig } from "./core/config.js";

const pExecFile = promisify(execFile);

async function preflight(): Promise<string | null> {
  try {
    await pExecFile("claude", ["--version"]);
    return null;
  } catch {
    return [
      "warning: `claude` CLI not found on PATH.",
      "claudeshell runs on the bundled Agent SDK, but Claude Code is recommended for auth:",
      "  npm install -g @anthropic-ai/claude-code && claude  (then /login)",
    ].join("\n");
  }
}

async function main() {
  const warning = await preflight();
  if (warning) console.error(warning);

  const cwd = process.cwd();
  const config = loadConfig({ cwd });
  const manager = new SessionManager({
    cwd,
    statePath: join(homedir(), ".claudeshell", "state.json"),
  });
  manager.restoreState();

  const store = createAppStore(config.layout);
  manager.subscribe(() => store.getState().bump());

  const monitor = new SystemMonitor(cwd);
  monitor.start(5000, (stats) => store.getState().setHostStats(stats));

  const cleanup = () => {
    try {
      manager.saveState();
    } catch {
      // never block exit on persistence
    }
    monitor.stop();
    manager.dispose();
  };
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  const instance = render(
    <AppContext.Provider value={{ manager, config, store }}>
      <App />
    </AppContext.Provider>
  );

  await instance.waitUntilExit(); // Ctrl+C unmounts Ink (default exitOnCtrlC)
  cleanup();
}

void main();
```

- [ ] **Step 4: Verify everything still builds and tests pass**

Run: `npm run typecheck && npm test`
Expected: no type errors; all suites PASS.

- [ ] **Step 5: Manual smoke (requires Claude Code auth on this machine)**

Run: `npm run dev` in a small git repo.
Expected: tab bar + sidebar render; typing a prompt streams a response; a Bash tool request pops the permission dialog; Ctrl+O switches to zen; Ctrl+C exits cleanly and restores the terminal. Note observations; fix only breakages, not polish.

- [ ] **Step 6: Commit**

```bash
git add src/cli.tsx src/ui/App.tsx src/core/session.ts
git commit -m "feat: real CLI entry — preflight, persistence, host monitor, clean shutdown"
```

---

### Task 16: E2E smoke, README, packaging polish

**Files:**
- Create: `tests/e2e/smoke.test.ts`, `README.md`
- Modify: `package.json`

- [ ] **Step 1: Write the env-gated E2E smoke test**

`tests/e2e/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

const enabled = process.env.CLAUDESHELL_E2E === "1";

describe.skipIf(!enabled)("e2e smoke (real Claude Code)", () => {
  it("completes a one-turn session and yields a result message", async () => {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const types: string[] = [];
    for await (const msg of query({
      prompt: "Reply with exactly: pong",
      options: { maxTurns: 1, cwd: process.cwd() },
    })) {
      types.push((msg as { type: string }).type);
    }
    expect(types).toContain("result");
  }, 120_000);
});
```

Run: `npx vitest run tests/e2e/smoke.test.ts`
Expected: SKIPPED (no env var). With `CLAUDESHELL_E2E=1` and valid auth: PASS.

- [ ] **Step 2: Write README.md**

```markdown
# claudeshell

A visual terminal shell for [Claude Code](https://claude.com/claude-code): multi-session
tabs, live token/cost telemetry, MCP + host status, quick-action pills, and a command
palette — all inside your terminal.

## Install

​```bash
npm install -g claudeshell
cd your-project && claudeshell
​```

Requires Node ≥ 18 and a logged-in Claude Code (`claude` then `/login`), or
`ANTHROPIC_API_KEY`.

## Keys

| Key | Action |
|---|---|
| `Ctrl+K` | Command palette (sessions, actions, pills, slash commands, history) |
| `Ctrl+O` | Toggle layout: sidebar ⇄ zen |
| `Alt+1..9` | Jump to session tab |
| `Alt+T` / `Alt+W` | New / close session |
| `Esc` | Toggle input ⇄ transcript scroll mode |
| `j k g G Ctrl+D Ctrl+U` | Scroll transcript (scroll mode) |
| `/` then `n/N` | Search transcript (scroll mode) |
| `Tab` | Autocomplete `/commands` and `@files`; from empty input: focus pills |
| `r` | Resume a crashed session |

macOS note: Alt shortcuts need "Use Option as Meta key" enabled in your terminal profile.

## Config

Global `~/.claudeshell/config.toml`, per-project `.claudeshell.toml` (project wins):

​```toml
[layout]
default = "sidebar"   # or "zen"

[keys]
palette = "ctrl+k"

[[pills]]
label  = "fix tests"
prompt = "Run the test suite and fix any failures"

[[pills]]
label = "commit"
slash = "/commit"
​```

## Permission dialogs

When Claude wants to run a tool you'll get a dialog: `y` allow once, `a` always allow
(persists to `.claude/settings.local.json`), `n` deny with an optional reason. Claude's
clarifying questions render as selectable option lists.
```

(Remove the zero-width characters around the inner code fences when writing the file — they exist only to nest fences in this plan.)

- [ ] **Step 3: Packaging polish (modify package.json)**

Add to the top level:
```json
  "keywords": ["claude", "claude-code", "tui", "terminal", "ink", "ai"],
  "repository": { "type": "git", "url": "https://github.com/samiahmadkhan/claudeshell" }
```
Add to `scripts`:
```json
    "prepublishOnly": "npm run typecheck && npm test && npm run build"
```

- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npm test && npm run build && node dist/cli.js --help 2>/dev/null; echo done`
Expected: types clean, all tests pass, build emits `dist/cli.js`, "done" prints.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/smoke.test.ts README.md package.json
git commit -m "chore: e2e smoke test, README, npm packaging polish"
```

---

## Out of scope (per spec)

Remote-node monitoring, mouse support, dynamic pills, theming beyond the built-in palette, first-class Windows support.

---

### Task 17: Model switching (closes spec's "switch model" palette action)

Extends Task 4 (config), Task 6 (Session), Task 14 (palette). Execute after Task 14 (or fold into those tasks if executing in order).

**Files:**
- Modify: `src/core/config.ts`, `src/core/session.ts`, `src/ui/CommandPalette.tsx`
- Test: extend `tests/core/config.test.ts`, `tests/ui/palette.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/config.test.ts` inside `describe("loadConfig")`:
```ts
  it("exposes a default model list, overridable in TOML", () => {
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.models).toContain("claude-opus-4-8");
    writeFileSync(join(globalDir, "config.toml"), `models = ["my-model"]\n`);
    expect(loadConfig({ globalDir, cwd: projectDir }).models).toEqual(["my-model"]);
  });
```

Append to `tests/ui/palette.test.tsx` inside `describe("buildPaletteItems")`:
```ts
  it("includes model-switch entries from config", () => {
    const ctx = makeCtx();
    const labels = buildPaletteItems(ctx).map((i) => i.label);
    expect(labels).toContain("model: claude-opus-4-8");
  });
```

Run: `npx vitest run tests/core/config.test.ts tests/ui/palette.test.tsx`
Expected: FAIL — `models` missing from Config; no model palette entries.

- [ ] **Step 2: Implement config models**

In `src/core/config.ts`:
- Add to the `Config` interface: `models: string[];`
- Add constant:
```ts
export const DEFAULT_MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"];
```
- Add to `RawConfig`: `models?: string[];`
- In `loadConfig`'s returned object add:
```ts
    models: p.models ?? g.models ?? DEFAULT_MODELS,
```

- [ ] **Step 3: Implement Session.setModel**

In `src/core/session.ts`, add below `setPermissionMode`:
```ts
  async setModel(model: string): Promise<void> {
    await this.handle?.setModel?.(model);
    this.transcript.meta.model = model;
    this.onChange();
  }
```

- [ ] **Step 4: Implement palette entries**

In `src/ui/CommandPalette.tsx` `buildPaletteItems`, after the permission-mode loop add:
```ts
  for (const model of config.models) {
    items.push({ label: `model: ${model}`, run: () => void session?.setModel(model) });
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/core/config.test.ts tests/ui/palette.test.tsx && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/config.ts src/core/session.ts src/ui/CommandPalette.tsx tests/core/config.test.ts tests/ui/palette.test.tsx
git commit -m "feat: model switching via palette, configurable model list"
```

---

### Task 18: Custom themes (user request, added 2026-06-12)

Users can write theme files and select them in config; claudeshell ships the default "cyberpunk" theme. Execute after Task 17.

**Files:**
- Modify: `src/ui/theme.ts`, `src/core/config.ts`, `src/cli.tsx`
- Test: `tests/ui/theme.test.ts`, extend `tests/core/config.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/ui/theme.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CYBERPUNK, loadThemeOverrides, resolveTheme } from "../../src/ui/theme.js";

describe("themes", () => {
  it("returns empty overrides when the theme is the built-in default or file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-themes-"));
    expect(loadThemeOverrides("cyberpunk", dir)).toEqual({});
    expect(loadThemeOverrides("nope", dir)).toEqual({});
  });

  it("loads valid color overrides and drops invalid values and unknown keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-themes-"));
    writeFileSync(
      join(dir, "solar.toml"),
      `accent = "#b58900"\nwarn = "not-a-color"\nbogus = "#ffffff"\ngood = "#0f0"\n`
    );
    expect(loadThemeOverrides("solar", dir)).toEqual({ accent: "#b58900", good: "#0f0" });
  });

  it("resolveTheme merges overrides onto the cyberpunk default", () => {
    const t = resolveTheme({ accent: "#b58900" });
    expect(t.accent).toBe("#b58900");
    expect(t.dim).toBe(CYBERPUNK.dim);
  });
});
```

Append to `tests/core/config.test.ts` describe block:
```ts
  it("reads the theme name, defaulting to cyberpunk", () => {
    expect(loadConfig({ globalDir, cwd: projectDir }).theme).toBe("cyberpunk");
    writeFileSync(join(globalDir, "config.toml"), `[theme]\nname = "solar"\n`);
    expect(loadConfig({ globalDir, cwd: projectDir }).theme).toBe("solar");
  });
```

Run both — expect FAIL (exports missing).

- [ ] **Step 2: Implement theme module**

Replace `src/ui/theme.ts`:
```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";

export interface Theme {
  accent: string;
  dim: string;
  warn: string;
  purple: string;
  good: string;
  bad: string;
  fg: string;
}

export const CYBERPUNK: Theme = {
  accent: "#4cc2ff",
  dim: "#6a7891",
  warn: "#ffcb6b",
  purple: "#c792ea",
  good: "#7ce38b",
  bad: "#f07178",
  fg: "#dbe6f5",
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Read overrides from <themesDir>/<name>.toml; built-in/missing themes yield {}. */
export function loadThemeOverrides(name: string, themesDir: string): Partial<Theme> {
  if (name === "cyberpunk") return {};
  const path = join(themesDir, `${name}.toml`);
  if (!existsSync(path)) return {};
  try {
    const raw = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const out: Partial<Theme> = {};
    for (const key of Object.keys(CYBERPUNK) as Array<keyof Theme>) {
      const v = raw[key];
      if (typeof v === "string" && HEX.test(v)) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function resolveTheme(overrides: Partial<Theme>): Theme {
  return { ...CYBERPUNK, ...overrides };
}

/** Mutable singleton imported by every component; applyTheme swaps values at startup. */
export const theme: Theme = { ...CYBERPUNK };

export function applyTheme(overrides: Partial<Theme>): void {
  Object.assign(theme, resolveTheme(overrides));
}
```

- [ ] **Step 3: Config + CLI wiring**

`src/core/config.ts`: add `theme: string;` to `Config`; add `theme?: { name?: string };` to `RawConfig`; in `sanitize`, copy `raw.theme.name` when it's a string; in `loadConfig`'s return add:
```ts
    theme: p.theme?.name ?? g.theme?.name ?? "cyberpunk",
```

`src/cli.tsx`: in `main()` right after `const config = loadConfig({ cwd });` add:
```ts
  applyTheme(loadThemeOverrides(config.theme, join(homedir(), ".claudeshell", "themes")));
```
with `applyTheme, loadThemeOverrides` imported from `./ui/theme.js`.

- [ ] **Step 4: Verify** — both test files pass, full `npm test`, `npm run typecheck`, `npm run build`.

- [ ] **Step 5: README** — add a "Themes" section documenting `~/.claudeshell/themes/<name>.toml`, the seven keys, and `[theme] name = "..."` (do in/after Task 16 if README exists by then).

- [ ] **Step 6: Commit** — `feat(ui): user themes — cyberpunk default + TOML overrides`
