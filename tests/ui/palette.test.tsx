import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { CommandPalette, buildPaletteItems } from "../../src/ui/CommandPalette.js";
import { renderWithCtx, makeCtx, tick, cleanupInk } from "./helpers.js";

afterEach(cleanupInk);

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
  it("filters with fuzzy typing and executes on Enter", async () => {
    const ctx = makeCtx();
    ctx.store.getState().setPaletteOpen(true);
    const { stdin, lastFrame } = renderWithCtx(<CommandPalette />, ctx);
    await tick();
    stdin.write("toggle");
    await tick();
    expect(lastFrame()).toContain("action: toggle layout");
    stdin.write("\r");
    await tick();
    expect(ctx.store.getState().layout).toBe("zen");
    expect(ctx.store.getState().paletteOpen).toBe(false);
  });

  it("escape closes without executing", async () => {
    const ctx = makeCtx();
    ctx.store.getState().setPaletteOpen(true);
    const { stdin } = renderWithCtx(<CommandPalette />, ctx);
    await tick();
    stdin.write(""); // esc — real 0x1b byte
    await tick();
    expect(ctx.store.getState().paletteOpen).toBe(false);
  });
});
