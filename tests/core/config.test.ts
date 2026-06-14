import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, DEFAULT_PILLS, DEFAULT_KEYS, DEFAULT_MODELS } from "../../src/core/config.js";

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
    expect(cfg.fleetSize).toBe(3);
    expect(cfg.fleetPermissionMode).toBe("default");
    expect(cfg.budget).toEqual({});
  });

  it("reads an allowlisted [fleet] permissionMode and rejects unknown values", () => {
    writeFileSync(join(projectDir, ".claudeshell.toml"), `[fleet]\npermissionMode = "acceptEdits"\n`);
    expect(loadConfig({ globalDir, cwd: projectDir }).fleetPermissionMode).toBe("acceptEdits");
    writeFileSync(join(projectDir, ".claudeshell.toml"), `[fleet]\npermissionMode = "yolo"\n`);
    expect(loadConfig({ globalDir, cwd: projectDir }).fleetPermissionMode).toBe("default");
  });

  it("reads [fleet] size and [budget] caps, clamping/sanitizing bad values", () => {
    writeFileSync(
      join(projectDir, ".claudeshell.toml"),
      `[fleet]\nsize = 5\n\n[budget]\nsoftUsd = 2.5\nhardUsd = 10\n`
    );
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.fleetSize).toBe(5);
    expect(cfg.budget).toEqual({ softUsd: 2.5, hardUsd: 10 });
  });

  it("rejects non-positive / non-finite fleet size and budget caps", () => {
    writeFileSync(
      join(projectDir, ".claudeshell.toml"),
      `[fleet]\nsize = -2\n\n[budget]\nsoftUsd = 0\nhardUsd = -5\n`
    );
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.fleetSize).toBe(3); // fell back to default
    expect(cfg.budget).toEqual({}); // both caps rejected
  });

  it("project budget overrides global budget per-cap", () => {
    writeFileSync(join(globalDir, "config.toml"), `[budget]\nsoftUsd = 1\nhardUsd = 5\n`);
    writeFileSync(join(projectDir, ".claudeshell.toml"), `[budget]\nhardUsd = 20\n`);
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.budget).toEqual({ softUsd: 1, hardUsd: 20 });
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

  it("ignores structurally invalid pills and keys", () => {
    writeFileSync(
      join(globalDir, "config.toml"),
      `pills = "oops"\n\n[keys]\npalette = 42\n`
    );
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.pills).toEqual(DEFAULT_PILLS);
    expect(cfg.keys.palette).toBe("ctrl+k");
  });

  it("drops pills missing a string label", () => {
    writeFileSync(
      join(globalDir, "config.toml"),
      `[[pills]]\nprompt = "no label"\n\n[[pills]]\nlabel = "ok"\nprompt = "fine"\n`
    );
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.pills.some((p) => p.label === undefined)).toBe(false);
    expect(cfg.pills.find((p) => p.label === "ok")?.prompt).toBe("fine");
  });

  it("ignores non-object layout values", () => {
    writeFileSync(join(globalDir, "config.toml"), `layout = "zen"\n`);
    expect(loadConfig({ globalDir, cwd: projectDir }).layout).toBe("sidebar");
  });

  it("exposes a default model list, overridable in TOML", () => {
    const cfg = loadConfig({ globalDir, cwd: projectDir });
    expect(cfg.models).toContain("claude-opus-4-8");
    writeFileSync(join(globalDir, "config.toml"), `models = ["my-model"]\n`);
    expect(loadConfig({ globalDir, cwd: projectDir }).models).toEqual(["my-model"]);
  });

  it("empty models array falls back to defaults", () => {
    writeFileSync(join(globalDir, "config.toml"), `models = []\n`);
    expect(loadConfig({ globalDir, cwd: projectDir }).models).toEqual(DEFAULT_MODELS);
  });

  it("reads the theme name, defaulting to cyberpunk", () => {
    expect(loadConfig({ globalDir, cwd: projectDir }).theme).toBe("cyberpunk");
    writeFileSync(join(globalDir, "config.toml"), `[theme]\nname = "solar"\n`);
    expect(loadConfig({ globalDir, cwd: projectDir }).theme).toBe("solar");
  });
});
