import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { BudgetOverlay } from "../../src/ui/BudgetOverlay.js";
import type { Session } from "../../src/core/session.js";
import { makeCtx, renderWithCtx, cleanupInk, tick } from "./helpers.js";

afterEach(cleanupInk);

describe("BudgetOverlay", () => {
  it("shows total spend, 'none' for unset caps, and a per-agent line", () => {
    const ctx = makeCtx();
    (ctx.manager.tabs[0] as Session).transcript.usage.costUsd = 0.5;
    const frame = renderWithCtx(<BudgetOverlay onClose={() => {}} />, ctx).lastFrame()!;
    expect(frame).toContain("BUDGET");
    expect(frame).toContain("$0.50");
    expect(frame).toContain("none"); // both caps unset
  });

  it("s → 5 → Enter sets the soft cap", async () => {
    const ctx = makeCtx();
    const setSpy = vi.spyOn(ctx.manager, "setBudget");
    const { stdin } = renderWithCtx(<BudgetOverlay onClose={() => {}} />, ctx);
    await tick();
    stdin.write("s");
    await tick();
    stdin.write("5");
    await tick();
    stdin.write("\r");
    await tick();
    expect(setSpy).toHaveBeenCalledWith({ softUsd: 5 });
    expect(ctx.manager.budget.softUsd).toBe(5);
  });

  it("editing one cap preserves the other (s with a pre-existing hard cap)", async () => {
    const ctx = makeCtx();
    ctx.manager.setBudget({ hardUsd: 10 });
    const { stdin } = renderWithCtx(<BudgetOverlay onClose={() => {}} />, ctx);
    await tick();
    stdin.write("s");
    await tick();
    stdin.write("5");
    await tick();
    stdin.write("\r");
    await tick();
    expect(ctx.manager.budget).toEqual({ softUsd: 5, hardUsd: 10 });
  });

  it("h sets the hard cap while preserving an existing soft cap", async () => {
    const ctx = makeCtx();
    ctx.manager.setBudget({ softUsd: 2 });
    const { stdin } = renderWithCtx(<BudgetOverlay onClose={() => {}} />, ctx);
    await tick();
    stdin.write("h");
    await tick();
    stdin.write("9");
    await tick();
    stdin.write("\r");
    await tick();
    expect(ctx.manager.budget).toEqual({ softUsd: 2, hardUsd: 9 });
  });

  it("c clears caps; esc closes", async () => {
    const ctx = makeCtx();
    ctx.manager.setBudget({ hardUsd: 10 });
    const onClose = vi.fn();
    const { stdin } = renderWithCtx(<BudgetOverlay onClose={onClose} />, ctx);
    await tick();
    stdin.write("c");
    await tick();
    expect(ctx.manager.budget).toEqual({});
    stdin.write("\x1b"); // esc
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
