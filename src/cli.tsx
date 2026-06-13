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
  });
  manager.restoreState();

  const store = createAppStore(config.layout);

  const monitor = new SystemMonitor(cwd);
  monitor.start(5000, (stats) => store.getState().setHostStats(stats));

  const cleanup = () => {
    try {
      manager.saveState();
    } catch {
      // never block exit on persistence
    }
    monitor.stop();
    manager.dispose();
  };
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  const instance = render(
    <AppContext.Provider value={{ manager, config, store }}>
      <App />
    </AppContext.Provider>
  );

  await instance.waitUntilExit(); // Ctrl+C unmounts Ink (default exitOnCtrlC)
  cleanup();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
