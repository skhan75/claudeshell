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

  it("queues overlapping permission requests instead of dropping them", async () => {
    const queryFn: QueryFn = ({ prompt, options }) => {
      async function* gen(): AsyncGenerator<SdkMessage> {
        for await (const _ of prompt) {
          const canUseTool = options.canUseTool as (
            t: string, i: Record<string, unknown>, o: object
          ) => Promise<PermissionResult>;
          const p1 = canUseTool("Bash", { command: "ls" }, {});
          const p2 = canUseTool("Write", { file_path: "/tmp/a" }, {});
          const [r1, r2] = await Promise.all([p1, p2]);
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: `${r1.behavior},${r2.behavior}` }] },
          } as SdkMessage;
          yield { type: "result", subtype: "success" } as SdkMessage;
          return;
        }
      }
      return gen();
    };
    const s = new Session({ id: "s1", cwd: "/tmp", queryFn });
    s.send("go");
    await vi.waitFor(() => expect(s.pendingPermission?.toolName).toBe("Bash"));
    s.pendingPermission!.resolve({ behavior: "allow", updatedInput: {} });
    await vi.waitFor(() => expect(s.pendingPermission?.toolName).toBe("Write"));
    expect(s.status).toBe("awaiting-permission");
    s.pendingPermission!.resolve({ behavior: "deny", message: "no" });
    await vi.waitFor(() => expect(s.status).toBe("idle"));
    expect(s.transcript.blocks.some((b) => b.kind === "assistant" && b.text === "allow,deny")).toBe(true);
  });

  it("auto-denies permission requests arriving after interrupt and stays idle", async () => {
    let canUse:
      | ((t: string, i: Record<string, unknown>, o: object) => Promise<PermissionResult>)
      | undefined;
    const queryFn: QueryFn = ({ prompt, options }) => {
      canUse = options.canUseTool as typeof canUse;
      async function* gen(): AsyncGenerator<SdkMessage> {
        for await (const _ of prompt) {
          await new Promise((r) => setTimeout(r, 200));
          return;
        }
      }
      const g = gen();
      return Object.assign(g, { interrupt: async () => {} });
    };
    const s = new Session({ id: "s1", cwd: "/tmp", queryFn });
    s.send("go");
    await vi.waitFor(() => expect(canUse).toBeDefined());
    await s.interrupt();
    expect(s.status).toBe("idle");
    const result = await canUse!("Bash", { command: "ls" }, {});
    expect(result.behavior).toBe("deny");
    expect(s.status).toBe("idle");
  });

  it("crash while a permission is pending denies it exactly once; late dialog answers are no-ops", async () => {
    const queryFn: QueryFn = ({ prompt, options }) => {
      async function* gen(): AsyncGenerator<SdkMessage> {
        for await (const _ of prompt) {
          const canUseTool = options.canUseTool as (
            t: string, i: Record<string, unknown>, o: object
          ) => Promise<PermissionResult>;
          void canUseTool("Bash", { command: "ls" }, {});
          await new Promise((r) => setTimeout(r, 200));
          throw new Error("boom");
        }
      }
      return gen();
    };
    const s = new Session({ id: "s1", cwd: "/tmp", queryFn });
    s.send("go");
    await vi.waitFor(() => expect(s.pendingPermission).not.toBeNull());
    const dialogRef = s.pendingPermission!;
    await vi.waitFor(() => expect(s.status).toBe("crashed"));
    expect(s.pendingPermission).toBeNull();
    dialogRef.resolve({ behavior: "allow", updatedInput: {} });
    expect(s.status).toBe("crashed");
  });

  it("setModel updates the displayed model immediately", async () => {
    const noopLikeQuery: QueryFn = ({ prompt }) => {
      async function* gen() {
        for await (const _ of prompt) return;
      }
      return gen();
    };
    const s = new Session({ id: "s1", cwd: "/tmp", queryFn: noopLikeQuery });
    await s.setModel("claude-sonnet-4-6");
    expect(s.transcript.meta.model).toBe("claude-sonnet-4-6");
  });

  it("dispose() denies a pending permission", async () => {
    let result: PermissionResult | undefined;
    const queryFn: QueryFn = ({ prompt, options }) => {
      async function* gen(): AsyncGenerator<SdkMessage> {
        for await (const _ of prompt) {
          const canUseTool = options.canUseTool as (
            t: string, i: Record<string, unknown>, o: object
          ) => Promise<PermissionResult>;
          result = await canUseTool("Bash", { command: "ls" }, {});
          return;
        }
      }
      return gen();
    };
    const s = new Session({ id: "s1", cwd: "/tmp", queryFn });
    s.send("go");
    await vi.waitFor(() => expect(s.pendingPermission).not.toBeNull());
    s.dispose();
    await vi.waitFor(() => expect(result?.behavior).toBe("deny"));
  });

  it("setModel before first send reaches the SDK options", async () => {
    const capture: { options?: Record<string, unknown> } = {};
    const s = new Session({
      id: "s1", cwd: "/tmp",
      queryFn: scriptedQuery([{ type: "result", subtype: "success" }], capture),
    });
    await s.setModel("claude-sonnet-4-6");
    s.send("hello");
    await vi.waitFor(() => expect(s.status).toBe("idle"));
    expect(capture.options?.model).toBe("claude-sonnet-4-6");
  });

  it("dispose() calls close() on the handle when one exists (subprocess teardown)", async () => {
    const closeSpy = vi.fn(async () => {});
    const queryFn: QueryFn = ({ prompt }) => {
      async function* gen(): AsyncGenerator<SdkMessage> {
        for await (const _ of prompt) {
          // Yield nothing — hang waiting for more input
          await new Promise(() => {}); // never resolves
        }
      }
      const g = gen();
      return Object.assign(g, {
        interrupt: vi.fn(async () => {}),
        setPermissionMode: vi.fn(async () => {}),
        close: closeSpy,
      });
    };
    const s = new Session({ id: "s1", cwd: "/tmp", queryFn });
    s.send("go");
    // Wait for pump to start and handle to be set
    await vi.waitFor(() => expect(s.status).toBe("processing"));
    s.dispose();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it("dispose() does not throw when handle has no close method (optional-chaining path)", async () => {
    const queryFn: QueryFn = ({ prompt }) => {
      async function* gen(): AsyncGenerator<SdkMessage> {
        for await (const _ of prompt) {
          await new Promise(() => {}); // hang
        }
      }
      // No close property — only interrupt to satisfy existing session logic
      return Object.assign(gen(), { interrupt: vi.fn(async () => {}) });
    };
    const s = new Session({ id: "s1", cwd: "/tmp", queryFn });
    s.send("go");
    await vi.waitFor(() => expect(s.status).toBe("processing"));
    expect(() => s.dispose()).not.toThrow();
  });

  it("dispose() does not throw when no query was ever started (handle is null)", () => {
    const s = new Session({ id: "s1", cwd: "/tmp", queryFn: scriptedQuery([]) });
    // Never called send(), so handle is null
    expect(() => s.dispose()).not.toThrow();
  });

  it("turnStartedAt is a number after send() and null after a result message arrives", async () => {
    const s = new Session({
      id: "s1", cwd: "/tmp",
      queryFn: scriptedQuery([
        { type: "result", subtype: "success", total_cost_usd: 0, num_turns: 1 },
      ]),
    });
    s.send("hello");
    expect(typeof s.turnStartedAt).toBe("number");
    await vi.waitFor(() => expect(s.status).toBe("idle"));
    expect(s.turnStartedAt).toBeNull();
  });
});
