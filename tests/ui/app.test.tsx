import { describe, it, expect } from "vitest";
import React from "react";
import { App } from "../../src/ui/App.js";
import { renderWithCtx, makeCtx } from "./helpers.js";

const tick = () => new Promise<void>((r) => setImmediate(r));

describe("App shell", () => {
  it("renders tab bar with the active session", () => {
    const { lastFrame } = renderWithCtx(<App />);
    expect(lastFrame()).toContain("CLAUDESHELL");
    expect(lastFrame()).toContain("1:new session");
  });

  it("toggles layout with ctrl+o", async () => {
    const ctx = makeCtx();
    const { stdin } = renderWithCtx(<App />, ctx);
    expect(ctx.store.getState().layout).toBe("sidebar");
    await tick();
    stdin.write(""); // ctrl+o
    expect(ctx.store.getState().layout).toBe("zen");
  });

  it("creates a new tab with alt+t and switches with alt+1", async () => {
    const ctx = makeCtx();
    const { stdin, lastFrame } = renderWithCtx(<App />, ctx);
    await tick();
    stdin.write("t"); // alt+t
    expect(ctx.manager.sessions).toHaveLength(2);
    expect(lastFrame()).toContain("2:");
    stdin.write("1"); // alt+1
    expect(ctx.manager.activeIndex).toBe(0);
  });

  it("opens the palette with ctrl+k", async () => {
    const ctx = makeCtx();
    const { stdin } = renderWithCtx(<App />, ctx);
    await tick();
    stdin.write(""); // ctrl+k
    expect(ctx.store.getState().paletteOpen).toBe(true);
  });
});
