import type { AppOverlay } from "./types.js";

/**
 * The built-in CLI slash commands openshell ACTUALLY implements. The interactive
 * `claude` CLI has many more (/vim, /doctor, /config, /cost, /rewind, …) but those are
 * handled by the CLI's terminal UI, NOT the Agent SDK's query() — sending them does
 * nothing ("isn't available in this environment"). So we only advertise the ones we
 * wire to a real action here; the SDK's live `slash_commands` (agent skills/plugins
 * like /superpowers:*) merge in on top and genuinely work.
 *
 * Leading "/" included; kept alphabetical so the inline picker reads predictably.
 */
export const DEFAULT_SLASH_COMMANDS: string[] = ["/budget", "/clear", "/compact", "/fleet", "/fork", "/help", "/model", "/parallel", "/review", "/swarm"];

/**
 * The slash commands to offer: the built-in Claude commands first (the familiar
 * /model, /compact, /clear, …), then the SDK's live list (custom + plugin/skill
 * commands like /superpowers:brainstorming), deduped. Merging means the built-ins
 * are always present even once a session's plugin commands load — the user sees both.
 */
export function effectiveSlashCommands(reported: readonly string[]): string[] {
  const live = reported.map((c) => (c.startsWith("/") ? c : "/" + c));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...DEFAULT_SLASH_COMMANDS, ...live]) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * The single parsed result of a typed slash line — the ONE routing data type.
 * Produced by the pure `routeSlash` (this file, unit-testable without Ink) and
 * consumed by the thin `execSlash` UI executor (src/ui/execSlash.ts). All variants
 * exist from the start so feature phases only add a table row in `routeSlash` + a
 * case in `execSlash`, never a type edit here.
 *
 *  - overlay  → open an app overlay panel
 *  - reset    → /clear the active conversation
 *  - compact  → /compact (focus = text after the command)
 *  - parallel → spawn a worker fleet on `task`
 *  - swarm    → spawn a same-task swarm on `task`
 *  - fork     → branch the active session
 *  - send     → not app-handled; send the raw text to the session (SDK skills, prompts)
 *  - null     → nothing to do (empty / a command that needs an arg it didn't get)
 */
export type SlashAction =
  | { kind: "overlay"; overlay: AppOverlay }
  | { kind: "reset" }
  | { kind: "compact"; focus: string }
  | { kind: "parallel"; task: string }
  | { kind: "swarm"; task: string }
  | { kind: "fork" }
  | { kind: "send"; text: string }
  | null;

/** Bare (arg-less) commands that just open an overlay. */
const OVERLAY_COMMANDS: Record<string, AppOverlay> = {
  "/model": "models",
  "/models": "models",
  "/help": "help",
  "/fleet": "fleet",
  "/budget": "budget",
  "/review": "review",
};

/**
 * Parse a typed input line into a `SlashAction`. Pure (no side effects, no Ink) so it
 * is the single source of truth both InputBar and CommandPalette route through, and is
 * exhaustively unit-tested. Unknown `/commands` (e.g. SDK skills like /superpowers:x)
 * and plain prompts both fall through to `{kind:"send"}` so they reach the session.
 */
export function routeSlash(raw: string): SlashAction {
  const line = raw.trim();
  if (line === "") return null;
  const sp = line.indexOf(" ");
  const cmd = sp < 0 ? line : line.slice(0, sp);
  const args = sp < 0 ? "" : line.slice(sp + 1).trim();
  if (!cmd.startsWith("/")) return { kind: "send", text: line };

  const overlay = OVERLAY_COMMANDS[cmd];
  if (overlay) return { kind: "overlay", overlay };

  switch (cmd) {
    case "/clear":
      return { kind: "reset" };
    case "/compact":
      return { kind: "compact", focus: args };
    case "/parallel":
      // Bare /parallel opens the fleet dashboard; with a task it spawns a fleet.
      return args === "" ? { kind: "overlay", overlay: "fleet" } : { kind: "parallel", task: args };
    case "/swarm":
      // /swarm needs a task — bare is a no-op (the inline picker still shows it).
      return args === "" ? null : { kind: "swarm", task: args };
    case "/fork":
      return { kind: "fork" };
    default:
      return { kind: "send", text: line };
  }
}

