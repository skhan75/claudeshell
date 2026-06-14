import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { FleetOverlay } from "../../src/ui/FleetOverlay.js";
import type { Session } from "../../src/core/session.js";
import { makeCtx, renderWithCtx, cleanupInk, tick } from "./helpers.js";

afterEach(cleanupInk);

function ctxWithWorkers() {
  const ctx = makeCtx(); // creates one "main" claude tab
  ctx.manager.spawnWorkers("build docs", 2, {});
  return ctx;
}

describe("FleetOverlay", () => {
  it("lists every agent with its title and the FLEET header", () => {
    const ctx = ctxWithWorkers();
    const frame = renderWithCtx(<FleetOverlay onClose={() => {}} />, ctx).lastFrame()!;
    expect(frame).toContain("FLEET");
    expect(frame).toContain("worker 1/2");
    expect(frame).toContain("worker 2/2");
  });

  it("x interrupts the selected agent and STAYS open; esc closes", async () => {
    const ctx = ctxWithWorkers();
    const target = ctx.manager.tabs[0] as Session; // row 0, selected by default
    const interruptSpy = vi.spyOn(target, "interrupt").mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { stdin } = renderWithCtx(<FleetOverlay onClose={onClose} />, ctx);
    await tick();
    stdin.write("x");
    await tick();
    expect(interruptSpy).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    stdin.write("\x1b"); // esc
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("enter focuses the selected agent (by original tab index) and closes", async () => {
    const ctx = ctxWithWorkers();
    const activateSpy = vi.spyOn(ctx.manager, "activate");
    const onClose = vi.fn();
    const { stdin } = renderWithCtx(<FleetOverlay onClose={onClose} />, ctx);
    await tick();
    stdin.write("j"); // move to row 1 (the first worker, tab index 1)
    await tick();
    stdin.write("\r"); // enter
    await tick();
    expect(activateSpy).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
