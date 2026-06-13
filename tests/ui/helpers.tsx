import React from "react";
import { render } from "ink-testing-library";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppContext, type AppCtx } from "../../src/ui/context.js";
import { createAppStore } from "../../src/store.js";
import { SessionManager } from "../../src/core/session-manager.js";
import { loadConfig } from "../../src/core/config.js";
import type { QueryFn } from "../../src/core/types.js";

export const tick = () => new Promise<void>((r) => setImmediate(r));

export const noopQuery: QueryFn = ({ prompt }) => {
  async function* gen() {
    for await (const _ of prompt) return;
  }
  return gen();
};

export function makeCtx(queryFn: QueryFn = noopQuery): AppCtx {
  const dir = mkdtempSync(join(tmpdir(), "cs-ui-"));
  const manager = new SessionManager({ cwd: dir, statePath: join(dir, "state.json"), queryFn });
  manager.create();
  const config = loadConfig({ globalDir: dir, cwd: dir });
  const store = createAppStore(config.layout);
  manager.subscribe(() => store.getState().bump());
  return { manager, config, store };
}

const mounted: Array<{ unmount: () => void }> = [];

export function renderWithCtx(ui: React.ReactElement, ctx: AppCtx = makeCtx()) {
  const result = render(<AppContext.Provider value={ctx}>{ui}</AppContext.Provider>);
  mounted.push(result);
  return { ...result, ctx };
}

export function cleanupInk(): void {
  for (const m of mounted.splice(0)) {
    try {
      m.unmount();
    } catch {
      // already unmounted
    }
  }
}
