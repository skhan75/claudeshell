import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "smol-toml";

export interface Pill {
  label: string;
  prompt?: string;
  slash?: string;
}

export interface Config {
  layout: "sidebar" | "zen";
  pills: Pill[];
  keys: Record<string, string>;
}

export const DEFAULT_PILLS: Pill[] = [
  { label: "fix tests", prompt: "Run the test suite and fix any failures" },
  { label: "explain", prompt: "Explain what the recent changes in this repo do" },
  { label: "commit", slash: "/commit" },
  { label: "review", slash: "/review" },
];

export const DEFAULT_KEYS: Record<string, string> = {
  palette: "ctrl+k",
  layoutToggle: "ctrl+o",
  newSession: "alt+t",
  closeSession: "alt+w",
  focusToggle: "esc",
};

interface RawConfig {
  layout?: { default?: string };
  pills?: Pill[];
  keys?: Record<string, string>;
}

function readToml(path: string): RawConfig {
  if (!existsSync(path)) return {};
  try {
    return parse(readFileSync(path, "utf8")) as RawConfig;
  } catch {
    return {}; // malformed file → ignore, never crash the shell
  }
}

function mergePills(base: Pill[], extra: Pill[] | undefined): Pill[] {
  if (!extra) return base;
  const out = [...base];
  for (const pill of extra) {
    const i = out.findIndex((p) => p.label === pill.label);
    if (i >= 0) out[i] = pill;
    else out.push(pill);
  }
  return out;
}

export function loadConfig(opts: { globalDir?: string; cwd?: string } = {}): Config {
  const globalDir = opts.globalDir ?? join(homedir(), ".claudeshell");
  const cwd = opts.cwd ?? process.cwd();
  const g = readToml(join(globalDir, "config.toml"));
  const p = readToml(join(cwd, ".claudeshell.toml"));

  const layoutRaw = p.layout?.default ?? g.layout?.default ?? "sidebar";
  return {
    layout: layoutRaw === "zen" ? "zen" : "sidebar",
    pills: mergePills(mergePills(DEFAULT_PILLS, g.pills), p.pills),
    keys: { ...DEFAULT_KEYS, ...g.keys, ...p.keys },
  };
}
