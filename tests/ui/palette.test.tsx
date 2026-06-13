import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { CommandPalette, buildPaletteItems } from "../../src/ui/CommandPalette.js";
import { renderWithCtx, makeCtx, tick, cleanupInk } from "./helpers.js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectSlug } from "../../src/core/history-search.js";

afterEach(cleanupInk);

describe("buildPaletteItems", () => {
  it("includes sessions, actions, pills, and slash commands", () => {
    const ctx = makeCtx();
    ctx.manager.active!.transcript.apply({ type: "system", subtype: "init", slash_commands: ["/commit"] });
    const labels = buildPaletteItems(ctx).map((i) => i.label);
    expect(labels).toContain("switch: new session");
    expect(labels).toContain("action: new session");
    expect(labels).toContain("action: new terminal");
    expect(labels).toContain("action: toggle layout");
    expect(labels).toContain("action: search history");
    expect(labels.some((l) => l.startsWith("mode:"))).toBe(true);
    expect(labels).toContain("pill: fix tests");
    expect(labels).toContain("slash: /commit");
  });

  it("includes model-switch entries from config", () => {
    const ctx = makeCtx();
    const labels = buildPaletteItems(ctx).map((i) => i.label);
    expect(labels).toContain("model: claude-opus-4-8");
  });

  it("only advertises alt+digit hints for the first 9 tabs", () => {
    const ctx = makeCtx();
    for (let i = 0; i < 10; i++) ctx.manager.create(); // 11 sessions total (1 from makeCtx)
    const switchItems = buildPaletteItems(ctx).filter((i) => i.label.startsWith("switch:"));
    expect(switchItems).toHaveLength(11);
    expect(switchItems[8].hint).toBe("alt+9");
    expect(switchItems[9].hint).toBeUndefined();
    expect(switchItems[10].hint).toBeUndefined();
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

  it("enter after arrow overshoot runs the highlighted row", async () => {
    const ctx = makeCtx();
    ctx.store.getState().setPaletteOpen(true);
    const { stdin } = renderWithCtx(<CommandPalette />, ctx);
    await tick();
    stdin.write("toggle");
    await tick();
    for (let i = 0; i < 5; i++) {
      stdin.write("[B"); // down arrow
      await tick();
    }
    stdin.write("\r");
    await tick();
    expect(ctx.store.getState().layout).toBe("zen"); // highlighted row still ran
    expect(ctx.store.getState().paletteOpen).toBe(false);
  });

  it("hides resume action unless the session crashed", () => {
    const ctx = makeCtx();
    expect(buildPaletteItems(ctx).map((i) => i.label)).not.toContain("action: resume crashed session");
    ctx.manager.active!.status = "crashed";
    expect(buildPaletteItems(ctx).map((i) => i.label)).toContain("action: resume crashed session");
  });

  it("history mode: searches, re-sends a hit as prompt, esc backs out", async () => {
    const ctx = makeCtx();
    const claudeDir = mkdtempSync(join(tmpdir(), "cs-claude-"));
    const projDir = join(claudeDir, "projects", projectSlug(ctx.manager.active!.cwd));
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, "old.jsonl"),
      JSON.stringify({ type: "user", message: { role: "user", content: "fix the jwt bug" } }) + "\n"
    );
    ctx.store.getState().setPaletteOpen(true);
    const { stdin, lastFrame } = renderWithCtx(<CommandPalette claudeDir={claudeDir} />, ctx);
    await tick();
    stdin.write("search history");
    await tick();
    stdin.write("\r"); // enter history mode
    await tick();
    expect(lastFrame()).toContain("history ❯");
    stdin.write("jwt");
    await new Promise((r) => setTimeout(r, 150)); // debounce
    await tick();
    expect(lastFrame()).toContain("fix the jwt bug");
    stdin.write("\r"); // re-send hit
    await tick();
    expect(ctx.manager.active!.transcript.blocks[0]).toMatchObject({ kind: "user", text: "fix the jwt bug" });
    expect(ctx.store.getState().paletteOpen).toBe(false);
  });

});