import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "../../src/core/session-manager.js";
import type { QueryFn } from "../../src/core/types.js";

const noopQuery: QueryFn = ({ prompt }) => {
  async function* g() {
    for await (const _ of prompt) return;
  }
  return g();
};
const tmpState = () => join(mkdtempSync(join(tmpdir(), "cs-fork-")), "state.json");

describe("SessionManager.fork", () => {
  it("forks an initialized session: resumes its id, ⑂ title, becomes active, distinct transcript", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const parent = m.create({ resumeSessionId: "claude-abc", title: "jwt work" });
    expect(parent.claudeSessionId).toBe("claude-abc");
    const f = m.fork(parent);
    expect(f).not.toBeNull();
    expect(f!.claudeSessionId).toBe("claude-abc"); // shares upstream context
    expect(f!.title).toBe("⑂ jwt work");
    expect(m.active?.id).toBe(f!.id);
    expect(f!.transcript).not.toBe(parent.transcript);
  });

  it("returns null + pushes no tab when the parent has no resumable context yet", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const parent = m.create(); // never initialized → claudeSessionId undefined
    const before = m.tabs.length;
    expect(m.fork(parent)).toBeNull();
    expect(m.tabs.length).toBe(before);
  });

  it("refuses to fork a busy (in-flight) parent — concurrent-resume hazard", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const parent = m.create({ resumeSessionId: "claude-x" });
    parent.status = "processing";
    expect(m.fork(parent)).toBeNull();
  });

  it("does not stack ⑂ prefixes when re-forking a fork", () => {
    const m = new SessionManager({ cwd: "/tmp", statePath: tmpState(), queryFn: noopQuery });
    const parent = m.create({ resumeSessionId: "claude-y", title: "feature" });
    const f1 = m.fork(parent)!;
    const f2 = m.fork(f1)!;
    expect(f1.title).toBe("⑂ feature");
    expect(f2.title).toBe("⑂ feature"); // not "⑂ ⑂ feature"
  });
});
