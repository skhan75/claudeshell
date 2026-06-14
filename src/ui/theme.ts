import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";

export interface Theme {
  accent: string;
  dim: string;
  warn: string;
  purple: string;
  good: string;
  bad: string;
  fg: string;
  /** Background for app-managed text selection (overridable via the theme TOML). */
  selection: string;
}

export const CYBERPUNK: Theme = {
  accent: "#4cc2ff",
  dim: "#6a7891",
  warn: "#ffcb6b",
  purple: "#c792ea",
  good: "#7ce38b",
  bad: "#f07178",
  fg: "#dbe6f5",
  selection: "#2d4a73",
};

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Read overrides from <themesDir>/<name>.toml; built-in/missing themes yield {}. */
export function loadThemeOverrides(name: string, themesDir: string): Partial<Theme> {
  if (name === "cyberpunk") return {};
  if (!/^[a-z0-9-]+$/.test(name)) return {};
  const path = join(themesDir, `${name}.toml`);
  if (!existsSync(path)) return {};
  try {
    const raw = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const out: Partial<Theme> = {};
    for (const key of Object.keys(CYBERPUNK) as Array<keyof Theme>) {
      const v = raw[key];
      if (typeof v === "string" && HEX.test(v)) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function resolveTheme(overrides: Partial<Theme>): Theme {
  return { ...CYBERPUNK, ...overrides };
}

/** Mutable singleton imported by every component; applyTheme swaps values at startup. */
export const theme: Theme = { ...CYBERPUNK };

export function applyTheme(overrides: Partial<Theme>): void {
  Object.assign(theme, resolveTheme(overrides));
}
