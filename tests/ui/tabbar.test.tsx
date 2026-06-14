import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { TabBar, computeTabWindow } from "../../src/ui/TabBar.js";
import { renderWithCtx, makeCtx, cleanupInk } from "./helpers.js";

afterEach(cleanupInk);

describe("computeTabWindow", () => {
  // FIX 3 pinning: windowed tab computation always includes the active tab.
  it("always includes the active tab even in narrow space", () => {
    const tabs = Array.from({ length: 12 }, (_, i) => ({ label: ` ${i + 1}:session-${i + 1} ` }));
    const { start, end } = computeTabWindow(tabs, 11, 30);
    expect(end - 1).toBeGreaterThanOrEqual(11); // active tab index 11 is in [start, end)
    expect(start).toBeLessThanOrEqual(11);
  });

  it("shows all tabs when they fit", () => {
    const tabs = [
      { label: " 1:a " },
      { label: " 2:b " },
      { label: " 3:c " },
    ];
    const { start, end, hiddenLeft, hiddenRight } = computeTabWindow(tabs, 1, 200);
    expect(start).toBe(0);
    expect(end).toBe(3);
    expect(hiddenLeft).toBe(0);
    expect(hiddenRight).toBe(0);
  });

  it("reports hiddenLeft and hiddenRight when tabs are clipped", () => {
    // Each label is about 12 chars. 12 tabs = 144 chars, only 40 available.
    const tabs = Array.from({ length: 12 }, (_, i) => ({ label: ` ${i + 1}:session ` }));
    const result = computeTabWindow(tabs, 6, 40);
    // Active tab index 6 must be in the window.
    expect(result.start).toBeLessThanOrEqual(6);
    expect(result.end).toBeGreaterThan(6);
    // Some tabs must be hidden on the left since activeIndex is 6.
    expect(result.hiddenLeft + result.hiddenRight).toBeGreaterThan(0);
  });
});

describe("TabBar", () => {
  // FIX 3 pinning: with many sessions the rendered output must be one line only.
  it("renders as a single line (no newline) with 12 sessions", () => {
    const ctx = makeCtx();
    // Create 11 more sessions (makeCtx already creates 1).
    for (let i = 0; i < 11; i++) ctx.manager.create();
    ctx.store.getState().bump();
    const { lastFrame } = renderWithCtx(<TabBar />, ctx);
    const frame = lastFrame()!;
    // Must contain the active tab's label.
    const activeIdx = ctx.manager.activeIndex;
    expect(frame).toContain(`${activeIdx + 1}:`);
    // Must not contain a newline (single line).
    expect(frame).not.toContain("\n");
  });

  it("shows the brand prefix", () => {
    const ctx = makeCtx();
    const { lastFrame } = renderWithCtx(<TabBar />, ctx);
    expect(lastFrame()).toContain("OPENSHELL");
  });
});
