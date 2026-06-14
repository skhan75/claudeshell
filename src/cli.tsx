#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { App } from "./ui/App.js";
import { AppContext } from "./ui/context.js";
import { createAppStore } from "./store.js";
import { SessionManager } from "./core/session-manager.js";
import { SystemMonitor } from "./core/system-monitor.js";
import { loadConfig } from "./core/config.js";
import { statePathFor } from "./core/persistence.js";
import { applyTheme, loadThemeOverrides } from "./ui/theme.js";
import { homedir } from "node:os";
import { join } from "node:path";

const pExecFile = promisify(execFile);

// Run as a full-screen "modal" app on its own alternate screen buffer (like
// vim/less/htop): take over the screen on launch, and on quit tear it down so
// the user is dropped back at a pristine prompt with zero claudeshell residue.
const useAltScreen = process.stdout.isTTY === true;
let altActive = false;
function enterAltScreen(): void {
  if (useAltScreen && !altActive) {
    altActive = true;
    process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H"); // enter alt buffer, clear, home
  }
}
function leaveAltScreen(): void {
  // Always disable mouse reporting on the way out so a hard exit can never leave the
  // terminal capturing the mouse (which would break native text selection at the shell).
  if (useAltScreen) process.stdout.write("\x1b[?1000l\x1b[?1006l");
  if (useAltScreen && altActive) {
    altActive = false;
    process.stdout.write("\x1b[?1049l\x1b[?25h"); // restore primary buffer + cursor
  }
}
// Last-resort safety net so a hard exit can never strand the user in the alt buffer.
process.on("exit", leaveAltScreen);

async function preflight(): Promise<string | null> {
  try {
    await pExecFile("claude", ["--version"], { timeout: 3000, shell: process.platform === "win32" });
    return null;
  } catch {
    return [
      "warning: could not run `claude --version` — is Claude Code installed and on PATH?",
      "claudeshell runs on the bundled Agent SDK, but Claude Code is recommended for auth:",
      "  npm install -g @anthropic-ai/claude-code && claude  (then /login)",
    ].join("\n");
  }
}

async function main() {
  const warning = await preflight();
  if (warning) console.error(warning);

  const cwd = process.cwd();
  const config = loadConfig({ cwd });
  applyTheme(loadThemeOverrides(config.theme, join(homedir(), ".claudeshell", "themes")));
  const manager = new SessionManager({
    cwd,
    statePath: statePathFor(cwd),
    budget: config.budget,
  });
  manager.restoreState();

  const store = createAppStore(config.layout, config.mouseScroll);

  const monitor = new SystemMonitor(cwd);
  monitor.start(5000, (stats) => store.getState().setHostStats(stats));

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      manager.saveState();
    } catch {
      // never block exit on persistence
    }
    monitor.stop();
    manager.dispose();
    leaveAltScreen();
  };
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  // Switch to the alternate screen just before taking over the terminal. Any
  // preflight warning above was written to the primary buffer and is restored
  // (above the shell prompt) once we leave the alt screen on exit.
  enterAltScreen();

  const instance = render(
    <AppContext.Provider value={{ manager, config, store }}>
      <App />
    </AppContext.Provider>,
    // exitOnCtrlC:false so Ctrl+C reaches our handlers — a terminal tab can send
    // \x03 to its program; Claude tabs quit via the explicit Ctrl+C handler in App.
    { exitOnCtrlC: false }
  );

  await instance.waitUntilExit();
  cleanup();
}

main().catch((err) => {
  leaveAltScreen(); // restore the primary buffer before surfacing a crash
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
