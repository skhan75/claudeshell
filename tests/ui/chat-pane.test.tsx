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
  it("renders the prompt with a ▸ marker and the answer as plain markdown (no banners)", () => {
    const ctx = makeCtx();
    seed(ctx);
    const { lastFrame } = renderWithCtx(<ChatPane height={10} />, ctx);
    const frame = lastFrame()!;
    // Clean & minimal: a "▸" prompt marker, no OPERATOR/CLAUDE/AI Dialogue chrome.
    expect(frame).toContain("▸");
    expect(frame).toContain("refactor the JWT validation");
    expect(frame).toContain("I see the issue");
    expect(frame).not.toContain("OPERATOR");
    expect(frame).not.toContain("CLAUDE");
    expect(frame).not.toContain("AI Dialogue");
  });

  it("renders markdown in assistant answers (bold/heading/list/code), stripping markers", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    s.transcript.apply({
      type: "assistant",
      message: { content: [{ type: "text", text: "## Plan\n\n- **do** it\n\nrun `go test`" }] },
    });
    ctx.store.getState().bump();
    const frame = renderWithCtx(<ChatPane height={14} />, ctx).lastFrame()!;
    expect(frame).toContain("Plan");
    expect(frame).toContain("do");
    expect(frame).toContain("go test");
    // Markdown source markers must not leak into the rendered output.
    expect(frame).not.toContain("##");
    expect(frame).not.toContain("**");
    expect(frame).not.toContain("`go test`");
  });

  it("appends a streaming cursor to a streaming assistant answer", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    s.transcript.apply({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Working on it" } },
    });
    ctx.store.getState().bump();
    const frame = renderWithCtx(<ChatPane height={10} />, ctx).lastFrame()!;
    expect(frame).toContain("Working on it");
    expect(frame).toContain("▋");
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

  it("renders a streaming thinking block with the ✻ live-reasoning marker", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    // A thinking_delta stream_event opens a streaming thinking block.
    s.transcript.apply({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "weighing the issuer check" } },
    });
    ctx.store.getState().bump();
    const { lastFrame } = renderWithCtx(<ChatPane height={10} />, ctx);
    const frame = lastFrame()!;
    expect(frame).toContain("✻");
    expect(frame).toContain("weighing the issuer check");
  });

  it("finalizes thinking visually when the answer text follows", () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    // Stream a thinking delta, then a text delta — thinking finalizes and the
    // assistant answer turn begins, so both the ✻ thinking line and the CLAUDE
    // header are present.
    s.transcript.apply({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "checking the issuer" } },
    });
    s.transcript.apply({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Here is the fix." } },
    });
    ctx.store.getState().bump();
    const { lastFrame } = renderWithCtx(<ChatPane height={10} />, ctx);
    const frame = lastFrame()!;
    expect(frame).toContain("✻");
    expect(frame).toContain("checking the issuer");
    expect(frame).toContain("Here is the fix.");
  });
});

describe("ChatPane — scrolling", () => {
  // The headline fix: PgUp/PgDn scroll the transcript WITHOUT a mode switch, so you
  // can flick through the backlog while still in the (default) input focus.
  it("PgUp/PgDn scroll a long transcript from the default input focus", async () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    for (let i = 0; i < 30; i++) s.transcript.addInfo(`line-${i}`);
    ctx.store.getState().bump();
    // focus is "input" by default — no setFocus("scroll") here.
    const { lastFrame, stdin } = renderWithCtx(<ChatPane height={5} />, ctx);
    expect(lastFrame()).toContain("line-29"); // starts pinned to the bottom
    await tick();
    stdin.write("\x1b[5~"); // PgUp — real CSI sequence
    await tick();
    expect(lastFrame()).toContain("line-21"); // page (height-1=4) scrolled up
    expect(lastFrame()).not.toContain("line-29");
    stdin.write("\x1b[6~"); // PgDn back to the latest
    await tick();
    expect(lastFrame()).toContain("line-29");
  });

  it("draws a right-edge scrollbar only when the transcript overflows", async () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    for (let i = 0; i < 30; i++) s.transcript.addInfo(`line-${i}`);
    ctx.store.getState().bump();
    const { lastFrame } = renderWithCtx(<ChatPane height={5} />, ctx);
    // Overflow → the scrollbar thumb (█) and track (│) are present.
    expect(lastFrame()).toContain("█");

    const ctx2 = makeCtx();
    ctx2.manager.active!.transcript.addInfo("only one line");
    ctx2.store.getState().bump();
    const { lastFrame: short } = renderWithCtx(<ChatPane height={20} />, ctx2);
    expect(short()).not.toContain("█"); // fits → no scrollbar
  });

  it("shows a 'more below' status line once you've scrolled up", async () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    for (let i = 0; i < 30; i++) s.transcript.addInfo(`line-${i}`);
    ctx.store.getState().bump();
    const { lastFrame, stdin } = renderWithCtx(<ChatPane height={5} />, ctx);
    await tick();
    expect(lastFrame()).not.toMatch(/more line/); // at bottom → no status line
    stdin.write("\x1b[5~"); // PgUp
    await tick();
    expect(lastFrame()).toMatch(/more line.*below/);
  });

  it("arrow keys scroll line-by-line in scroll mode", async () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    for (let i = 0; i < 30; i++) s.transcript.addInfo(`line-${i}`);
    ctx.store.getState().bump();
    ctx.store.getState().setFocus("scroll");
    const { lastFrame, stdin } = renderWithCtx(<ChatPane height={5} />, ctx);
    await tick();
    stdin.write("\x1b[A"); // up arrow → one line up
    await tick();
    stdin.write("\x1b[A");
    await tick();
    stdin.write("\x1b[A");
    await tick();
    expect(lastFrame()).toContain("line-22"); // scrolled up three lines
    expect(lastFrame()).not.toContain("line-29");
  });

  it("snaps back to the latest when a new prompt is sent while scrolled up", async () => {
    const ctx = makeCtx();
    const s = ctx.manager.active!;
    for (let i = 0; i < 30; i++) s.transcript.addInfo(`line-${i}`);
    ctx.store.getState().bump();
    ctx.store.getState().setFocus("scroll");
    const { lastFrame, stdin } = renderWithCtx(<ChatPane height={5} />, ctx);
    await tick();
    stdin.write("g"); // jump to the very top
    await tick();
    expect(lastFrame()).toContain("line-0");
    // A new user prompt arrives — the view should snap to the bottom to show it.
    s.transcript.addUser("show me the latest");
    ctx.store.getState().bump();
    await tick();
    expect(lastFrame()).toContain("show me the latest");
    expect(lastFrame()).not.toContain("line-0");
  });
});
