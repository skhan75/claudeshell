import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { ActivityIndicator } from "../../src/ui/ActivityIndicator.js";
import { renderWithCtx, makeCtx, cleanupInk } from "./helpers.js";

describe("ActivityIndicator", () => {
  afterEach(cleanupInk);

  it("renders live thinking detail when processing with thinking tokens", () => {
    const ctx = makeCtx();
    const session = ctx.manager.active!;
    session.status = "processing";
    session.turnStartedAt = Date.now();
    session.transcript.thinkingTokens = 512;
    ctx.store.getState().bump();
    const { lastFrame } = renderWithCtx(<ActivityIndicator />, ctx);
    const frame = lastFrame()!;
    expect(frame).toContain("Thinking");
    expect(frame).toContain("tok");
    expect(frame).toContain("esc to interrupt");
  });

  it("renders the elapsed seconds when processing", () => {
    const ctx = makeCtx();
    const session = ctx.manager.active!;
    session.status = "processing";
    session.turnStartedAt = Date.now();
    ctx.store.getState().bump();
    const { lastFrame } = renderWithCtx(<ActivityIndicator />, ctx);
    // "Working…" when no thinking tokens, plus an elapsed seconds segment.
    const frame = lastFrame()!;
    expect(frame).toContain("Working");
    expect(frame).toMatch(/\d+s/);
    expect(frame).toContain("esc to interrupt");
  });

  it("renders nothing for an idle session", () => {
    const ctx = makeCtx();
    // active session is idle by default
    const { lastFrame } = renderWithCtx(<ActivityIndicator />, ctx);
    expect(lastFrame()).toBe("");
  });
});
