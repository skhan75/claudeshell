#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import { App } from "./ui/App.js";
import { AppContext } from "./ui/context.js";
import { createAppStore } from "./store.js";
import { SessionManager } from "./core/session-manager.js";
import { SystemMonitor } from "./core/system-monitor.js";
import { loadConfig } from "./core/config.js";

const pExecFile = promisify(execFile);

async function preflight(): Promise<string | null> {
  try {
    await pExecFile("claude", ["--version"]);
    return null;
  } catch {
    return [
      "warning: `claude` CLI not found on PATH.",
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
  const manager = new SessionManager({
    cwd,
    statePath: join(homedir(), ".claudeshell", "state.json"),
  });
  manager.restoreState();

  const store = createAppStore(config.layout);
  manager.subscribe(() => store.getState().bump());

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

  const instance = render(
    <AppContext.Provider value={{ manager, config, store }}>
      <App />
    </AppContext.Provider>
  );

  await instance.waitUntilExit(); // Ctrl+C unmounts Ink (default exitOnCtrlC)
  cleanup();
}

void main();
