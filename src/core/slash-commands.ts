/**
 * Built-in Claude Code slash commands, used as a fallback for autocomplete/discovery
 * until the SDK reports the session's live `slash_commands` (which supersedes this
 * the moment a session initializes — so custom/project commands still surface, and
 * we never claim a command the live session doesn't actually offer once it's known).
 *
 * Leading "/" included; kept alphabetical so the inline picker reads predictably.
 */
export const DEFAULT_SLASH_COMMANDS: string[] = [
  "/add-dir",
  "/agents",
  "/bashes",
  "/btw",
  "/bug",
  "/clear",
  "/compact",
  "/config",
  "/context",
  "/cost",
  "/doctor",
  "/export",
  "/feedback",
  "/help",
  "/hooks",
  "/init",
  "/mcp",
  "/memory",
  "/model",
  "/output-style",
  "/permissions",
  "/pr-comments",
  "/release-notes",
  "/resume",
  "/review",
  "/rewind",
  "/status",
  "/statusline",
  "/todos",
  "/usage",
  "/vim",
];

/**
 * The slash commands to offer: the SDK-reported live list when available (the source
 * of truth — includes custom + project commands), else the built-in fallback so the
 * picker is useful on a fresh tab before the first turn has initialized the session.
 */
export function effectiveSlashCommands(reported: readonly string[]): string[] {
  const live = reported.map((c) => (c.startsWith("/") ? c : "/" + c));
  return live.length > 0 ? live : DEFAULT_SLASH_COMMANDS;
}
