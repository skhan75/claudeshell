import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { ChatPane } from "../../src/ui/ChatPane.js";
import { renderWithCtx, makeCtx, cleanupInk } from "./helpers.js";

afterEach(cleanupInk);

const tick = () => new Promise<void>((r) => setImmediate(r));

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
});
