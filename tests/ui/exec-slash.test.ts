import { describe, it, expect, afterEach } from "vitest";
import { execSlash } from "../../src/ui/execSlash.js";
import { routeSlash } from "../../src/core/slash-commands.js";
import { makeCtx, cleanupInk } from "./helpers.js";

afterEach(cleanupInk);

describe("execSlash — the single routed-action sink", () => {
  it("/parallel <task> spawns config.fleetSize workers and opens the fleet overlay", () => {
    const ctx = makeCtx();
    const before = ctx.manager.tabs.length;
    const handled = execSlash(routeSlash("/parallel build the thing"), ctx);
    expect(handled).toBe(true);
    const workers = ctx.manager.tabs.filter((t) => t.kind === "claude" && t.title.startsWith("▶"));
    expect(workers).toHaveLength(ctx.config.fleetSize);
    expect(ctx.manager.tabs.length).toBe(before + ctx.config.fleetSize);
    expect(ctx.store.getState().overlay).toBe("fleet");
  });

  it("/swarm <task> spawns a swarm group and opens the dashboard", () => {
    const ctx = makeCtx();
    expect(execSlash(routeSlash("/swarm design the api"), ctx)).toBe(true);
    const swarmTabs = ctx.manager.tabs.filter((t) => t.kind === "claude" && t.group === "swarm");
    expect(swarmTabs).toHaveLength(ctx.config.fleetSize);
    expect(ctx.store.getState().overlay).toBe("fleet");
  });

  it("/fork without a resumable context adds an info hint and creates no tab", () => {
    const ctx = makeCtx();
    const before = ctx.manager.tabs.length;
    expect(execSlash(routeSlash("/fork"), ctx)).toBe(true);
    expect(ctx.manager.tabs.length).toBe(before);
    const s = ctx.manager.active!;
    expect(s.transcript.blocks.some((b) => b.kind === "info" && b.text.includes("fork"))).toBe(true);
  });

  it("bare /parallel and /fleet open the dashboard without spawning", () => {
    const ctx = makeCtx();
    const before = ctx.manager.tabs.length;
    expect(execSlash(routeSlash("/fleet"), ctx)).toBe(true);
    expect(ctx.store.getState().overlay).toBe("fleet");
    expect(ctx.manager.tabs.length).toBe(before);
    ctx.store.getState().setOverlay(null);
    expect(execSlash(routeSlash("/parallel"), ctx)).toBe(true);
    expect(ctx.store.getState().overlay).toBe("fleet");
    expect(ctx.manager.tabs.length).toBe(before);
  });

  it("preserves existing behavior: /model, /clear, /compact still route correctly", () => {
    const ctx = makeCtx();
    expect(execSlash(routeSlash("/model"), ctx)).toBe(true);
    expect(ctx.store.getState().overlay).toBe("models");
    expect(execSlash(routeSlash("/compact the parser"), ctx)).toBe(true);
    expect(ctx.store.getState().compactFocus).toBe("the parser");
    expect(ctx.store.getState().overlay).toBe("compact");
    expect(execSlash(routeSlash("/budget"), ctx)).toBe(true);
    expect(ctx.store.getState().overlay).toBe("budget");
    expect(execSlash(routeSlash("/review"), ctx)).toBe(true);
    expect(ctx.store.getState().overlay).toBe("review");
    // /clear resets the active session (no throw); returns handled
    expect(execSlash(routeSlash("/clear"), ctx)).toBe(true);
  });

  it("returns false for plain text + unknown slash so the caller sends them", () => {
    const ctx = makeCtx();
    expect(execSlash(routeSlash("hello"), ctx)).toBe(false);
    expect(execSlash(routeSlash("/superpowers:foo"), ctx)).toBe(false);
    expect(execSlash(routeSlash(""), ctx)).toBe(false);
  });
});
