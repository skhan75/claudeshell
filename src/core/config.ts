import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "smol-toml";
import type { BudgetCaps } from "./types.js";

export interface Pill {
  label: string;
  prompt?: string;
  slash?: string;
}

export interface Config {
  layout: "sidebar" | "zen";
  pills: Pill[];
  keys: Record<string, string>;
  models: string[];
  theme: string;
  /** How many worker agents `/parallel` and `/swarm` spawn by default. */
  fleetSize: number;
  /** Cost-guard caps (USD). Empty object → no budget. */
  budget: BudgetCaps;
}

/** Clamp a fleet size to a sane range; fall back to 3 for non-finite/≤0. */
function sanitizeFleetSize(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return 3;
  return Math.min(16, Math.floor(n));
}

/** Keep only finite, positive cap values — a corrupt cap must never brick spawning. */
function sanitizeBudget(b: BudgetCaps | undefined): BudgetCaps {
  const out: BudgetCaps = {};
  if (b && typeof b.softUsd === "number" && Number.isFinite(b.softUsd) && b.softUsd > 0) out.softUsd = b.softUsd;
  if (b && typeof b.hardUsd === "number" && Number.isFinite(b.hardUsd) && b.hardUsd > 0) out.hardUsd = b.hardUsd;
  return out;
}

export const DEFAULT_PILLS: Pill[] = [
  { label: "fix tests", prompt: "Run the test suite and fix any failures" },
  { label: "explain", prompt: "Explain what the recent changes in this repo do" },
  { label: "commit", slash: "/commit" },
  { label: "review", slash: "/review" },
];

export const DEFAULT_MODELS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-fable-5",
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
  models?: string[];
  theme?: { name?: string };
  fleet?: { size?: number };
  budget?: BudgetCaps;
}

function sanitize(raw: Record<string, unknown>): RawConfig {
  const out: RawConfig = {};
  const layout = raw.layout;
  if (layout && typeof layout === "object" && typeof (layout as { default?: unknown }).default === "string") {
    out.layout = { default: (layout as { default: string }).default };
  }
  if (Array.isArray(raw.pills)) {
    out.pills = raw.pills.filter(
      (p): p is Pill =>
        !!p && typeof p === "object" &&
        typeof (p as Pill).label === "string" &&
        ((p as Pill).prompt === undefined || typeof (p as Pill).prompt === "string") &&
        ((p as Pill).slash === undefined || typeof (p as Pill).slash === "string")
    );
  }
  if (raw.keys && typeof raw.keys === "object") {
    out.keys = Object.fromEntries(
      Object.entries(raw.keys as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === "string"
      )
    );
  }
  if (Array.isArray(raw.models)) {
    out.models = raw.models.filter((m): m is string => typeof m === "string");
  }
  const themeRaw = raw.theme;
  if (themeRaw && typeof themeRaw === "object" && typeof (themeRaw as { name?: unknown }).name === "string") {
    out.theme = { name: (themeRaw as { name: string }).name };
  }
  const fleet = raw.fleet;
  if (fleet && typeof fleet === "object" && typeof (fleet as { size?: unknown }).size === "number") {
    out.fleet = { size: (fleet as { size: number }).size };
  }
  const budget = raw.budget;
  if (budget && typeof budget === "object") {
    out.budget = sanitizeBudget(budget as BudgetCaps);
  }
  return out;
}

function readToml(path: string): RawConfig {
  if (!existsSync(path)) return {};
  try {
    return sanitize(parse(readFileSync(path, "utf8")) as Record<string, unknown>);
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
    models: (p.models?.length ? p.models : undefined) ?? (g.models?.length ? g.models : undefined) ?? DEFAULT_MODELS,
    theme: p.theme?.name ?? g.theme?.name ?? "cyberpunk",
    fleetSize: sanitizeFleetSize(p.fleet?.size ?? g.fleet?.size),
    budget: { ...sanitizeBudget(g.budget), ...sanitizeBudget(p.budget) },
  };
}
