import { describe, it, expect } from "vitest";
import { routeSlash, DEFAULT_SLASH_COMMANDS, effectiveSlashCommands } from "../../src/core/slash-commands.js";

describe("routeSlash — the single slash routing source of truth", () => {
  it("routes overlay commands to their overlay", () => {
    expect(routeSlash("/model")).toEqual({ kind: "overlay", overlay: "models" });
    expect(routeSlash("/models")).toEqual({ kind: "overlay", overlay: "models" });
    expect(routeSlash("/help")).toEqual({ kind: "overlay", overlay: "help" });
    expect(routeSlash("/fleet")).toEqual({ kind: "overlay", overlay: "fleet" });
    expect(routeSlash("/budget")).toEqual({ kind: "overlay", overlay: "budget" });
    expect(routeSlash("/review")).toEqual({ kind: "overlay", overlay: "review" });
  });

  it("routes /clear and /compact (with optional focus arg)", () => {
    expect(routeSlash("/clear")).toEqual({ kind: "reset" });
    expect(routeSlash("/compact")).toEqual({ kind: "compact", focus: "" });
    expect(routeSlash("/compact the auth refactor")).toEqual({ kind: "compact", focus: "the auth refactor" });
  });

  it("routes /parallel: bare → fleet overlay, with a task → parallel action", () => {
    expect(routeSlash("/parallel")).toEqual({ kind: "overlay", overlay: "fleet" });
    expect(routeSlash("/parallel write docs for src")).toEqual({ kind: "parallel", task: "write docs for src" });
  });

  it("routes /swarm: bare → null (needs a task), with a task → swarm action", () => {
    expect(routeSlash("/swarm")).toBeNull();
    expect(routeSlash("/swarm refactor the parser")).toEqual({ kind: "swarm", task: "refactor the parser" });
  });

  it("routes /fork", () => {
    expect(routeSlash("/fork")).toEqual({ kind: "fork" });
  });

  it("sends unknown slash commands (SDK skills/plugins) and plain text", () => {
    expect(routeSlash("/superpowers:brainstorm")).toEqual({ kind: "send", text: "/superpowers:brainstorm" });
    expect(routeSlash("hello there")).toEqual({ kind: "send", text: "hello there" });
  });

  it("trims whitespace and treats empty input as null", () => {
    expect(routeSlash("")).toBeNull();
    expect(routeSlash("   ")).toBeNull();
    expect(routeSlash("  /clear  ")).toEqual({ kind: "reset" });
    expect(routeSlash("/compact   spacey   focus")).toEqual({ kind: "compact", focus: "spacey   focus" });
  });

  it("no built-in DEFAULT command leaks to the SDK as a dead `send` (null no-op is ok for arg commands)", () => {
    for (const cmd of DEFAULT_SLASH_COMMANDS) {
      // A built-in is either app-handled (an action) or a deliberate no-op (null, e.g. bare
      // /swarm needs a task) — it must NEVER be sent verbatim to the SDK as a dead command.
      expect(routeSlash(cmd)?.kind, cmd).not.toBe("send");
    }
  });

  it("SDK-reported skill commands merged in still route to send (parity guarantee)", () => {
    const cmds = effectiveSlashCommands(["/superpowers:foo", "custom"]);
    expect(cmds).toContain("/custom");
    expect(routeSlash("/superpowers:foo")).toEqual({ kind: "send", text: "/superpowers:foo" });
    expect(routeSlash("/custom")).toEqual({ kind: "send", text: "/custom" });
  });
});
