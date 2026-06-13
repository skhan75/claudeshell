import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { ModelPicker } from "../../src/ui/ModelPicker.js";
import { renderWithCtx, makeCtx, cleanupInk, tick } from "./helpers.js";

afterEach(cleanupInk);

describe("ModelPicker", () => {
  it("lists the configured models", () => {
    const ctx = makeCtx();
    const frame = renderWithCtx(<ModelPicker onClose={() => {}} />, ctx).lastFrame()!;
    expect(frame).toContain("SELECT MODEL");
    for (const m of ctx.config.models) expect(frame).toContain(m);
  });

  it("switches the active session's model on enter and closes", async () => {
    const ctx = makeCtx();
    let closed = false;
    const { stdin } = renderWithCtx(<ModelPicker onClose={() => { closed = true; }} />, ctx);
    await tick();
    stdin.write("\r"); // select the highlighted (first) model
    await tick();
    expect(closed).toBe(true);
    expect(ctx.manager.active!.transcript.meta.model).toBe(ctx.config.models[0]);
  });
});
