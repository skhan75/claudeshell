import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, DEFAULT_PILLS, DEFAULT_KEYS } from "../../src/core/config.js";

let globalDir: string;
let projectDir: string;

beforeEach(() => {
  globalDir = mkdtempSync(join(tmpdir(), "cs-global-"));
  projectDir = mkdtempSync(join(tmpdir(), "cs-proj-"));
});
afterEach(() => {
  rmSync(globalDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when no config files exist", () => {
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.layout).toBe("sidebar");
    expect(cfg.pills).toEqual(DEFAULT_PILLS);
    expect(cfg.keys).toEqual(DEFAULT_KEYS);
  });

  it("global config overrides defaults; project overrides global", () => {
    writeFileSync(
      join(globalDir, "config.toml"),
      `[layout]\ndefault = "zen"\n\n[[pills]]\nlabel = "deploy"\nprompt = "Deploy to staging"\n`
    );
    writeFileSync(
      join(projectDir, ".claudeshell.toml"),
      `[layout]\ndefault = "sidebar"\n\n[[pills]]\nlabel = "deploy"\nprompt = "Deploy with make deploy"\n`
    );
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.layout).toBe("sidebar");
    const deploy = cfg.pills.find((p) => p.label === "deploy");
    expect(deploy?.prompt).toBe("Deploy with make deploy");
  });

  it("merges [keys] over defaults", () => {
    writeFileSync(join(globalDir, "config.toml"), `[keys]\npalette = "ctrl+p"\n`);
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.keys.palette).toBe("ctrl+p");
    expect(cfg.keys.layoutToggle).toBe("ctrl+o");
  });

  it("survives malformed TOML by falling back to defaults for that file", () => {
    writeFileSync(join(globalDir, "config.toml"), `not [valid toml`);
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.layout).toBe("sidebar");
  });
});
