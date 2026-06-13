import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CYBERPUNK, loadThemeOverrides, resolveTheme, applyTheme, theme } from "../../src/ui/theme.js";

describe("themes", () => {
  it("returns empty overrides when the theme is the built-in default or file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-themes-"));
    expect(loadThemeOverrides("cyberpunk", dir)).toEqual({});
    expect(loadThemeOverrides("nope", dir)).toEqual({});
  });

  it("loads valid color overrides and drops invalid values and unknown keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-themes-"));
    writeFileSync(
      join(dir, "solar.toml"),
      `accent = "#b58900"\nwarn = "not-a-color"\nbogus = "#ffffff"\ngood = "#0f0"\n`
    );
    expect(loadThemeOverrides("solar", dir)).toEqual({ accent: "#b58900", good: "#0f0" });
  });

  it("resolveTheme merges overrides onto the cyberpunk default", () => {
    const t = resolveTheme({ accent: "#b58900" });
    expect(t.accent).toBe("#b58900");
    expect(t.dim).toBe(CYBERPUNK.dim);
  });

  it("rejects path-traversal theme names", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-themes-"));
    expect(loadThemeOverrides("../../etc/evil", dir)).toEqual({});
  });

  it("applyTheme mutates the live singleton in place", () => {
    applyTheme({ accent: "#000000" });
    expect(theme.accent).toBe("#000000");
    expect(theme.dim).toBe(CYBERPUNK.dim);
    applyTheme({}); // restore defaults for other tests
    expect(theme.accent).toBe(CYBERPUNK.accent);
  });
});
