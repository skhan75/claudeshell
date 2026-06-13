import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { ChatPane, wrapText, chromeRows } from "../../src/ui/ChatPane.js";
import { renderWithCtx, makeCtx, cleanupInk, tick } from "./helpers.js";

afterEach(cleanupInk);

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

  it("shows only the latest window of a long transcript and scrolls with g/G", async () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    for (let i = 0; i < 30; i++) s.transcript.addInfo(`line-${i}`);
    ctx.store.getState().bump();
    ctx.store.getState().setFocus("scroll");
    const { lastFrame, stdin } = renderWithCtx(<ChatPane height={5} />, ctx);
    expect(lastFrame()).toContain("line-29");
    expect(lastFrame()).not.toContain("line-0 ");
    await tick();
    stdin.write("g"); // jump to top
    await tick();
    expect(lastFrame()).toContain("line-0");
    await tick();
    stdin.write("G"); // back to bottom
    await tick();
    expect(lastFrame()).toContain("line-29");
  });

  it("searches with / and jumps with n", async () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    for (let i = 0; i < 20; i++) s.transcript.addInfo(i === 3 ? "needle here" : `filler-${i}`);
    ctx.store.getState().bump();
    ctx.store.getState().setFocus("scroll");
    const { lastFrame, stdin } = renderWithCtx(<ChatPane height={5} />, ctx);
    await tick();
    stdin.write("/");
    await tick();
    stdin.write("needle");
    await tick();
    stdin.write("\r"); // confirm search
    await tick();
    stdin.write("n");  // jump to match
    await tick();
    expect(lastFrame()).toContain("needle here");
  });

  it("wrapText never hangs on non-positive width", () => {
    expect(wrapText("hello", 0)).toEqual(["h", "e", "l", "l", "o"]);
  });

  // FIX 1 pinning: chromeRows helper returns layout-aware values.
  it("chromeRows returns 9 for zen and 8 for sidebar", () => {
    expect(chromeRows("zen")).toBe(9);
    expect(chromeRows("sidebar")).toBe(8);
  });

  // FIX 2 pinning: n/N cycles through ALL matches, not stuck on one.
  it("n/N cycles through all search matches", async () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    // Build a transcript with 'needle' at lines 5, 20, 35 among fillers (height=5 viewport).
    // Use enough fillers so each needle is in a distinct scroll window.
    for (let i = 0; i < 40; i++) {
      s.transcript.addInfo(i === 5 || i === 20 || i === 35 ? `needle-${i}` : `filler-${i}`);
    }
    ctx.store.getState().bump();
    ctx.store.getState().setFocus("scroll");
    const { lastFrame, stdin } = renderWithCtx(<ChatPane height={5} />, ctx);

    // Open search, type 'needle', confirm.
    await tick();
    stdin.write("/");
    await tick();
    stdin.write("needle");
    await tick();
    stdin.write("\r");
    await tick();

    // First n: should jump to one needle match.
    stdin.write("n");
    await tick();
    const after1 = lastFrame()!;

    // Second n: must show a DIFFERENT needle (different line number).
    stdin.write("n");
    await tick();
    const after2 = lastFrame()!;

    // Third n: yet another needle.
    stdin.write("n");
    await tick();
    const after3 = lastFrame()!;

    // Each frame must contain 'needle', and the three frames must not all be equal
    // (which would indicate it was stuck on the same match).
    expect(after1).toContain("needle");
    expect(after2).toContain("needle");
    expect(after3).toContain("needle");
    // The three visible frames must not all be identical — at least one differs.
    const allSame = after1 === after2 && after2 === after3;
    expect(allSame).toBe(false);
  });

  it("esc cancels search and clears the highlight footer", async () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    s.transcript.addInfo("needle here");
    ctx.store.getState().bump();
    ctx.store.getState().setFocus("scroll");
    const { lastFrame, stdin } = renderWithCtx(<ChatPane height={5} />, ctx);
    await tick();
    stdin.write("/");
    await tick();
    stdin.write("needle");
    await tick();
    expect(lastFrame()).toContain("/needle");
    stdin.write("\x1b"); // esc — real byte
    await tick();
    expect(lastFrame()).not.toContain("/needle");
  });

  it("ignores scroll keys while the palette is open", async () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    for (let i = 0; i < 30; i++) s.transcript.addInfo(`line-${i}`);
    ctx.store.getState().bump();
    ctx.store.getState().setFocus("scroll");
    ctx.store.getState().setPaletteOpen(true);
    const { lastFrame, stdin } = renderWithCtx(<ChatPane height={5} />, ctx);
    await tick();
    stdin.write("g"); // would jump to top if active
    await tick();
    expect(lastFrame()).toContain("line-29"); // still at bottom
  });
});
