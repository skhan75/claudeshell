import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { HelpOverlay } from "../../src/ui/HelpOverlay.js";
import { renderWithCtx, makeCtx, tick, cleanupInk } from "./helpers.js";

afterEach(cleanupInk);

describe("HelpOverlay", () => {
  it("renders the title and core onboarding facts", () => {
    const { lastFrame } = renderWithCtx(<HelpOverlay onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain("HELP · KEYBINDINGS");
    // The first (default-highlighted) item is "Quit claudeshell"; its preview
    // text mentions Ctrl+Q and quitting + auto-save guidance.
    expect(frame).toContain("Ctrl+Q");
    expect(frame).toContain("quit");
    // Configurable bindings surface as labels in the results list.
    expect(frame).toContain("Command palette");
    expect(frame).toContain("Saved sessions");
  });

  it("lists buffer switching and permission modes", () => {
    const { lastFrame } = renderWithCtx(<HelpOverlay onClose={() => {}} />);
    const frame = lastFrame()!;
    // The new Global entries surface as labels in the results list.
    expect(frame).toContain("Switch buffer");
    expect(frame).toContain("Permission modes");
    expect(frame).toContain("New terminal");
  });

  it("preview explains Ctrl+B buffer switching", async () => {
    const { stdin, lastFrame } = renderWithCtx(<HelpOverlay onClose={() => {}} />);
    await tick();
    stdin.write("Switch buffer");
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain("Ctrl+B");
    expect(frame).toContain("buffer");
  });

  it("preview explains the permission modes", async () => {
    const { stdin, lastFrame } = renderWithCtx(<HelpOverlay onClose={() => {}} />);
    await tick();
    stdin.write("Permission modes");
    await tick();
    const frame = lastFrame()!;
    // The preview spells out the four modes.
    expect(frame).toContain("plan");
    expect(frame).toContain("acceptEdits");
    expect(frame).toContain("bypassPermissions");
  });

  it("preview mentions Ctrl+K and Ctrl+R via fuzzy navigation", async () => {
    const { stdin, lastFrame } = renderWithCtx(<HelpOverlay onClose={() => {}} />);
    await tick();
    // Filter to the command palette entry and confirm its Ctrl+K chord shows.
    stdin.write("Command palette");
    await tick();
    expect(lastFrame()).toContain("Ctrl+K");
    // Now to the saved sessions entry → Ctrl+R chord.
    for (let i = 0; i < "Command palette".length; i++) {
      stdin.write(String.fromCharCode(0x7f)); // backspace
    }
    await tick();
    stdin.write("Saved sessions");
    await tick();
    expect(lastFrame()).toContain("Ctrl+R");
  });

  it("arrow-down moves the highlighted selection", async () => {
    const { stdin, lastFrame } = renderWithCtx(<HelpOverlay onClose={() => {}} />);
    await tick();
    // Default highlight is the first item "Quit claudeshell".
    expect(lastFrame()).toContain("› Quit claudeshell");
    stdin.write("\x1b[B"); // down arrow
    await tick();
    // Selection moved off the first item.
    expect(lastFrame()).not.toContain("› Quit claudeshell");
  });

  it("Esc calls onClose", async () => {
    let closed = false;
    const { stdin } = renderWithCtx(<HelpOverlay onClose={() => (closed = true)} />);
    await tick();
    stdin.write("\x1b"); // real ESC byte
    await tick();
    expect(closed).toBe(true);
  });

  it("Enter (select) closes, since help is a reference card", async () => {
    let closed = false;
    const { stdin } = renderWithCtx(<HelpOverlay onClose={() => (closed = true)} />);
    await tick();
    stdin.write("\r");
    await tick();
    expect(closed).toBe(true);
  });
});
